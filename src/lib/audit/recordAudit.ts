import * as Sentry from "@sentry/nextjs";
import crypto from "crypto";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { getActionAuditLogCollection } from "@/lib/db/collections/actionAuditLog";
import { isAuditLogEnabled } from "@/lib/audit/featureFlag";
import { getAuditRequestContext } from "@/lib/observability/context";
import { getGameState } from "@/lib/gameState";
import { loadTurnLengthMinutes } from "@/lib/financialTxLog/expiresAt";
import { DEFAULT_TURN_LENGTH_MINUTES } from "@/lib/db/types/financialTxLog";
import type {
  ActionAuditActor,
  ActionAuditDelta,
  ActionAuditInput,
  ActionAuditRecord,
} from "@/lib/db/types/actionAuditLog";

/**
 * Fire-and-forget writer for the unified action-audit spine (`actionAuditLog`
 * collection; forensics/alt-detection rework plan §3.1). Mirrors `emitTx`/
 * `emitTxBulk` (`src/lib/financialTxLog/emit.ts`): callers never await this,
 * any failure is reported to Sentry and swallowed, and it never throws into
 * game logic.
 *
 * `recordAudit`/`recordAuditBulk` push into an in-process buffer and flush
 * via `insertMany({ordered:false})` on a short timer OR once the buffer hits
 * a size threshold, whichever comes first — so hot turn-loop callers
 * (`recordAuditBulk`) don't pay a per-entry DB round trip. `traceId`/`seq`/
 * `actor` are filled from the ambient audit context
 * (`src/lib/observability/context.ts`, AsyncLocalStorage) when the caller
 * doesn't supply them; `turn`/`ts`/`expiresAt` are resolved at flush time.
 */

// Must track `src/lib/retention/policy.ts`'s `actionAuditLog` policy
// (`windowTurns: 336`). The TTL computed here is a belt-and-suspenders
// backstop — the retention pipeline archives to R2 before it fires.
const AUDIT_TTL_TURNS = 336;

const FLUSH_INTERVAL_MS = 250;
const FLUSH_SIZE_THRESHOLD = 200;
/** Keep the envelope small — this is a summary spine, not a full document diff. */
const MAX_DELTA_ENTRIES = 8;

/** An entry once `traceId`/`actor` have been resolved (from the caller or
 * the ambient context) — `turn`/`ts`/`expiresAt` are still pending, filled
 * in at flush time so a whole batch can share one `gameState`/`gameConfig`
 * lookup instead of one per entry. */
type NormalizedAuditEntry = ActionAuditInput &
  Required<Pick<ActionAuditInput, "traceId" | "actor">>;

let buffer: NormalizedAuditEntry[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function trimDelta(delta?: ActionAuditDelta[]): ActionAuditDelta[] | undefined {
  if (!delta || delta.length === 0) return undefined;
  return delta.length > MAX_DELTA_ENTRIES ? delta.slice(0, MAX_DELTA_ENTRIES) : delta;
}

function toObjectId(id?: string): ObjectId | undefined {
  if (!id) return undefined;
  try {
    return new ObjectId(id);
  } catch {
    return undefined;
  }
}

/** Fill `traceId`/`seq`/`actor` from the ambient audit context when the
 * caller didn't supply them; falls back to a fresh id / a `system` actor
 * when there is no request/turn-phase context at all (e.g. a cron job that
 * hasn't adopted `runInAuditContext` yet). */
function withContextDefaults(entry: ActionAuditInput): NormalizedAuditEntry {
  if (entry.traceId !== undefined && entry.seq !== undefined && entry.actor !== undefined) {
    return entry as NormalizedAuditEntry;
  }
  const ctx = getAuditRequestContext();
  const traceId = entry.traceId ?? ctx?.traceId ?? crypto.randomUUID();
  const seq = entry.seq ?? ctx?.nextSeq();
  const actor: ActionAuditActor =
    entry.actor ??
    (ctx?.actor
      ? {
          kind: ctx.actor.kind,
          userId: toObjectId(ctx.actor.userId),
          characterId: toObjectId(ctx.actor.characterId),
          name: ctx.actor.name,
          role: ctx.actor.role,
        }
      : { kind: "system" });
  return { ...entry, traceId, seq, actor };
}

function scheduleFlush(): void {
  if (buffer.length >= FLUSH_SIZE_THRESHOLD) {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    void flush();
    return;
  }
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flush();
  }, FLUSH_INTERVAL_MS);
  // Don't keep the process alive just for a pending best-effort audit flush.
  flushTimer.unref?.();
}

