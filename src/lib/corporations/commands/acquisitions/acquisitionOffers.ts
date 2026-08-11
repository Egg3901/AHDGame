import { ObjectId, type Db } from "mongodb";
import type { CentralBank, Corporation, CorporateSector } from "@/lib/db/types";
import type { AcquisitionOffer, AcquisitionOfferStatus } from "@/lib/db/types/acquisitionOffer";
import { buildPrimeRateMap } from "@/lib/bonds/corporateBondDefault";
import { sectorExitValueAnchor } from "@/lib/bonds/sectorExitBasis";
import { getMarketSystemModeForDb, marketAtLeast } from "@/lib/market/featureFlag";
import { getGameState } from "@/lib/gameState";
import { computeWholeCorpValuation } from "@/lib/nationalization/compensation";
import {
  corpLiquidCapitalToAnchor,
  getCorpFxRate,
  loadFxRatesByCurrency,
} from "@/lib/currency/corporationCapital";
import { createNotification } from "@/lib/notifications";
import { executeAgreedAcquisition } from "./executeAgreedAcquisition";
import { loadWorldEraUnitScale } from "@/lib/currency/gdpAnchorRate";

export const ACQUISITION_OFFER_DURATION_TURNS = 24;
const OFFERS = "acquisitionOffers";

type Result<T = object> = { ok: false; error: string; status: number } | ({ ok: true } & T);

/** Canonical whole-corp reference valuation (₳) for display + a fair-value anchor. */
export async function referenceValuationAnchor(db: Db, target: Corporation): Promise<number> {
  const [sectors, centralBanks, fxByCurrency, targetFxRate, marketMode, gameState] =
    await Promise.all([
      db
        .collection<CorporateSector>("corporateSectors")
        .find({ corporationId: target._id })
        .toArray(),
      db.collection<CentralBank>("centralBanks").find({}).toArray(),
      loadFxRatesByCurrency(db),
      getCorpFxRate(db, target),
      getMarketSystemModeForDb(db),
      getGameState(db),
    ]);
  const primeMap = buildPrimeRateMap(centralBanks);
  // D11 — the sector leg of balance-sheet equity is replacement-cost BOOK under
  // plants. An acquirer buying a corp whose value is its plants must be quoted
  // the plants, not a capitalized earnings stream that the same tier already
  // stopped using for every other exit (dissolution, restructuring, taking).
  const sectorNpvAnchor = sectorExitValueAnchor(sectors, primeMap, target, fxByCurrency, {
    plantsEnabled: marketAtLeast(marketMode, "plants"),
    currentYear: gameState?.currentYear,
    eraUnitScale: await loadWorldEraUnitScale(db),
    excludeGrowthCost: true,
  });
  const liquidCapitalAnchor = corpLiquidCapitalToAnchor(
    target.liquidCapital ?? 0,
    target,
    targetFxRate
  );
  const sharePriceAnchor = corpLiquidCapitalToAnchor(target.sharePrice ?? 0, target, targetFxRate);
  return computeWholeCorpValuation({
    sharePrice: sharePriceAnchor,
    totalShares: target.totalShares ?? 0,
    balanceSheetEquity: liquidCapitalAnchor + sectorNpvAnchor,
    debt: 0, // v1 blocks bonded targets, so no debt to net out
  });
}

export async function proposeAcquisitionOffer(
  db: Db,
  input: {
    acquirer: Corporation;
    target: Corporation;
    priceAnchor: number;
    proposerCharacterId: ObjectId;
    proposerUserId?: ObjectId;
    currentTurn: number;
  }
): Promise<Result<{ offerId: ObjectId; targetValuationAnchor: number }>> {
  const { acquirer, target, priceAnchor, proposerCharacterId, proposerUserId, currentTurn } = input;

  if (acquirer._id.equals(target._id))
    return { ok: false, error: "A corporation cannot acquire itself", status: 400 };
  if (target.countryOwnerId || target.ownershipState === "stateOwned")
    return { ok: false, error: "State-owned corporations cannot be acquired", status: 400 };
  if (!Number.isFinite(priceAnchor) || priceAnchor <= 0)
    return { ok: false, error: "Offer price must be a positive amount", status: 400 };

  const existing = await db.collection<AcquisitionOffer>(OFFERS).findOne({
    acquirerCorporationId: acquirer._id,
    targetCorporationId: target._id,
    status: "pending",
  });
  if (existing)
    return {
      ok: false,
      error: "You already have a pending acquisition offer for this corporation.",
      status: 409,
    };

  const targetValuationAnchor = await referenceValuationAnchor(db, target);
  const now = new Date();
  const res = await db.collection<AcquisitionOffer>(OFFERS).insertOne({
    acquirerCorporationId: acquirer._id,
    targetCorporationId: target._id,
    proposedByCharacterId: proposerCharacterId,
    ...(proposerUserId ? { proposedByUserId: proposerUserId } : {}),
    priceAnchor: Math.round(priceAnchor),
    targetValuationAnchor: Math.round(targetValuationAnchor),
    status: "pending",
    createdAtTurn: currentTurn,
    expiresAtTurn: currentTurn + ACQUISITION_OFFER_DURATION_TURNS,
    createdAt: now,
    updatedAt: now,
  } as AcquisitionOffer);

  // Notify the target's CEO (if a player controls it).
  if (target.userId) {
    void createNotification({
      userId: target.userId,
      type: "corp_vote_opened",
      title: "Acquisition offer received",
      message: `${acquirer.name} has offered to acquire ${target.name}. Review it in the Deals tab.`,
      metadata: {
        acquisitionOfferId: res.insertedId.toHexString(),
        corporationId: target._id.toHexString(),
      },
    });
  }

  return {
    ok: true,
    offerId: res.insertedId,
    targetValuationAnchor: Math.round(targetValuationAnchor),
  };
}

