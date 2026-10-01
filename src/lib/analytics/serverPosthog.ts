import { PostHog } from "posthog-node";
import { createHash } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import type { Db } from "mongodb";
import type { GameIteration } from "@/lib/db/types/gameState";
import { gameEventEnvelope } from "./gameEventEnvelope";

let client: PostHog | null = null;

export function getServerPosthogClient(): PostHog | null {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) return null;
  client ??= new PostHog(key, {
    host: "https://us.i.posthog.com",
    flushAt: 1000,
    flushInterval: 0,
  });
  return client;
}

type CachedEnvelope = {
  turn: number;
  expiresAt: number;
  value: Promise<{ iteration?: GameIteration }>;
};

const envelopeCache = new WeakMap<Db, CachedEnvelope>();

type PendingEvent = {
  db?: Db;
  markerId?: string;
  turn: number;
  message: Parameters<PostHog["capture"]>[0];
};

const pendingEvents: PendingEvent[] = [];
let flushTail: Promise<void> = Promise.resolve();
const turnScope = new AsyncLocalStorage<{
  events: PendingEvent[];
  committed: boolean;
  disabled: boolean;
}>();

/** Keep turn outcomes isolated from concurrent request flushes until commit. */
export async function withServerTurnAnalytics<T>(callback: () => Promise<T>): Promise<T> {
  const scope = { events: [] as PendingEvent[], committed: false, disabled: false };
  return turnScope.run(scope, async () => {
    try {
      return await callback();
    } finally {
      // Failed, sandbox and local turns never release their buffered outcomes.
      scope.events.length = 0;
      if (!scope.committed) scope.disabled = true;
    }
  });
}

/** The turn shell calls this only after durable game-state commit. */
export function markServerTurnAnalyticsCommitted(options: { emit?: boolean } = {}): void {
  const scope = turnScope.getStore();
  if (!scope || scope.committed) return;
  scope.committed = true;
  scope.disabled = options.emit === false;
  if (!scope.disabled) pendingEvents.push(...scope.events);
  scope.events.length = 0;
}

async function getIterationForTurn(db: Db, turn: number): Promise<GameIteration | undefined> {
  const cached = envelopeCache.get(db);
  if (cached && cached.turn === turn && cached.expiresAt > Date.now()) {
    return (await cached.value).iteration;
  }
  const value = db
    .collection<{ _id: string; currentTurn?: number; iteration?: GameIteration }>("gameState")
    .findOne({ _id: "current" }, { projection: { currentTurn: 1, iteration: 1 } })
    .then((gameState) => ({ iteration: gameState?.iteration }));
  envelopeCache.set(db, { turn, expiresAt: Date.now() + 5000, value });
  return (await value).iteration;
}

/** Emit a scalar-only game event. Player action events use the client consent gate instead. */
export async function captureServerGameEvent(input: {
  db?: Db;
  event: string;
  distinctId: string;
  turn: number;
  iteration?: GameIteration | null;
  nationId?: string;
  flush?: boolean;
  insertId?: string;
  properties?: Record<string, string | number | boolean>;
}): Promise<void> {
  try {
    const scope = turnScope.getStore();
    if (scope?.disabled) return;
    if (!getServerPosthogClient()) return;
    const iteration =
      input.iteration ?? (input.db ? await getIterationForTurn(input.db, input.turn) : null);
    const envelope = gameEventEnvelope(iteration, input.turn);
    const message: PendingEvent["message"] = {
      distinctId: input.distinctId,
      event: input.event,
      properties: {
        ...input.properties,
        ...envelope,
        ...(input.nationId && /^[A-Z]{2,3}$/.test(input.nationId)
          ? { nation_id: input.nationId }
          : {}),
        ...(input.insertId ? { $insert_id: input.insertId } : {}),
        $process_person_profile: false,
      },
    };
    // $insert_id is useful for tracing, but is not a PostHog delivery deduplication
    // guarantee. Persist claims together at flush instead of adding a query per row.
    const markerId = input.insertId
      ? `posthog-event:${createHash("sha256")
          .update(JSON.stringify([envelope.iteration_id, input.event, input.insertId]))
          .digest("hex")}`
      : undefined;
    if (markerId && !input.db) return;
    const queue = scope && !scope.committed ? scope.events : pendingEvents;
    queue.push({ db: input.db, markerId, turn: envelope.turn_number, message });
    if (input.flush) await flushServerPosthog();
  } catch {
    // Telemetry failures must never affect an action or turn phase.
  }
}

export async function flushServerPosthog(): Promise<void> {
  const scope = turnScope.getStore();
  if (scope && (scope.disabled || !scope.committed)) return;

  // Serialize concurrent request/turn flushes so one batch owns each pending item.
  const flush = flushTail.then(async () => {
    const posthog = getServerPosthogClient();
    if (!posthog) return;
    const batch = pendingEvents.splice(0);
    const claimGroups = new Map<Db, Map<string, PendingEvent>>();
    for (const event of batch) {
      if (!event.markerId || !event.db) continue;
      let group = claimGroups.get(event.db);
      if (!group) {
        group = new Map();
        claimGroups.set(event.db, group);
      }
      if (!group.has(event.markerId)) group.set(event.markerId, event);
    }

    const claimedEvents = new Set<PendingEvent>();
    for (const [db, group] of claimGroups) {
      const events = [...group.values()];
      try {
        const result = await db
          .collection<{ _id: string; value: number }>("analyticsRecords")
          .bulkWrite(
            events.map((event) => ({
              updateOne: {
                filter: { _id: event.markerId! },
                update: { $setOnInsert: { value: event.turn } },
                upsert: true,
              },
            })),
            { ordered: false }
          );
        for (const index of Object.keys(result.upsertedIds)) {
          const event = events[Number(index)];
          if (event) claimedEvents.add(event);
        }
      } catch {
        // Suppress outcomes when ownership cannot be established. These claims
        // provide at-most-once emission, not a durable event outbox: a process
        // crash after a claim or an SDK failure can still lose telemetry.
      }
    }
    for (const event of batch) {
      if (event.markerId && !claimedEvents.has(event)) continue;
      try {
        posthog.capture(event.message);
      } catch {
        // One malformed SDK item must not prevent the remaining batch.
      }
    }
    await posthog.flush();
  });
  flushTail = flush.catch(() => {
    // Telemetry failures never affect an action or turn phase. The SDK retains
    // its own queued captures for its next flush where supported.
  });
  await flushTail;
}