function enqueue(entry: ActionAuditInput): void {
  buffer.push(withContextDefaults({ ...entry, delta: trimDelta(entry.delta) }));
  scheduleFlush();
}

function computeAuditExpiresAt(ts: Date, turnLengthMinutes: number): Date {
  return new Date(ts.getTime() + AUDIT_TTL_TURNS * turnLengthMinutes * 60_000);
}

async function flush(): Promise<void> {
  if (buffer.length === 0) return;
  const batch = buffer;
  buffer = [];
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }

  try {
    const enabled = await isAuditLogEnabled();
    if (!enabled) return; // Flag off — drop the batch, this is a no-op by design.

    const db = await getDb();

    let fallbackTurn: number | undefined;
    if (batch.some((entry) => entry.turn === undefined)) {
      try {
        const gs = await getGameState(db);
        fallbackTurn = gs?.currentTurn ?? 0;
      } catch {
        fallbackTurn = 0;
      }
    }

    let turnLengthMinutes = DEFAULT_TURN_LENGTH_MINUTES;
    try {
      turnLengthMinutes = await loadTurnLengthMinutes(db);
    } catch {
      // Keep the default computed above.
    }

    const now = new Date();
    const docs: ActionAuditRecord[] = batch.map((entry) => {
      const ts = entry.ts ?? now;
      return {
        ...entry,
        _id: new ObjectId(),
        ts,
        turn: entry.turn ?? fallbackTurn ?? 0,
        expiresAt: computeAuditExpiresAt(ts, turnLengthMinutes),
      };
    });

    const col = await getActionAuditLogCollection(db);
    await col.insertMany(docs, { ordered: false });
  } catch (err) {
    Sentry.captureException(err, { extra: { phase: "recordAudit.flush", count: batch.length } });
  }
}

/**
 * Enqueue one audit envelope. Fire-and-forget — never throws, never awaited
 * by the caller. Actual DB write happens on the next batched flush.
 */
export function recordAudit(entry: ActionAuditInput): void {
  try {
    enqueue(entry);
  } catch (err) {
    // Buffering itself should never fail, but guard it the same way as the
    // async write path so a bad `entry` can never break the caller.
    Sentry.captureException(err, { extra: { phase: "recordAudit.enqueue" } });
  }
}

/**
 * Enqueue many audit envelopes at once — the hot/turn-loop path
 * (`corporationTurn`, bulk command dispatch, etc). Same fire-and-forget,
 * never-throws contract as {@link recordAudit}; batches into the shared
 * buffer so a turn phase emitting hundreds of rows still costs one
 * `insertMany` per flush, not one per row.
 */
export function recordAuditBulk(entries: ActionAuditInput[]): void {
  if (entries.length === 0) return;
  try {
    for (const entry of entries) {
      buffer.push(withContextDefaults({ ...entry, delta: trimDelta(entry.delta) }));
    }
    scheduleFlush();
  } catch (err) {
    Sentry.captureException(err, {
      extra: { phase: "recordAuditBulk.enqueue", count: entries.length },
    });
  }
}

/**
 * Test-only helper — force an immediate flush of the current buffer and
 * await its completion, bypassing the timer/size-threshold triggers.
 */
export async function flushRecordAuditBufferForTest(): Promise<void> {
  await flush();
}

/**
 * Test-only helper — drop the current buffer and any pending flush timer
 * without writing, so tests don't leak state into one another.
 */
export function resetRecordAuditBufferForTest(): void {
  buffer = [];
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
}
