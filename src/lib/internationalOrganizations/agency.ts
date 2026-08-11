import type { Db } from "mongodb";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getAgencyDef } from "@/lib/constants/orgAgencies";
import { getOrganizationLegislationCollection } from "@/lib/db/collections";
import { getMembers } from "@/lib/internationalOrganizations/service";

/**
 * Funded agency programmes apply a curated, bounded metric benefit to every
 * member of the sponsoring org while active — fed into the per-state metric turn
 * driver's `targetNudges` (the same seam directives and alliance posture use).
 * A programme is "active" only once its cost was successfully drawn from the org
 * fund; an underfunded one is terminated at passage and never read here.
 */

/**
 * Pure: collapse active agency programmes + an org→members map into a per-country
 * `metricId → summed delta` map. Unknown keys are skipped; a country sponsored by
 * several programmes (or in several orgs) accumulates them.
 */
export function buildAgencyNudgesByCountry(
  agencies: Array<{ organizationId: string; agencyKey?: string }>,
  membersByOrg: Map<string, CountryId[]>
): Map<CountryId, Map<string, number>> {
  const out = new Map<CountryId, Map<string, number>>();
  for (const a of agencies) {
    const def = getAgencyDef(a.agencyKey);
    if (!def) continue;
    const members = membersByOrg.get(a.organizationId) ?? [];
    for (const country of members) {
      let byMetric = out.get(country);
      if (!byMetric) {
        byMetric = new Map<string, number>();
        out.set(country, byMetric);
      }
      byMetric.set(def.metricId, (byMetric.get(def.metricId) ?? 0) + def.delta);
    }
  }
  return out;
}

/**
 * Load every active, un-expired funded agency programme and resolve it into a
 * per-country metric-nudge map for the metric turn driver. Empty map when none
 * are active (the parity / golden-master fast path).
 */
export async function loadActiveAgencyNudgesByCountry(
  db: Db,
  currentTurn: number
): Promise<Map<CountryId, Map<string, number>>> {
  const col = await getOrganizationLegislationCollection(db);
  const active = await col
    .find({ type: "fund_agency", status: "active", agencyExpiresOnTurn: { $gt: currentTurn } })
    .toArray();
  if (active.length === 0) return new Map();

  const membersByOrg = new Map<string, CountryId[]>();
  for (const orgId of new Set(active.map((a) => a.organizationId))) {
    // Metric nudges only reach countries the simulation actually models. A
    // macro-tier member has no metrics to nudge, so it is filtered out here
    // rather than crashing the lookup downstream.
    membersByOrg.set(
      orgId,
      (await getMembers(db, orgId)).filter((id): id is CountryId => id in COUNTRY_CONFIGS)
    );
  }
  return buildAgencyNudgesByCountry(
    active.map((a) => ({ organizationId: a.organizationId, agencyKey: a.agencyKey })),
    membersByOrg
  );
}
