import type { Db, ObjectId } from "mongodb";
import type { Corporation, Shareholder } from "@/lib/db/types";
import { getNextSequentialId } from "@/lib/db/sequentialId";
import { CEO_INITIAL_SHARES, DEFAULT_SHARE_PRICE } from "@/lib/constants/corporations";
import { getEraFounderShares } from "@/lib/constants/sectorSeedEra";
import { getGameStatePresetOrDefault } from "@/lib/db/collections/gameState";

export class SeedImfInstitutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SeedImfInstitutionError";
  }
}

export interface SeedImfInstitutionInput {
  /** Must be one of the two starting shareholders. */
  ceoCharacterId: ObjectId;
  /** Exactly two distinct character holders; shares split 50/50. */
  shareholderCharacterIds: [ObjectId, ObjectId];
  /**
   * When an IMF institution document already exists, overwrite CEO, userId, and
   * character shareholders. Does not clear other fields (e.g. liquidCapital).
   */
  repairExisting?: boolean;
}

export interface SeedImfInstitutionResult {
  corporationId: string;
  created: boolean;
  updated: boolean;
  sequentialId?: number;
}

async function requirePlayableCharacter(
  db: Db,
  characterId: ObjectId
): Promise<{ _id: ObjectId; userId: ObjectId }> {
  const doc = await db.collection("characters").findOne({ _id: characterId });
  if (!doc) {
    throw new SeedImfInstitutionError(`Character not found: ${characterId.toHexString()}`);
  }
  if (!doc.userId) {
    throw new SeedImfInstitutionError(
      `Character ${characterId.toHexString()} has no linked user (userId).`
    );
  }
  return { _id: doc._id as ObjectId, userId: doc.userId as ObjectId };
}

/**
 * Creates the singleton IMF institution corporation if missing, or aligns ownership
 * when `repairExisting` and the document already exists. CEO and two equal shareholders
 * are chosen by the admin via {@link SeedImfInstitutionInput}.
 */
export async function seedImfInstitution(
  db: Db,
  input: SeedImfInstitutionInput
): Promise<SeedImfInstitutionResult> {
  const repairExisting = input.repairExisting !== false;
  const [first, second] = input.shareholderCharacterIds;

  if (first.equals(second)) {
    throw new SeedImfInstitutionError("The two shareholders must be different characters.");
  }

  const ceoStr = input.ceoCharacterId.toString();
  if (ceoStr !== first.toString() && ceoStr !== second.toString()) {
    throw new SeedImfInstitutionError("CEO must be one of the two starting shareholders.");
  }

  await requirePlayableCharacter(db, first);
  await requirePlayableCharacter(db, second);
  const ceo = await requirePlayableCharacter(db, input.ceoCharacterId);

  // Era share base, matching every other mint site: a fixed 10M shares would
  // price a 1953 institution below MIN_SHARE_PRICE.
  const issuedShares = getEraFounderShares(
    CEO_INITIAL_SHARES,
    await getGameStatePresetOrDefault(db)
  );
  const halfShares = Math.floor(issuedShares / 2);
  const shareholders: Shareholder[] = [
    { characterId: first, shares: halfShares },
    { characterId: second, shares: halfShares },
  ];

  const existing = await db
    .collection<Corporation>("corporations")
    .findOne({ imfInstitution: true });

  const now = new Date();
  const baseOwnership = {
    ceoId: ceo._id,
    ceoVacant: false,
    userId: ceo.userId,
    totalShares: halfShares * 2,
    shareholders,
    updatedAt: now,
  };

  if (!existing) {
    const sequentialId = await getNextSequentialId(db, "corporation");
    const doc: Omit<Corporation, "_id"> = {
      name: "International Monetary Fund",
      description: "Admin-seeded IMF institution for corporate restructuring.",
      type: "financial",
      countryId: "US",
      ...baseOwnership,
      headquartersState: "DC",
      liquidCapital: 0,
      liquidCurrencyCode: "USD",
      marketingBudget: 0,
      marketingStrength: 0,
      logisticsBudget: 0,
      logisticsStrength: 0,
      ceoSalary: 0,
      sharePrice: DEFAULT_SHARE_PRICE,
      publicFloat: 0,
      sequentialId,
      hiddenFromExchange: true,
      imfInstitution: true,
      createdAt: now,
    };

    const { insertedId } = await db
      .collection<Corporation>("corporations")
      .insertOne(doc as Corporation);
    return {
      corporationId: insertedId.toString(),
      created: true,
      updated: false,
      sequentialId,
    };
  }

  if (!repairExisting) {
    return {
      corporationId: existing._id.toString(),
      created: false,
      updated: false,
      sequentialId: existing.sequentialId,
    };
  }

  const res = await db
    .collection<Corporation>("corporations")
    .updateOne({ _id: existing._id }, { $set: baseOwnership });

  return {
    corporationId: existing._id.toString(),
    created: false,
    updated: res.modifiedCount > 0,
    sequentialId: existing.sequentialId,
  };
}
