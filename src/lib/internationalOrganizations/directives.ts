import type { Db } from "mongodb";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getDirectiveDef } from "@/lib/constants/orgDirectives";
import { getOrganizationLegislationCollection } from "@/lib/db/collections";
import { getMembers } from "@/lib/internationalOrganizations/service";

/**
 * Organization **directives** apply a curated, bounded metric nudge to every
 * member of the issuing org for as long as the directive is active. The nudge is
 * fed into the per-state metric turn driver's `targetNudges` (the same external
 * seam economic-model synergies use), so the metric settles at `compute + delta`
 * smoothly and naturally relaxes once the directive expires.
 */

/**
 * Pure: collapse a set of active directives + an org→members map into a
 * per-country map of `metricId → summed delta`. A country in several orgs (or
 * affected by several directives targeting the same metric) accumulates them.
 * Unknown directive keys are skipped. Keyed by **bare metricId**; the caller
 * resolves each to a node id before merging into `targetNudges`.
 */
export function buildDirectiveNudgesByCountry(
  directives: Array<{ organizationId: string; directiveKey?: string }>,
  membersByOrg: Map<string, CountryId[]>
): Map<CountryId, Map<string, number>> {
  const out = new Map<CountryId, Map<string, number>>();
  for (const d of directives) {
    const def = getDirectiveDef(d.directiveKey);
    if (!def) continue;
    const members = membersByOrg.get(d.organizationId) ?? [];
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
 * Load every active directive resolution and resolve it into a per-country
 * metric-nudge map for the metric turn driver. Returns an empty map when no
 * directives are active (the parity / golden-master fast path: the merge that
 * consumes this becomes a no-op).
 */
export async function loadActiveDirectiveNudgesByCountry(
  db: Db
): Promise<Map<CountryId, Map<string, number>>> {
  const col = await getOrganizationLegislationCollection(db);
  const active = await col.find({ type: "directive", status: "active" }).toArray();
  if (active.length === 0) return new Map();

  const membersByOrg = new Map<string, CountryId[]>();
  for (const orgId of new Set(active.map((d) => d.organizationId))) {
    // Metric nudges only reach countries the simulation actually models. A
    // macro-tier member has no metrics to nudge, so it is filtered out here
    // rather than crashing the lookup downstream.
    membersByOrg.set(
      orgId,
      (await getMembers(db, orgId)).filter((id): id is CountryId => id in COUNTRY_CONFIGS)
    );
  }
  return buildDirectiveNudgesByCountry(
    active.map((d) => ({ organizationId: d.organizationId, directiveKey: d.directiveKey })),
    membersByOrg
  );
}
