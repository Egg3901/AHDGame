import type { AnyBulkWriteOperation, Db } from "mongodb";
import { logWarning } from "@/lib/utils/errorLog";
import type { StatePolicyRecord } from "@/lib/db/types";

export async function seedStatePolicies(
  db: Db,
  reset: boolean,
  log: (msg: string) => void,
  preset: string
) {
  if (reset)
    await db
      .collection("statePolicies")
      .drop()
      .catch((error) => {
        logWarning("Collection drop failed (may not exist)", {
          component: "AdminSeedRoute",
          action: "drop collection",
          metadata: { error: String(error) },
        });
      });

  const DEPRECATED_TYPE_IDS = ["immigration", "medicare"];

  const cleanupResult = await db
    .collection("statePolicies")
    .deleteMany({ legislationTypeId: { $in: DEPRECATED_TYPE_IDS } });
  if (cleanupResult.deletedCount > 0) {
    log(`Removed ${cleanupResult.deletedCount} policies for deprecated legislation types`);
  }

  const { getBasePolicies } = await import("@/lib/seeds/reference/basePolicies");
  const { legislationTypes } = await import("@/lib/seeds/reference/legislationTypes");
  const { isPoliticalLegislationPreset } = await import("./seedPoliticalLegislation");

  // Old-seed exclusion sweep (political-legislation spec §6): on the 1953
  // deploy preset the OLD US/UK/RU/DD catalogs are unseeded, so their
  // basePolicies records must not seed either (they would write conflicting
  // statePolicies alongside the §7 new-generation baseline).
  const { isOldLegislationTypeExcluded } = await import("@/lib/politicalMetrics/pipelinePreset");
  const excludedOldIds = isPoliticalLegislationPreset(preset)
    ? new Set(legislationTypes.filter(isOldLegislationTypeExcluded).map((lt) => lt._id))
    : new Set<string>();

  const basePolicies = (await getBasePolicies(preset)).filter(
    (r) => !excludedOldIds.has(r.legislationTypeId)
  );

  // Build list of valid policy keys for cleanup
  const validPolicyKeys = new Set<string>();
  const ops: AnyBulkWriteOperation<StatePolicyRecord>[] = [];

  for (const r of basePolicies) {
    const filter =
      r.scope === "national"
        ? {
            scope: "national" as const,
            stateId: r.stateId,
            legislationTypeId: r.legislationTypeId,
          }
        : {
            scope: "state" as const,
            stateId: r.stateId,
            legislationTypeId: r.legislationTypeId,
          };
    const setDoc = {
      scope: r.scope,
      ...(r.stateId != null && { stateId: r.stateId }),
      legislationTypeId: r.legislationTypeId,
      economic: r.economic,
      social: r.social,
      ...(r.policyOptionId != null && { policyOptionId: r.policyOptionId }),
      ...(r.policyOptionIndex != null && { policyOptionIndex: r.policyOptionIndex }),
      effectDirection: r.effectDirection,
      updatedAt: r.updatedAt,
    };
    ops.push({ updateOne: { filter, update: { $set: setDoc }, upsert: true } });

    // Track valid policy key
    const key =
      r.scope === "national"
        ? `national:${r.stateId}:${r.legislationTypeId}`
        : `state:${r.stateId}:${r.legislationTypeId}`;
    validPolicyKeys.add(key);
  }

  // Before the cleanup below, and ordered: `basePolicies` can revisit a
  // (scope, stateId, legislationTypeId) key, so loop order decides the winner.
  if (ops.length > 0) {
    await db.collection<StatePolicyRecord>("statePolicies").bulkWrite(ops, { ordered: true });
  }

  // Generation-aware deleter (political-legislation spec §6, finding #3): the
  // cleanup is country-blind, so without the new-generation id set it would
  // DELETE every §7 baseline record as "stale". New-generation ids are always
  // in the valid set; on the political-legislation preset the excluded old
  // US/UK/RU/DD ids drop OUT of it, so pre-existing conflicting records clean up.
  const { getAllNewGenerationLawIds } = await import("@/lib/politicalLegislation/catalog");
  const validLegTypeIds = [
    ...legislationTypes.filter((lt) => !excludedOldIds.has(lt._id)).map((lt) => lt._id),
    ...getAllNewGenerationLawIds(),
  ];

  // Remove state policies that reference non-existent legislation types
  const deleteResult = await db.collection("statePolicies").deleteMany({
    legislationTypeId: { $nin: validLegTypeIds },
  });
  const staleRemoved = deleteResult.deletedCount || 0;

  log(
    `Seeded ${basePolicies.length} state policy records (preset: ${preset})${staleRemoved > 0 ? `, removed ${staleRemoved} stale entries` : ""}`
  );
}
