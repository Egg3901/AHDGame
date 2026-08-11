/**
 * The governance inputs to the dynamic SOE efficiency penalty (spec §11.3),
 * loaded from the political board.
 *
 * `computeSoeEfficiencyPenalty` and `computeSoeEfficiencyBreakdown` read
 * `governance.corruptionIndex` and `governance.governmentTransparency` — both
 * POLITICAL paths, so a board region has no legacy doc to read them from. They
 * came back null and the penalty silently vanished until each caller learned to
 * synthesize them through the `politicalSoeInputs` adapter.
 *
 * ONE loader, because three surfaces must agree to the number: the budget
 * revenue line (`publicEnterpriseRevenue`), the per-turn remittance
 * (`soeRemittance`), and the Holdings drill-down (`nationalCorporationView`).
 * They previously each carried their own copy of the synthesis, which is how
 * two views of "the same corp's income" start disagreeing.
 *
 * The legacy-doc-first ordering those copies shared is gone with the store it
 * preferred. It would now only ever shadow the board with a stale value.
 */
import type { Db } from "mongodb";
import type { StateMetrics } from "@/lib/db/types";
import type { PoliticalMetricsDoc } from "@/lib/db/types/politicalMetrics";
import { politicalSoeInputs } from "@/lib/politicalLegislation/marginAdapter";

/**
 * `stateId →` a minimal legacy-shaped doc carrying just the two governance
 * fields the efficiency math reads. Regions with no board are absent, and the
 * callers' `?? null` then feeds the penalty its neutral inputs.
 */
export async function loadSoeGovernanceInputs(
  db: Db,
  stateIds: string[]
): Promise<Map<string, StateMetrics>> {
  const byId = new Map<string, StateMetrics>();
  if (stateIds.length === 0) return byId;
  const boards = await db
    .collection<PoliticalMetricsDoc>("politicalMetrics")
    .find({ _id: { $in: stateIds } })
    .toArray();
  for (const doc of boards) {
    const id = String(doc._id);
    const soe = politicalSoeInputs(doc.values);
    byId.set(id, {
      _id: id,
      governance: {
        corruptionIndex: { value: soe.corruptionIndex },
        governmentTransparency: { value: soe.governmentTransparency },
      },
    } as unknown as StateMetrics);
  }
  return byId;
}
