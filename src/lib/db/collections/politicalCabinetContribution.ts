import type { Db } from "mongodb";

/**
 * Per-country snapshot of the current standing cabinet contribution to political
 * metrics (PoliticalMetricId → points/turn). Written by the ministerial-orders turn
 * step; read by the political-metrics dynamics step, which folds it into each region
 * doc's decaying `cabinetResiduals`. The two steps run concurrently, so the snapshot
 * is consumed with a one-turn lag — harmless for a slow drift channel.
 */
export interface PoliticalCabinetContributionDoc {
  _id: string; // countryId
  countryId: string;
  contribution: Record<string, number>; // PoliticalMetricId → points/turn
  turn: number;
}

const COLLECTION = "politicalCabinetContribution";

/** Latest per-country cabinet contribution snapshot; {} when none stored. */
export async function getPoliticalCabinetContribution(
  db: Db,
  countryId: string
): Promise<Record<string, number>> {
  const doc = await db
    .collection<PoliticalCabinetContributionDoc>(COLLECTION)
    .findOne({ _id: countryId });
  return doc?.contribution ?? {};
}

export async function setPoliticalCabinetContribution(
  db: Db,
  countryId: string,
  contribution: Record<string, number>,
  turn: number
): Promise<void> {
  await db
    .collection<PoliticalCabinetContributionDoc>(COLLECTION)
    .updateOne({ _id: countryId }, { $set: { countryId, contribution, turn } }, { upsert: true });
}
