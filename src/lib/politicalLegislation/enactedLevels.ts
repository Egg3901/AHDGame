/**
 * Enactment readback (spec §6): joins statePolicies (policyOptionIndex 0–4) to
 * the typed catalog. Consumed by the estimated-cost UI, the dashboard's
 * Relevant Legislation panel, and later the dynamics engine.
 */

import type { Db } from "mongodb";
import type { StatePolicy } from "@/lib/db/types/statePolicy";
import { getCatalog, getLaw } from "./catalog";
import type { LawCountryId } from "./types";

/**
 * National enacted levels for every program law of a country: lawId → 0–4.
 * Laws without a statePolicies record fall back to their authored baseline.
 */
export async function getEnactedLevels(db: Db, countryId: string): Promise<Map<string, number>> {
  const laws = getCatalog(countryId).filter((law) => law.kind !== "tax");
  const records = await db
    .collection<StatePolicy>("statePolicies")
    .find(
      { scope: "national", legislationTypeId: { $in: laws.map((law) => law.id) } },
      { projection: { legislationTypeId: 1, policyOptionIndex: 1 } }
    )
    .toArray();
  const recorded = new Map(records.map((r) => [r.legislationTypeId, r.policyOptionIndex]));
  const levels = new Map<string, number>();
  for (const law of laws) {
    const index = recorded.get(law.id);
    levels.set(
      law.id,
      typeof index === "number" ? Math.max(0, Math.min(4, index)) : (law.baselineLevel ?? 0)
    );
  }
  return levels;
}

/** One law's enacted level; regionId reads the region-scoped record instead. */
export async function getEnactedLevel(
  db: Db,
  countryId: LawCountryId,
  lawId: string,
  regionId?: string
): Promise<number> {
  const law = getLaw(lawId);
  if (!law || law.kind === "tax") return 0;
  const record = await db
    .collection<StatePolicy>("statePolicies")
    .findOne(
      regionId
        ? { scope: "state", stateId: regionId, legislationTypeId: lawId }
        : { scope: "national", legislationTypeId: lawId },
      { projection: { policyOptionIndex: 1 } }
    );
  if (typeof record?.policyOptionIndex === "number") {
    return Math.max(0, Math.min(4, record.policyOptionIndex));
  }
  // Regional scope has no baseline (regions differentiate through play).
  return regionId ? 0 : (law.baselineLevel ?? 0);
}
