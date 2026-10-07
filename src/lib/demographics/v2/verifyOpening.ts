import { createHash } from "node:crypto";
import type { Db } from "mongodb";
import type { RegionDemographics } from "@/lib/db/types/regionDemographics";
import type { State } from "@/lib/db/types/state";
import type { CountryId } from "@/lib/constants/countries";
import { RESET_V2_SEED_REVISION, type ResetSystemSeedReceipt } from "@/lib/resetVersions/rules";

const OPENING_COUNTRIES = ["US", "UK", "JP"] as const;

function validVector(values: readonly number[]): boolean {
  return (
    values.length === 101 &&
    values.every((value) => Number.isFinite(value) && value >= 0) &&
    values.some((value) => value > 0)
  );
}

/**
 * Certify that the reset produced the live population stock Demographics v2
 * consumes. This does not write a second demographic board.
 */
export async function verifyDemographicsV2Opening(
  db: Db,
  worldId: string,
  sourceTurn: number,
  countries: readonly CountryId[] = OPENING_COUNTRIES
): Promise<ResetSystemSeedReceipt> {
  const [docs, populatedRegions] = await Promise.all([
    db
      .collection<RegionDemographics>("regionDemographics")
      .find(
        { countryId: { $in: [...countries] } },
        { projection: { _id: 1, countryId: 1, ages: 1, lastUpdated: 1 } }
      )
      .sort({ countryId: 1, _id: 1 })
      .toArray(),
    db
      .collection<State>("states")
      .find(
        { countryId: { $in: [...countries] }, population: { $gt: 0 } },
        { projection: { _id: 1, countryId: 1 } }
      )
      .sort({ countryId: 1, _id: 1 })
      .toArray(),
  ]);

  for (const countryId of countries) {
    if (!populatedRegions.some((region) => region.countryId === countryId)) {
      throw new Error(`Demographics v2 opening has no populated regions for ${countryId}`);
    }
  }
  const vectorIds = new Set(docs.map((doc) => doc._id));
  const missingRegions = populatedRegions
    .filter((region) => !vectorIds.has(region._id))
    .map((region) => region._id);
  if (missingRegions.length > 0) {
    throw new Error(
      `Demographics v2 opening is missing live population vectors for: ${missingRegions.join(", ")}`
    );
  }
  for (const doc of docs) {
    if (!validVector(doc.ages.male) || !validVector(doc.ages.female)) {
      throw new Error(`Demographics v2 opening has an invalid age vector for ${doc._id}`);
    }
    if (!(doc.lastUpdated instanceof Date) || !Number.isFinite(doc.lastUpdated.getTime())) {
      throw new Error(`Demographics v2 opening has no valid update time for ${doc._id}`);
    }
  }

  const verificationHash = createHash("sha256")
    .update(
      JSON.stringify(
        docs.map((doc) => ({
          id: doc._id,
          countryId: doc.countryId,
          male: doc.ages.male,
          female: doc.ages.female,
        }))
      )
    )
    .digest("hex");

  return {
    worldId,
    revision: RESET_V2_SEED_REVISION.demographics,
    sourceTurn,
    completedAt: new Date().toISOString(),
    verificationHash,
    countries: [...countries],
  };
}
