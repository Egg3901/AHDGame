import { ObjectId, type Db } from "mongodb";
import type { SuspiciousFlag } from "@/lib/db/types/activityLog";
import { MS_PER_TURN } from "@/lib/constants/turnTime";

export const AUTOMATION_FLAG_TYPE = "automation_timing";

// Analyze the last 48h of actions — long enough to see a multi-hour cadence run
// without scanning unbounded history.
export const AUTOMATION_LOOKBACK_MS = 48 * 60 * 60 * 1000;

// Cadence: an action recurring at a fixed offset past the turn boundary for N
// consecutive turns. A human who merely plays each hour drifts by minutes, so a
// ±15s band across 3 unbroken turns is a machine signature, not normal play.
export const CADENCE_MIN_CONSECUTIVE = 3;
export const CADENCE_JITTER_MS = 15_000;

export interface AutomationActionRow {
  actionType: string;
  createdAt: Date;
}

export interface AutomationDetectionParams {
  msPerTurn: number;
  now: Date;
  cadenceMinConsecutive?: number;
  cadenceJitterMs?: number;
}

interface CadenceResult {
  /** Specific actionType, or "*" for the combined per-actor ("loop") stream. */
  actionType: string;
  turns: number;
  anchorOffsetMs: number;
  events: AutomationActionRow[];
}

/** Circular distance between two within-turn offsets (handles boundary wrap). */
function offsetDistance(a: number, b: number, period: number): number {
  const d = Math.abs(a - b) % period;
  return Math.min(d, period - d);
}

/**
 * Longest run of CONSECUTIVE turn indices where each turn has an action whose
 * offset past the turn boundary stays within `jitterMs` of the run's anchor
 * (the first turn's offset). A missing turn breaks the run. Returns the run's
 * turn span; the caller collects the actual events.
 */
function longestCadenceRun(
  stream: AutomationActionRow[],
  msPerTurn: number,
  jitterMs: number
): { turns: number; startTurn: number; endTurn: number; anchorOffsetMs: number } | null {
  if (stream.length === 0) return null;

  // One representative action per turn index (earliest in that turn).
  const byTurn = new Map<number, AutomationActionRow>();
  for (const row of stream) {
    const turn = Math.floor(row.createdAt.getTime() / msPerTurn);
    const existing = byTurn.get(turn);
    if (!existing || row.createdAt.getTime() < existing.createdAt.getTime()) {
      byTurn.set(turn, row);
    }
  }
  const turns = [...byTurn.keys()].sort((a, b) => a - b);

  let best: { turns: number; startTurn: number; endTurn: number; anchorOffsetMs: number } | null =
    null;
  let i = 0;
  while (i < turns.length) {
    const anchorOffset = byTurn.get(turns[i])!.createdAt.getTime() % msPerTurn;
    let prevTurn = turns[i];
    let runLen = 1;
    let j = i + 1;
    for (; j < turns.length; j++) {
      const t = turns[j];
      const offset = byTurn.get(t)!.createdAt.getTime() % msPerTurn;
      if (t !== prevTurn + 1) break;
      if (offsetDistance(offset, anchorOffset, msPerTurn) > jitterMs) break;
      runLen++;
      prevTurn = t;
    }
    if (!best || runLen > best.turns) {
      best = {
        turns: runLen,
        startTurn: turns[i],
        endTurn: prevTurn,
        anchorOffsetMs: anchorOffset,
      };
    }
    i = j > i + 1 ? j : i + 1;
  }
  return best;
}

/**
 * Best fixed-phase cadence across every single-action-type stream AND the
 * combined per-actor ("loop") stream. On a tie in run length the combined
 * stream wins, so a cross-action loop is reported as a loop with all its types.
 */
function findCadence(
  sorted: AutomationActionRow[],
  msPerTurn: number,
  minConsecutive: number,
  jitterMs: number
): CadenceResult | null {
  const byType = new Map<string, AutomationActionRow[]>();
  for (const row of sorted) {
    const arr = byType.get(row.actionType) ?? [];
    arr.push(row);
    byType.set(row.actionType, arr);
  }
  const streams: Array<[string, AutomationActionRow[]]> = [...byType.entries()];
  if (byType.size > 1) streams.push(["*", sorted]);

  let best: CadenceResult | null = null;
  for (const [actionType, stream] of streams) {
    const run = longestCadenceRun(stream, msPerTurn, jitterMs);
    if (!run || run.turns < minConsecutive) continue;
    const better =
      !best || run.turns > best.turns || (run.turns === best.turns && actionType === "*");
    if (!better) continue;
    // Collect every action in the run's consecutive turn range. For a single
    // type that's just that type; for "*" it's all types (the full loop).
    const events = stream
      .filter((r) => {
        const t = Math.floor(r.createdAt.getTime() / msPerTurn);
        return t >= run.startTurn && t <= run.endTurn;
      })
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    best = { actionType, turns: run.turns, anchorOffsetMs: run.anchorOffsetMs, events };
  }
  return best;
}

