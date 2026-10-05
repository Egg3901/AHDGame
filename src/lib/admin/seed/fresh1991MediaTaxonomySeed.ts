import type { Db } from "mongodb";
import type { GameConfig } from "@/lib/db/types/gameConfig";

const REQUIRED_EMPTY_COLLECTIONS = [
  "corporations",
  "corporateSectors",
  "unownedSectors",
  "unions",
  "indexFunds",
  "indexFundPositions",
] as const;

export interface Fresh1991MediaTaxonomyReport {
  dryRun: boolean;
  corporations: number;
  corporateSectors: number;
  unownedSectors: number;
  unions: number;
  identityConservationDeltas: {
    corporationIds: 0;
    sectorIds: 0;
    unownedMarketIds: 0;
    unionIds: 0;
    fundPositions: 0;
    fundNav: 0;
  };
}

/** Authorize this identity-only conversion only for an empty 1991 reference reset. */
export async function prepareFresh1991MediaTaxonomySeed(
  db: Db,
  options: { enabled: boolean; preset: string; resetReference: boolean; dryRun?: boolean }
): Promise<{ enabled: boolean; ready: boolean; resumed: boolean; counts: Record<string, number> }> {
  if (!options.enabled) return { enabled: false, ready: false, resumed: false, counts: {} };
  if (options.preset !== "1991-default" || !options.resetReference) {
    throw new Error("Fresh media taxonomy seeding requires an explicit 1991 reference reset");
  }

  const config = await db.collection<GameConfig>("gameConfig").findOne({ _id: "default" });
  const previous = config?.fresh1991MediaTaxonomySeed;
  const resumable =
    previous?.preset === "1991-default" &&
    previous.schema === "media-entertainment-taxonomy-v1" &&
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
      `Fresh media taxonomy seed requires empty economic collections: ${JSON.stringify(counts)}`
    );
  }
  if (options.dryRun !== false) return { enabled: true, ready: true, resumed: resumable, counts };

  await db.collection<GameConfig>("gameConfig").updateOne(
    { _id: "default" },
    {
      $set: {
        fresh1991MediaTaxonomySeed: {
          preset: "1991-default",
          schema: "media-entertainment-taxonomy-v1",
          status: "in_progress",
          startedAt: previous?.startedAt ?? new Date(),
        },
      },
    },
    { upsert: true }
  );
  return { enabled: true, ready: true, resumed: resumable, counts };
}

/** Re-key only rows created during the guarded fresh 1991 seed. */
export async function convertFresh1991MediaTaxonomyRows(
  db: Db,
  options: { dryRun?: boolean } = {}
): Promise<Fresh1991MediaTaxonomyReport> {
  const marker = await db
    .collection<GameConfig>("gameConfig")
    .findOne({ _id: "default" }, { projection: { fresh1991MediaTaxonomySeed: 1 } });
  if (
    marker?.fresh1991MediaTaxonomySeed?.schema !== "media-entertainment-taxonomy-v1" ||
    marker.fresh1991MediaTaxonomySeed.status !== "in_progress"
  ) {
    throw new Error("Media taxonomy conversion requires an in-progress fresh 1991 seed marker");
  }

  const counts = await Promise.all([
    db.collection("corporations").countDocuments({ type: "entertainment" }),
    db.collection("corporateSectors").countDocuments({ sectorType: "entertainment" }),
    db.collection("unownedSectors").countDocuments({ sectorType: "entertainment" }),
    db.collection("unions").countDocuments({ sectorType: "entertainment" }),
  ]);
  const [corporations, corporateSectors, unownedSectors, unions] = counts;
  const dryRun = options.dryRun !== false;

  if (!dryRun) {
    const results = await Promise.all([
      db
        .collection("corporations")
        .updateMany(
          { type: "entertainment" },
          { $set: { type: "media", mediaDiscriminator: "entertainment" } }
        ),
      db
        .collection("corporateSectors")
        .updateMany(
          { sectorType: "entertainment" },
          { $set: { sectorType: "media", mediaDiscriminator: "entertainment" } }
        ),
      db
        .collection("unownedSectors")
        .updateMany(
          { sectorType: "entertainment" },
          { $set: { sectorType: "media", mediaDiscriminator: "entertainment" } }
        ),
      db
        .collection("unions")
        .updateMany(
          { sectorType: "entertainment" },
          { $set: { sectorType: "media", mediaDiscriminator: "entertainment" } }
        ),
    ]);
    for (const [index, result] of results.entries()) {
      if (result.modifiedCount !== counts[index]) {
        throw new Error(
          "Fresh media taxonomy row counts changed during apply; retry the marked seed"
        );
      }
    }
  }

  return {
    dryRun,
    corporations,
    corporateSectors,
    unownedSectors,
    unions,
    // Only type/discriminator fields are updated. Stable ids keep stock,
    // shareholder, union, and index-fund references attached to their rows.
    identityConservationDeltas: {
      corporationIds: 0,
      sectorIds: 0,
      unownedMarketIds: 0,
      unionIds: 0,
      fundPositions: 0,
      fundNav: 0,
    },
  };
}

export async function completeFresh1991MediaTaxonomySeed(
  db: Db,
  requiredWritesSucceeded = true
): Promise<boolean> {
  if (!requiredWritesSucceeded) return false;
  const result = await db.collection<GameConfig>("gameConfig").updateOne(
    {
      _id: "default",
      "fresh1991MediaTaxonomySeed.schema": "media-entertainment-taxonomy-v1",
      "fresh1991MediaTaxonomySeed.status": "in_progress",
    },
    { $set: { "fresh1991MediaTaxonomySeed.status": "complete" } }
  );
  return result.matchedCount > 0;
}
