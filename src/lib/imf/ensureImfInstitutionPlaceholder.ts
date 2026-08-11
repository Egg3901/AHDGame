/**
 * Ensure a placeholder IMF Institution corporation exists (no Board yet).
 *
 * Used by `resetGameWorld` so the IMF Corp document exists immediately after
 * a fresh world reset. Admin assigns Board members later via the standard
 * Post Reset Checklist IMF seed form (which calls `seedImfInstitution` in repair
 * mode).
 *
 * Why placeholder, not full seed? `seedImfInstitution` requires two distinct
 * Character holders (with userIds). Reset wipes/retires all characters via
 * `retireCharacter` → there are zero playable characters immediately after
 * reset. Creating a stub now lets the rest of the subsystem function (the
 * IMF page renders "Board members: None seeded"; bailout orchestrators can
 * still reference imfCorp._id; trade/news consumers gracefully handle empty
 * shareholders) until an admin assigns Board.
 */
import type { Db } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import { getNextSequentialId } from "@/lib/db/sequentialId";
import { DEFAULT_SHARE_PRICE, CEO_INITIAL_SHARES } from "@/lib/constants/corporations";
import { getEraFounderShares } from "@/lib/constants/sectorSeedEra";
import { getGameStatePresetOrDefault } from "@/lib/db/collections/gameState";

export interface EnsureImfPlaceholderResult {
  corporationId: string;
  created: boolean;
  sequentialId?: number;
}

export async function ensureImfInstitutionPlaceholder(db: Db): Promise<EnsureImfPlaceholderResult> {
  const existing = await db
    .collection<Corporation>("corporations")
    .findOne({ imfInstitution: true });
  if (existing) {
    return {
      corporationId: existing._id.toString(),
      created: false,
      sequentialId: existing.sequentialId,
    };
  }

  const sequentialId = await getNextSequentialId(db, "corporation");
  const now = new Date();
  // Placeholder shape: ceoVacant + empty shareholders + no userId/ceoId fields.
  // `seedImfInstitution` (admin Post Reset Checklist form) repairs ownership when
  // Board members are assigned. The Corporation type requires ceoId/userId
  // as ObjectIds; we omit them here and cast to allow insertion. Consumers
  // (IMF page, board override, bailout orchestrator) all handle empty
  // shareholders gracefully — they just see "no Board" until repair.
  const doc = {
    name: "International Monetary Fund",
    description:
      "IMF institution. Admin must assign Board members via System → Post Reset Checklist.",
    type: "financial" as const,
    countryId: "US",
    headquartersState: "DC",
    ceoVacant: true,
    // Era share base, so the placeholder's cap table matches every other
    // corporation minted in this world (no holders and price is the default,
    // so this is consistency rather than an economic change).
    totalShares: getEraFounderShares(CEO_INITIAL_SHARES, await getGameStatePresetOrDefault(db)),
    shareholders: [],
    updatedAt: now,
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
    .insertOne(doc as unknown as Corporation);
  return { corporationId: insertedId.toString(), created: true, sequentialId };
}
