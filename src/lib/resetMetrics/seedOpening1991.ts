/** Persistence shell for the 1991 v2 metric opening. Never writes v1 metrics. */
import { createHash } from "node:crypto";
import type { Db } from "mongodb";
import type { State } from "@/lib/db/types/state";
import type { ResetSystemSeedReceipt } from "@/lib/resetVersions/rules";
import { RESET_V2_SEED_REVISION } from "@/lib/resetVersions/rules";
import {
  auditOpeningMetricSources,
  auditOpeningNationalMetricSources1991,
} from "./openingSeed1991";
import {
  buildResetMetricSnapshot,
  resetMetricSnapshotPayload,
  type ResetMetricSnapshot,
} from "./rules/snapshot";

export function buildOpeningMetricSnapshots1991(
  worldId: string,
  sourceTurn: number
): ResetMetricSnapshot[] {
  const national = auditOpeningNationalMetricSources1991();
  const regional = auditOpeningMetricSources();
  const rows = (["US", "UK", "JP"] as const).map((countryId) =>
    buildResetMetricSnapshot({
      worldId,
      countryId,
      sourceTurn,
      observations: national[countryId],
    })
  );
  for (const region of regional) {
    rows.push(
      buildResetMetricSnapshot({
        worldId,
        countryId: region.country,
        regionId: region.regionId,
        sourceTurn,
        observations: region.openingObservations,
      })
    );
  }
  if (rows.length !== 74 || new Set(rows.map((row) => row._id)).size !== rows.length) {
    throw new Error(
      "The 1991 v2 metric opening must contain three national and 71 regional boards"
    );
  }
  return rows;
}

/** Bulk-write then read back every board before issuing a world-bound receipt. */
export async function seedOpeningMetrics1991(
  db: Db,
  worldId: string,
  sourceTurn: number
): Promise<ResetSystemSeedReceipt> {
  const expected = buildOpeningMetricSnapshots1991(worldId, sourceTurn);
  const seededRegions = await db
    .collection<State>("states")
    .find({ countryId: { $in: ["US", "UK", "JP"] } }, { projection: { _id: 1, countryId: 1 } })
    .toArray();
  const expectedRegionKeys = expected
    .filter((row) => row.scope === "regional")
    .map((row) => row._id)
    .sort();
  const seededRegionKeys = seededRegions.map((row) => `${row.countryId}:${row._id}`).sort();
  if (JSON.stringify(seededRegionKeys) !== JSON.stringify(expectedRegionKeys)) {
    throw new Error("The seeded 1991 regions do not match the v2 metric opening catalog");
  }
  const collection = db.collection<ResetMetricSnapshot>("resetMetricSnapshots");
  await collection.bulkWrite(
    expected.map((row) => ({
      replaceOne: { filter: { _id: row._id }, replacement: row, upsert: true },
    })),
    { ordered: true }
  );
  const persisted = await collection
    .find(
      {},
      {
        projection: {
          _id: 1,
          worldId: 1,
          countryId: 1,
          scope: 1,
          regionId: 1,
          sourceTurn: 1,
          asOfTurn: 1,
          observations: 1,
          history: 1,
        },
      }
    )
    .toArray();
  const expectedPayload = resetMetricSnapshotPayload(expected);
  if (
    persisted.length !== expected.length ||
    resetMetricSnapshotPayload(persisted) !== expectedPayload
  ) {
    throw new Error("The persisted 1991 v2 metric opening failed readback verification");
  }
  return {
    worldId,
    revision: RESET_V2_SEED_REVISION.metrics,
    sourceTurn,
    completedAt: new Date().toISOString(),
    verificationHash: createHash("sha256").update(expectedPayload).digest("hex"),
  };
}
