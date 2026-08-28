import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { RegionCode } from "@/lib/military/types";
import type { EngagementOutcome } from "@/lib/navair/types";

/**
 * Surface actions, recorded so players can see that they happened.
 *
 * Without this the naval war is invisible: fleets meet, hulls are wrecked, sea control
 * moves, and the only evidence a player has is a number on a panel changing for reasons
 * nothing explains. A war nobody can read is a war nobody can play.
 *
 * Deliberately a log rather than state. Nothing reads these back into the engine; they
 * exist to be shown.
 */
export interface NavairEngagementDoc {
  turn: number;
  region: RegionCode;
  winner: CountryId[];
  loser: CountryId[];
  marginPct: number;
  /** Names of formations reduced to combat ineffectiveness. */
  sunk: string[];
}

export function getNavairEngagementsCollection(db: Db) {
  return db.collection<NavairEngagementDoc>("navairEngagements");
}

/** Write this turn's surface actions. No-op when nothing was fought. */
export async function recordNavairEngagements(
  db: Db,
  turn: number,
  outcomes: readonly EngagementOutcome[]
): Promise<number> {
  if (!outcomes.length) return 0;
  const res = await getNavairEngagementsCollection(db).insertMany(
    outcomes.map((o) => ({
      turn,
      region: o.region,
      winner: o.winner,
      loser: o.loser,
      marginPct: o.marginPct,
      sunk: o.sunk,
    })),
    { ordered: false }
  );
  return res.insertedCount ?? 0;
}

/**
 * Recent actions in a set of regions, newest first.
 *
 * Takes regions rather than a conflict, because a war that has spread holds several and
 * a commander needs to see the whole theatre's sea war, not just the region the war
 * happens to be named after.
 */
export async function recentNavairEngagements(
  db: Db,
  regions: readonly RegionCode[],
  limit = 5
): Promise<NavairEngagementDoc[]> {
  if (!regions.length) return [];
  return getNavairEngagementsCollection(db)
    .find({ region: { $in: [...regions] } })
    .sort({ turn: -1 })
    .limit(limit)
    .toArray();
}
