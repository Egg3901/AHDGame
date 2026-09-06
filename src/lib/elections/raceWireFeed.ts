import type { Db } from "mongodb";
import type { WireEvent } from "@/lib/wireEvent";

/** One headline as the ticker consumes it. */
export interface RaceWireItem {
  headline: string;
  /** ISO timestamp. */
  timestamp: string;
  href?: string;
}

export const RACE_WIRE_DEFAULT_LIMIT = 8;
export const RACE_WIRE_MAX_LIMIT = 20;

/**
 * Clamp a caller-supplied limit into the range the feed will serve.
 *
 * Exported so the route and the tests agree on the bounds rather than
 * duplicating the numbers.
 */
export function clampRaceWireLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return RACE_WIRE_DEFAULT_LIMIT;
  return Math.max(1, Math.min(RACE_WIRE_MAX_LIMIT, Math.floor(limit)));
}

export interface RaceWireQuery {
  electionId: string;
  /** Narrow to a single campaign's events within the race. */
  campaignId?: string;
  limit?: number;
}

/**
 * Recent wire events for one race, newest first.
 *
 * Events age out of the `wireEvents` collection after 48 hours via its TTL
 * index, so this is a live strip rather than a history: a quiet race correctly
 * returns an empty list, and the ticker renders nothing for it.
 */
export async function getRaceWireFeed(db: Db, query: RaceWireQuery): Promise<RaceWireItem[]> {
  const limit = clampRaceWireLimit(query.limit);

  const filter: Record<string, unknown> = { electionId: query.electionId };
  if (query.campaignId) filter.campaignId = query.campaignId;

  const rows = await db
    .collection<WireEvent>("wireEvents")
    .find(filter)
    .sort({ timestamp: -1 })
    .limit(limit)
    .toArray();

  return rows.map((r) => ({
    headline: r.headline,
    timestamp: new Date(r.timestamp).toISOString(),
    ...(r.href ? { href: r.href } : {}),
  }));
}