export async function acceptAcquisitionOffer(
  db: Db,
  input: { offer: AcquisitionOffer; currentTurn: number }
): Promise<
  Result<{ sectorsMoved: number; priceAnchor: number; acquirerName: string; targetName: string }>
> {
  const { offer, currentTurn } = input;
  const offers = db.collection<AcquisitionOffer>(OFFERS);

  if (offer.status !== "pending")
    return { ok: false, error: "This offer is no longer open", status: 409 };
  if (currentTurn > offer.expiresAtTurn)
    return { ok: false, error: "This offer has expired", status: 400 };

  // Atomic claim: only the winner of the pending→accepted transition executes.
  const now = new Date();
  const claim = await offers.updateOne(
    { _id: offer._id, status: "pending" },
    { $set: { status: "accepted", resolvedAtTurn: currentTurn, updatedAt: now } }
  );
  if (claim.matchedCount === 0)
    return { ok: false, error: "This offer is no longer open", status: 409 };

  let result;
  try {
    result = await executeAgreedAcquisition({ db, offer, currentTurn });
  } catch (err) {
    // Executor threw after refunding the acquirer — release the claim so it can be retried.
    await offers.updateOne(
      { _id: offer._id },
      { $set: { status: "pending", updatedAt: new Date() }, $unset: { resolvedAtTurn: "" } }
    );
    throw err;
  }
  if (!result.ok) {
    await offers.updateOne(
      { _id: offer._id },
      { $set: { status: "pending", updatedAt: new Date() }, $unset: { resolvedAtTurn: "" } }
    );
    return result;
  }

  // The target is gone — withdraw every other pending offer that referenced it.
  await offers.updateMany(
    {
      _id: { $ne: offer._id },
      status: "pending",
      $or: [
        { targetCorporationId: offer.targetCorporationId },
        { acquirerCorporationId: offer.targetCorporationId },
      ],
    },
    { $set: { status: "withdrawn", updatedAt: now } }
  );

  return result;
}

export async function resolveAcquisitionOfferStatus(
  db: Db,
  offer: AcquisitionOffer,
  status: Extract<AcquisitionOfferStatus, "rejected" | "withdrawn">,
  currentTurn: number
): Promise<Result> {
  if (offer.status !== "pending")
    return { ok: false, error: "This offer is no longer open", status: 409 };
  const claim = await db
    .collection<AcquisitionOffer>(OFFERS)
    .updateOne(
      { _id: offer._id, status: "pending" },
      { $set: { status, resolvedAtTurn: currentTurn, updatedAt: new Date() } }
    );
  if (claim.matchedCount === 0)
    return { ok: false, error: "This offer is no longer open", status: 409 };
  return { ok: true };
}

export interface DealSummary {
  offerId: string;
  acquirerCorporationId: string;
  acquirerName: string;
  targetCorporationId: string;
  targetName: string;
  priceAnchor: number;
  targetValuationAnchor: number;
  status: AcquisitionOfferStatus;
  expiresAtTurn: number;
}

/** Pending incoming (offers to buy THIS corp) + outgoing (offers THIS corp made). */
export async function listDealsForCorp(
  db: Db,
  corpId: ObjectId
): Promise<{ incoming: DealSummary[]; outgoing: DealSummary[] }> {
  const offers = await db
    .collection<AcquisitionOffer>(OFFERS)
    .find({
      status: "pending",
      $or: [{ targetCorporationId: corpId }, { acquirerCorporationId: corpId }],
    })
    .sort({ createdAt: -1 })
    .toArray();
  if (offers.length === 0) return { incoming: [], outgoing: [] };

  const corpIds = new Set<string>();
  for (const o of offers) {
    corpIds.add(o.acquirerCorporationId.toString());
    corpIds.add(o.targetCorporationId.toString());
  }
  const corps = (await db
    .collection<Corporation>("corporations")
    .find({ _id: { $in: [...corpIds].map((id) => new ObjectId(id)) } })
    .project({ name: 1 })
    .toArray()) as Array<{ _id: ObjectId; name: string }>;
  const nameById = new Map(corps.map((c) => [c._id.toString(), c.name]));
  const nameOf = (id: ObjectId) => nameById.get(id.toString()) ?? "(unknown)";

  const toSummary = (o: AcquisitionOffer): DealSummary => ({
    offerId: o._id.toString(),
    acquirerCorporationId: o.acquirerCorporationId.toString(),
    acquirerName: nameOf(o.acquirerCorporationId),
    targetCorporationId: o.targetCorporationId.toString(),
    targetName: nameOf(o.targetCorporationId),
    priceAnchor: o.priceAnchor,
    targetValuationAnchor: o.targetValuationAnchor,
    status: o.status,
    expiresAtTurn: o.expiresAtTurn,
  });

  const idStr = corpId.toString();
  return {
    incoming: offers.filter((o) => o.targetCorporationId.toString() === idStr).map(toSummary),
    outgoing: offers.filter((o) => o.acquirerCorporationId.toString() === idStr).map(toSummary),
  };
}
