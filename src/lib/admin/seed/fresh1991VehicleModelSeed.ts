import type { Db } from "mongodb";
import type { GameConfig } from "@/lib/db/types/gameConfig";

export interface Fresh1991VehicleSeedMarker {
  preset: "1991-default";
  schema: "manufacturing-vehicles-v1";
  status: "in_progress" | "complete";
  startedAt: Date;
}

const REQUIRED_EMPTY_COLLECTIONS = [
  "corporations",
  "corporateSectors",
  "unownedSectors",
  "unions",
  "indexFunds",
  "indexFundPositions",
] as const;

/**
 * Preflight/authorize the fresh 1991 vehicle seed. It is intentionally opt-in
 * from the full reset path and never migrates an already populated world.
 * Dry-run is the default for callers using this helper directly.
 */
export async function prepareFresh1991VehicleModelSeed(
  db: Db,
  options: {
    enabled: boolean;
    preset: string;
    resetReference: boolean;
    dryRun?: boolean;
  }
): Promise<{ enabled: boolean; ready: boolean; resumed: boolean; counts: Record<string, number> }> {
  if (!options.enabled) {
    return { enabled: false, ready: false, resumed: false, counts: {} };
  }
  if (options.preset !== "1991-default" || !options.resetReference) {
    throw new Error("Fresh vehicle-model seeding requires an explicit 1991 reference reset");
  }

  const config = await db.collection<GameConfig>("gameConfig").findOne({ _id: "default" });
  const previous = config?.fresh1991VehicleModelSeed;
  const resumable =
    previous?.preset === "1991-default" &&
    previous.schema === "manufacturing-vehicles-v1" &&
    previous.status === "in_progress";
  const counts = Object.fromEntries(
    await Promise.all(
      REQUIRED_EMPTY_COLLECTIONS.map(async (name) => [
        name,
        await db.collection(name).countDocuments(),
      ])
    )
  );

  if (!resumable && Object.values(counts).some((count) => count !== 0)) {
    throw new Error(
      `Fresh vehicle-model seed preflight requires empty economic collections: ${JSON.stringify(counts)}`
    );
  }
  if (options.dryRun !== false) {
    return { enabled: true, ready: true, resumed: resumable, counts };
  }

  await db.collection<GameConfig>("gameConfig").updateOne(
    { _id: "default" },
    {
      $set: {
        fresh1991VehicleModelSeed: {
          preset: "1991-default",
          schema: "manufacturing-vehicles-v1",
          status: "in_progress",
          startedAt: previous?.startedAt ?? new Date(),
        },
      },
    }
  );
  return { enabled: true, ready: true, resumed: resumable, counts };
}

export async function completeFresh1991VehicleModelSeed(
  db: Db,
  requiredWritesSucceeded = true
): Promise<boolean> {
  if (!requiredWritesSucceeded) return false;
  const result = await db.collection<GameConfig>("gameConfig").updateOne(
    {
      _id: "default",
      "fresh1991VehicleModelSeed.schema": "manufacturing-vehicles-v1",
      "fresh1991VehicleModelSeed.status": "in_progress",
    },
    { $set: { "fresh1991VehicleModelSeed.status": "complete" } }
  );
  return result.matchedCount > 0;
}

/** Re-key only canonical rows created after the gate's empty-world preflight. */
export async function convertFresh1991AutomobileSeedRows(
  db: Db
): Promise<{ corporations: number; sectors: number }> {
  const marker = await db
    .collection<GameConfig>("gameConfig")
    .findOne({ _id: "default" }, { projection: { fresh1991VehicleModelSeed: 1 } });
  if (
    marker?.fresh1991VehicleModelSeed?.schema !== "manufacturing-vehicles-v1" ||
    marker.fresh1991VehicleModelSeed.status !== "in_progress"
  ) {
    throw new Error("Vehicle seed conversion requires an in-progress fresh 1991 seed marker");
  }
  const corporations = await db
    .collection("corporations")
    .updateMany(
      { type: "automobiles" },
      { $set: { type: "manufacturing", industryModel: "vehicles" } }
    );
  const sectors = await db
    .collection("corporateSectors")
    .updateMany(
      { sectorType: "automobiles" },
      { $set: { sectorType: "manufacturing", industryModel: "vehicles" } }
    );
  return { corporations: corporations.modifiedCount, sectors: sectors.modifiedCount };
}
