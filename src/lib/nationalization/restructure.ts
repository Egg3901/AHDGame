import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import type { Corporation, CorporateSector } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import type { CorporationType } from "@/lib/constants/corporations";
import {
  buildNationalCorporationDoc,
  ensurePrimaryNationalCorporation,
} from "./nationalCorporation";

/**
 * Split-off & merge-back of National Corporation sector types (spec §24.2).
 * Both are **state-internal reorganizations** — money-neutral (no compensation;
 * a National Corporation has no private shareholders). Authorization is the
 * caller's responsibility (route uses `assertTreasuryAuthority`).
 */

export interface SplitOffParams {
  countryId: CountryId;
  sectorType: CorporationType;
  /** Name for the new secondary National Corporation (validated by the caller). */
  newCorpName: string;
}

export interface SplitOffResult {
  newNationalCorporationId: ObjectId;
  sectorsMoved: number;
}

/** All National Corporation ids for a country (primary + any split-offs). */
async function nationalCorporationIds(db: Db, countryId: CountryId): Promise<ObjectId[]> {
  const corps = await db
    .collection<Corporation>("corporations")
    .find({ countryOwnerId: countryId })
    .project<{ _id: ObjectId }>({ _id: 1 })
    .toArray();
  return corps.map((c) => c._id);
}

/**
 * Carve a sector type into a new secondary National Corporation. Moves every
 * sector of that type currently held by ANY of the country's National
 * Corporations into the new corp (full type only — no partial %). Pre-claim is
 * allowed: with zero current sectors the corp is still created and now owns
 * routing for that type. Rejects if a split-off already claims the type.
 */
export async function splitOffSectorType(db: Db, params: SplitOffParams): Promise<SplitOffResult> {
  const now = new Date();
  const corps = db.collection<Corporation>("corporations");
  const name = params.newCorpName.trim();
  if (name.length < 2) throw new Error("New National Corporation name is too short");

  // One National Corporation per sector type per country.
  const existingClaim = await corps.findOne({
    countryOwnerId: params.countryId,
    assignedSectorTypes: params.sectorType,
  });
  if (existingClaim) {
    throw new Error(`A National Corporation already owns the ${params.sectorType} sector type`);
  }

  // Ensure the primary exists (so the country has a coherent NatCorp set first).
  await ensurePrimaryNationalCorporation(db, params.countryId);

  const doc = buildNationalCorporationDoc(params.countryId, {
    name,
    isPrimaryNationalCorporation: false,
    assignedSectorTypes: [params.sectorType],
  });
  const insert = await corps.insertOne(doc as Corporation);
  const newId = insert.insertedId;

  // Move all sectors of this type held by any of the country's NatCorps.
  const natCorpIds = await nationalCorporationIds(db, params.countryId);
  const fromIds = natCorpIds.filter((id) => !id.equals(newId));
  let sectorsMoved = 0;
  if (fromIds.length > 0) {
    const res = await db
      .collection<CorporateSector>("corporateSectors")
      .updateMany(
        { corporationId: { $in: fromIds }, sectorType: params.sectorType },
        { $set: { corporationId: newId, updatedAt: now } }
      );
    sectorsMoved = res.modifiedCount ?? 0;
  }

  return { newNationalCorporationId: newId, sectorsMoved };
}

export interface MergeBackParams {
  countryId: CountryId;
  sectorType: CorporationType;
  /** Target NatCorp to fold into; defaults to the primary. */
  intoCorpId?: ObjectId;
}

export interface MergeBackResult {
  targetNationalCorporationId: ObjectId;
  dissolvedNationalCorporationId: ObjectId;
  sectorsMoved: number;
}

/**
 * Fold a split-off's sector type back into another National Corporation
 * (default: the primary) and dissolve the now-empty split-off shell. No
 * shareholder payout (a NatCorp has none) and no sector-restore-to-unowned
 * (sectors are moved, not abandoned).
 */
export async function mergeBackSectorType(
  db: Db,
  params: MergeBackParams
): Promise<MergeBackResult> {
  const now = new Date();
  const corps = db.collection<Corporation>("corporations");

  // The split-off owning this type (never the primary — primary has empty
  // assignedSectorTypes, so this query can only match a secondary).
  const splitOff = await corps.findOne({
    countryOwnerId: params.countryId,
    assignedSectorTypes: params.sectorType,
    isPrimaryNationalCorporation: { $ne: true },
  });
  if (!splitOff) {
    throw new Error(`No split-off National Corporation owns the ${params.sectorType} sector type`);
  }

  // Resolve the target: explicit corp (must be a NatCorp of this country) or primary.
  let target: Corporation;
  if (params.intoCorpId) {
    if (params.intoCorpId.equals(splitOff._id)) {
      throw new Error("Cannot merge a National Corporation into itself");
    }
    const into = await corps.findOne({
      _id: params.intoCorpId,
      countryOwnerId: params.countryId,
    });
    if (!into) throw new Error("Target National Corporation not found for this country");
    target = into;
  } else {
    target = await ensurePrimaryNationalCorporation(db, params.countryId);
  }

  // Move the split-off's sectors into the target.
  const res = await db
    .collection<CorporateSector>("corporateSectors")
    .updateMany(
      { corporationId: splitOff._id },
      { $set: { corporationId: target._id, updatedAt: now } }
    );
  const sectorsMoved = res.modifiedCount ?? 0;

  // If the target is a split-off, it now also owns this type; if it's the
  // primary, the type reverts to the remainder (primary keeps assignedSectorTypes empty).
  if (!target.isPrimaryNationalCorporation) {
    await corps.updateOne(
      { _id: target._id },
      { $addToSet: { assignedSectorTypes: params.sectorType }, $set: { updatedAt: now } }
    );
  }

  // Dissolve the emptied split-off shell (no payout, no restore).
  await corps.deleteOne({ _id: splitOff._id });

  return {
    targetNationalCorporationId: target._id,
    dissolvedNationalCorporationId: splitOff._id,
    sectorsMoved,
  };
}
