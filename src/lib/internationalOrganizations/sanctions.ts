import { ObjectId, type Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { CommodityType } from "@/lib/constants/commodities";
import type { TradeEmbargo } from "@/lib/db/types/tradeEmbargo";

const EMBARGO_COLLECTION = "tradeEmbargoes";

/**
 * Build the org-origin embargo documents a passed sanctions resolution enacts:
 * every member except the target embargoes the target on the chosen commodity
 * (block, both directions, durable until the resolution is repealed). Pure — no
 * DB — so the fan-out is unit-testable.
 */
export function buildOrganizationSanctionEmbargoes(params: {
  resolutionId: ObjectId;
  targetCountryId: CountryId;
  commodity: CommodityType | "all";
  members: CountryId[];
  createdBy: ObjectId;
  currentTurn: number;
  /** Turn the embargoes lift; omitted = durable until repealed. */
  expiresTurn?: number;
}): TradeEmbargo[] {
  const { resolutionId, targetCountryId, commodity, members, createdBy, currentTurn, expiresTurn } =
    params;
  return members
    .filter((m) => m !== targetCountryId)
    .map((m) => ({
      _id: new ObjectId(),
      sourceCountry: m,
      targetCountry: targetCountryId,
      commodity,
      direction: "both" as const,
      mode: "block" as const,
      origin: "organization" as const,
      ...(expiresTurn !== undefined ? { expiresTurn } : {}),
      createdTurn: currentTurn,
      createdBy,
      sourceResolutionId: resolutionId,
    }));
}

/** Insert the org-origin embargoes for a passed sanctions resolution. */
export async function applyOrganizationSanctions(
  db: Db,
  params: {
    resolutionId: ObjectId;
    targetCountryId: CountryId;
    commodity: CommodityType | "all";
    members: CountryId[];
    createdBy: ObjectId;
    currentTurn: number;
    expiresTurn?: number;
  }
): Promise<number> {
  const embargoes = buildOrganizationSanctionEmbargoes(params);
  if (embargoes.length === 0) return 0;
  await db.collection<TradeEmbargo>(EMBARGO_COLLECTION).insertMany(embargoes);
  return embargoes.length;
}

/** Lift all embargoes a sanctions resolution enacted (on repeal/termination). */
export async function liftOrganizationSanctions(db: Db, resolutionId: ObjectId): Promise<void> {
  await db
    .collection<TradeEmbargo>(EMBARGO_COLLECTION)
    .deleteMany({ origin: "organization", sourceResolutionId: resolutionId });
}