/**
 * Inspect one actor's action timeline for the fixed-phase cadence (single
 * action type) or "loop" (combined per-actor stream) signature and return a
 * `SuspiciousFlag`, or null if none fires. Pure — all I/O lives in
 * `detectAutomationTiming`.
 *
 * NOTE: a rapid-fire "burst" signature (N actions within 1s) was deliberately
 * dropped — it collides with the sanctioned ×5/×10 batch-action feature
 * (`actions/execute` `count`), which writes N actionLogs ~15ms apart, so it
 * cannot distinguish a bot from a player using batch actions. Cadence/loop is
 * unaffected and is the signature that surfaced the real abuse.
 */
export function buildAutomationFlag(
  rows: AutomationActionRow[],
  username: string,
  params: AutomationDetectionParams
): SuspiciousFlag | null {
  const cadenceMinConsecutive = params.cadenceMinConsecutive ?? CADENCE_MIN_CONSECUTIVE;
  const cadenceJitterMs = params.cadenceJitterMs ?? CADENCE_JITTER_MS;
  const HOUR_MS = 60 * 60 * 1000;

  const sorted = [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  if (sorted.length === 0) return null;

  const cadence = findCadence(sorted, params.msPerTurn, cadenceMinConsecutive, cadenceJitterMs);
  if (!cadence) return null;

  const isLoop = cadence.actionType === "*";
  const actionTypes = [...new Set(cadence.events.map((e) => e.actionType))];
  const spanMs =
    cadence.events[cadence.events.length - 1].createdAt.getTime() -
    cadence.events[0].createdAt.getTime();
  const hours = Math.max(1, Math.round(spanMs / HOUR_MS));
  const offsetSec = Math.round(cadence.anchorOffsetMs / 1000);
  const typeLabel = isLoop ? `${actionTypes.join("+")} loop` : `${cadence.actionType} actions`;
  const reason = `fixed timing — ${cadence.events.length} ${typeLabel} at +${offsetSec}s past each turn`;
  return {
    type: AUTOMATION_FLAG_TYPE,
    severity: "high",
    detail: `Potential automation due to ${reason} for ${hours} hours by ${username}`,
    detectedAt: params.now,
    evidence: {
      signature: isLoop ? "loop" : "cadence",
      reason,
      spanHours: hours,
      consecutiveTurns: cadence.turns,
      anchorOffsetSec: offsetSec,
      actionTypes,
      events: cadence.events.map((e) => ({
        actionType: e.actionType,
        time: e.createdAt.toISOString(),
        offsetSec: Math.round((e.createdAt.getTime() % params.msPerTurn) / 1000),
      })),
    },
  };
}

interface CharUserLink {
  _id: ObjectId;
  userId: ObjectId;
}

/**
 * Load the last `AUTOMATION_LOOKBACK_MS` of `actionLogs` for the given
 * characters' users and run `buildAutomationFlag` per character. Returns a
 * map of characterId → flag for the characters that tripped a signature.
 */
export async function detectAutomationTiming(
  db: Db,
  now: Date,
  characterIds: ObjectId[]
): Promise<Map<string, SuspiciousFlag>> {
  const results = new Map<string, SuspiciousFlag>();
  if (characterIds.length === 0) return results;

  const chars = await db
    .collection<CharUserLink>("characters")
    .find({ _id: { $in: characterIds } }, { projection: { _id: 1, userId: 1 } })
    .toArray();
  if (chars.length === 0) return results;

  const userIds = [...new Set(chars.map((c) => c.userId.toString()))].map((id) => new ObjectId(id));
  const since = new Date(now.getTime() - AUTOMATION_LOOKBACK_MS);

  const logs = await db
    .collection("actionLogs")
    .find<{ userId: ObjectId; actionType: string; createdAt: Date; username?: string }>(
      { userId: { $in: userIds }, createdAt: { $gte: since } },
      { projection: { userId: 1, actionType: 1, createdAt: 1, username: 1 } }
    )
    .toArray();

  const byUser = new Map<string, AutomationActionRow[]>();
  const usernameByUser = new Map<string, string>();
  for (const log of logs) {
    const uid = log.userId.toString();
    const arr = byUser.get(uid) ?? [];
    arr.push({ actionType: log.actionType, createdAt: log.createdAt });
    byUser.set(uid, arr);
    if (log.username) usernameByUser.set(uid, log.username);
  }

  for (const char of chars) {
    const uid = char.userId.toString();
    const rows = byUser.get(uid);
    if (!rows || rows.length === 0) continue;
    const flag = buildAutomationFlag(rows, usernameByUser.get(uid) ?? "unknown", {
      msPerTurn: MS_PER_TURN,
      now,
    });
    if (flag) results.set(char._id.toString(), flag);
  }

  return results;
}
