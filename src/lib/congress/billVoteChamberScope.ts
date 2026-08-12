import type { Bill } from "@/lib/db/types";

/**
 * Which chamber's roster owns each of a bill's two vote tallies.
 *
 * Both tallies are scoped to the office type of the chamber that cast them, so
 * getting the chamber wrong does not error — it silently filters every vote out
 * and the tally reads as empty (or falls through to a stale stored aggregate).
 *
 * These two resolvers lived, identically, in both `nationalBillQueries` and the
 * bill votes route. They are here so a fix to one is a fix to both.
 */

type ScopedBill = Pick<Bill, "status" | "currentChamber" | "originChamber">;

/** The chamber whose roster owns `bill.votes`. */
export function resolvePrimaryVoteChamberKey(
  bill: ScopedBill,
  lowerKey: string
): string | undefined {
  if (bill.status === "cabinet_review") return undefined;
  if (bill.status === "override_shugiin") return bill.currentChamber;
  if (bill.originChamber === "cabinet") return lowerKey;
  return bill.originChamber;
}

/**
 * The chamber whose roster owns `bill.otherChamberVotes`.
 *
 * For the sequential crossover this is `currentChamber` — the bill has physically
 * moved. A concurrent bill never moves: `currentChamber` stays on the lower house as
 * a display default while the upper house votes into the second map, so it has to be
 * named outright.
 *
 * `upperKey` must already be gated on `upperElectionSystem` rather than `bicameral`,
 * for the reason the concurrent stage is: DE 1953 declares itself bicameral over an
 * appointed Bundesrat that has no voters at all.
 */
export function resolveOtherVoteChamberKey(
  bill: ScopedBill,
  upperKey: string | null | undefined
): string | undefined {
  if (bill.status === "active_both") return upperKey ?? bill.currentChamber;
  return bill.currentChamber;
}
