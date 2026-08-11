/**
 * SP4 — shared workforce-skill read for worker-count displays.
 *
 * Legacy surfaces read `education.workforceSkill` from stateMetrics; that path
 * is demolished for playable countries, whose value now lives on the political
 * board as `education.adultSkills` (same 0-100 higher-better scale — the same
 * mapping the turn loop uses via the margin adapter). This loader merges both
 * sources so display worker counts keep matching the turn's.
 */

import type { Db } from "mongodb";
import type { PoliticalMetricsDoc } from "@/lib/db/types/politicalMetrics";

/** stateId → workforce skill (0-100) from the political board, or null. */
export async function loadWorkforceSkillByState(
  db: Db,
  stateIds: string[]
): Promise<Map<string, number | null>> {
  if (stateIds.length === 0) return new Map();
  const politicalDocs = await db
    .collection<PoliticalMetricsDoc>("politicalMetrics")
    // Whole `values` object: its keys are literal dotted strings, so a
    // projection of "values.education.adultSkills" reads it as a nested path,
    // matches nothing, and every board region silently resolves to null.
    .find({ _id: { $in: stateIds } }, { projection: { values: 1 } })
    .toArray();
  const political = new Map(
    politicalDocs.map((doc) => [String(doc._id), doc.values?.["education.adultSkills"] ?? null])
  );
  const out = new Map<string, number | null>();
  for (const id of stateIds) out.set(id, political.get(id) ?? null);
  return out;
}
