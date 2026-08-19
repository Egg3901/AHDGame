import type { Db } from "mongodb";

/**
 * Per-country snapshot of the current standing cabinet contribution to political
 * metrics (PoliticalMetricId → points/turn). Written by the ministerial-orders turn
 * step; read by the political-metrics dynamics step, which folds it into each region
 * doc's decaying `cabinetResiduals`. The two steps run concurrently, so the snapshot
 * is consumed with a one-turn lag — harmless for a slow drift channel.
 *
 * `contribution` is the NATIONAL standing effect (tier settings, national orders,
 * military, foreign estates) applied equally to every region. `regional` is the
 * extra per-site effect (domestic estates, regional orders/targets) keyed by
 * `states._id` — ticket #1129: without this, AG Field Offices and every other
 * regional cabinet asset were inert on the political board.
 */
export interface PoliticalCabinetContributionDoc {
  _id: string; // countryId
  countryId: string;
  contribution: Record<string, number>; // PoliticalMetricId → points/turn
  /** Per-region extras. Absent on pre-#1129 snapshots — treat as {}. */
  regional?: Record<string, Record<string, number>>;
  /**
   * The same contribution split by producing channel (ticket #1129), which is
   * what the dynamics step caps and accumulates against. `contribution` and
   * `regional` above stay the SUM so every other reader is unaffected.
   * Absent on snapshots written before the split: the consumer then treats the
   * whole snapshot as one channel for that turn, and the next turn writes it.
   */
  sources?: Record<
    string,
    { contribution: Record<string, number>; regional: Record<string, Record<string, number>> }
  >;
  turn: number;
}

export interface CabinetSourceContribution {
  contribution: Record<string, number>;
  regional: Record<string, Record<string, number>>;
}

export interface PoliticalCabinetContributionSnapshot {
  contribution: Record<string, number>;
  regional: Record<string, Record<string, number>>;
  /** Per-channel split; empty on pre-#1129 snapshots. */
  sources: Record<string, CabinetSourceContribution>;
}

const COLLECTION = "politicalCabinetContribution";

/** Latest per-country cabinet contribution snapshot; empty maps when none stored. */
export async function getPoliticalCabinetContribution(
  db: Db,
  countryId: string
): Promise<PoliticalCabinetContributionSnapshot> {
  const doc = await db
    .collection<PoliticalCabinetContributionDoc>(COLLECTION)
    .findOne({ _id: countryId });
  return {
    contribution: doc?.contribution ?? {},
    regional: doc?.regional ?? {},
    sources: doc?.sources ?? {},
  };
}

export async function setPoliticalCabinetContribution(
  db: Db,
  countryId: string,
  contribution: Record<string, number>,
  turn: number,
  regional: Record<string, Record<string, number>> = {},
  sources: Record<string, CabinetSourceContribution> = {}
): Promise<void> {
  await db
    .collection<PoliticalCabinetContributionDoc>(COLLECTION)
    .updateOne(
      { _id: countryId },
      { $set: { countryId, contribution, regional, sources, turn } },
      { upsert: true }
    );
}
