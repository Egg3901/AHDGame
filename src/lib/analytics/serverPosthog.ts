import { PostHog } from "posthog-node";
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
  const posthog = getServerPosthogClient();
  if (!posthog) return;
  try {
    const iteration =
      input.iteration ?? (input.db ? await getIterationForTurn(input.db, input.turn) : null);
    posthog.capture({
      distinctId: input.distinctId,
      event: input.event,
      properties: {
        ...input.properties,
        ...gameEventEnvelope(iteration, input.turn),
        ...(input.nationId && /^[A-Z]{2,3}$/.test(input.nationId)
          ? { nation_id: input.nationId }
          : {}),
        ...(input.insertId ? { $insert_id: input.insertId } : {}),
        $process_person_profile: false,
      },
    });
    if (input.flush) await posthog.flush();
  } catch {
    // Telemetry failures must never affect an action or turn phase.
  }
}

export async function flushServerPosthog(): Promise<void> {
  try {
    await getServerPosthogClient()?.flush();
  } catch {
    // A failed flush is retried by the SDK on its next scheduled batch.
  }
}
