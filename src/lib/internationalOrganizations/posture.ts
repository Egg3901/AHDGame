import { ObjectId, type Db } from "mongodb";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import type { InternationalOrganizationId } from "@/lib/constants/internationalOrganizations";
import {
  DEFAULT_ALERT_POSTURE,
  postureEffect,
  type AlertPosture,
} from "@/lib/constants/orgPosture";
import { getOrganizationPosturesCollection } from "@/lib/db/collections";
import { getMembers } from "@/lib/internationalOrganizations/service";

/**
 * Alliance alert posture state + its member-wide metric effect. The posture doc
 * is the SSOT (read live each turn); the effect is fed into the per-state metric
 * turn driver's `targetNudges`, the same seam directives use, so it persists
 * while set and relaxes smoothly when the posture returns to standard.
 */

/** Read an org's current posture, defaulting to `standard` when unset. */
export async function getOrganizationPosture(
  db: Db,
  organizationId: InternationalOrganizationId
): Promise<AlertPosture> {
  const col = await getOrganizationPosturesCollection(db);
  const row = await col.findOne({ organizationId });
  return row?.posture ?? DEFAULT_ALERT_POSTURE;
}

/** Set an org's posture; creates the row if absent. */
export async function setOrganizationPosture(
  db: Db,
  organizationId: InternationalOrganizationId,
  posture: AlertPosture
): Promise<void> {
  const col = await getOrganizationPosturesCollection(db);
  await col.updateOne(
    { organizationId },
    {
      $set: { posture, updatedAt: new Date() },
      $setOnInsert: { _id: new ObjectId(), organizationId },
    },
    { upsert: true }
  );
}

/**
 * Pure: collapse a set of org postures + an org→members map into a per-country
 * `metricId → summed delta` map. Postures at `standard` (empty effect) contribute
 * nothing; a country in several alliances accumulates them. Keyed by bare
 * metricId; the caller resolves each to a node id before merging into
 * `targetNudges`.
 */
export function buildPostureNudgesByCountry(
  postures: Array<{ organizationId: string; posture: AlertPosture }>,
  membersByOrg: Map<string, CountryId[]>
): Map<CountryId, Map<string, number>> {
  const out = new Map<CountryId, Map<string, number>>();
  for (const { organizationId, posture } of postures) {
    const metrics = Object.entries(postureEffect(posture));
    if (metrics.length === 0) continue;
    const members = membersByOrg.get(organizationId) ?? [];
    for (const country of members) {
      let byMetric = out.get(country);
      if (!byMetric) {
        byMetric = new Map<string, number>();
        out.set(country, byMetric);
      }
      for (const [metricId, delta] of metrics) {
        byMetric.set(metricId, (byMetric.get(metricId) ?? 0) + delta);
      }
    }
  }
  return out;
}

/**
 * Load every non-standard org posture and resolve it into a per-country metric-
 * nudge map for the metric turn driver. Empty map when no alliance is on a
 * non-standard footing (the parity / golden-master fast path).
 */
export async function loadActivePostureNudgesByCountry(
  db: Db
): Promise<Map<CountryId, Map<string, number>>> {
  const col = await getOrganizationPosturesCollection(db);
  const rows = await col.find({ posture: { $ne: "standard" } }).toArray();
  if (rows.length === 0) return new Map();

  const membersByOrg = new Map<string, CountryId[]>();
  for (const orgId of new Set(rows.map((r) => r.organizationId))) {
    // Metric nudges only reach countries the simulation actually models; a
    // macro-tier member has no metrics to nudge.
    membersByOrg.set(
      orgId,
      (await getMembers(db, orgId)).filter((id): id is CountryId => id in COUNTRY_CONFIGS)
    );
  }
  return buildPostureNudgesByCountry(
    rows.map((r) => ({ organizationId: r.organizationId, posture: r.posture })),
    membersByOrg
  );
}
