/**
 * Load the live supply agreements one corporation turn settles, after retiring
 * the ones whose cancellation notice has expired.
 *
 * Split out of the corporation turn so the agreement bookkeeping (scope keys,
 * the legacy state-local guard, the grandfather stamp) has one home.
 */

import type { Db, ObjectId } from "mongodb";
import type { CommodityType } from "@/lib/constants/commodities";
import { clampAgreementPremium, type SupplyAgreement } from "@/lib/db/types/supplyAgreement";
import {
  isStateScopedCommodity,
  supplyAgreementRequiresState,
  supplyAgreementScopeKey,
} from "@/lib/market/commodityMarketScope";
import { migrateStateScopedSupplyAgreements } from "./migrateStateScopedSupplyAgreements";
import type { SettleableSupplyAgreement } from "./settleSupplyAgreements";

/**
 * Keys a located sector's output is credited under for contract settlement:
 * always the bare commodity (corporation-wide contracts), plus
 * `commodity@stateId` when the commodity is state-scoped and the sector has a
 * state, so a state contract is measured against that state's plants alone.
 */
export function contractScopeKeysFor(
  commodity: CommodityType,
  stateId: string | undefined
): string[] {
  if (stateId && supplyAgreementRequiresState(commodity)) {
    return [commodity, supplyAgreementScopeKey(commodity, stateId)];
  }
  return [commodity];
}

type LiveAgreementDoc = {
  _id: ObjectId;
  supplierCorpId: ObjectId;
  buyerCorpId: ObjectId;
  commodity: CommodityType;
  stateId?: string;
  volumeCap: number;
  pricePremium?: number;
  volumeCapBasis?: SupplyAgreement["volumeCapBasis"];
  lastDeliveryTurn?: number;
  lastDeliveredUnits?: number;
  lastBuyerConsumptionUnits?: number;
  previousDeliveryTurn?: number;
  previousDeliveredUnits?: number;
  previousBuyerConsumptionUnits?: number;
  lastDamagesNoticeTurn?: number;
};

export async function loadSettleableSupplyAgreements(args: {
  db: Db;
  turn: number;
  now: Date;
}): Promise<{
  agreements: SettleableSupplyAgreement[];
  /**
   * True while a LEGACY agreement for a state-local commodity (one signed
   * before contracts named their state) is still live. Such a contract has no
   * state identity and must finish under the legacy national book rather than
   * being silently reinterpreted or broken mid-contract. A state-scoped
   * agreement never trips this.
   */
  legacyStateLocalAgreementLive: boolean;
}> {
  const { db, turn, now } = args;
  // C6: a contract under NOTICE keeps delivering and settling until its
  // effective turn. Retire the ones whose notice has run out first, then load
  // everything still live. Ordering matters, a contract that expires this
  // turn must not settle again.
  const agreementMigration = await migrateStateScopedSupplyAgreements({
    agreements: db.collection<SupplyAgreement>("supplyAgreements"),
    turn,
    now,
  });
  if (agreementMigration.noticeServed > 0 || agreementMigration.pendingCancelled > 0) {
    console.info(
      `[corporationTurn] retiring corporation-wide state-local agreements: ` +
        `${agreementMigration.noticeServed} given notice, ` +
        `${agreementMigration.pendingCancelled} pending withdrawn`
    );
  }
  const docs = (await db
    .collection("supplyAgreements")
    .find(
      { status: { $in: ["active", "cancelling"] } },
      {
        projection: {
          supplierCorpId: 1,
          buyerCorpId: 1,
          commodity: 1,
          stateId: 1,
          volumeCap: 1,
          pricePremium: 1,
          volumeCapBasis: 1,
          lastDeliveryTurn: 1,
          lastDeliveredUnits: 1,
          lastBuyerConsumptionUnits: 1,
          previousDeliveryTurn: 1,
          previousDeliveredUnits: 1,
          previousBuyerConsumptionUnits: 1,
          lastDamagesNoticeTurn: 1,
        },
      }
    )
    .toArray()) as unknown as LiveAgreementDoc[];

  let legacyStateLocalAgreementLive = false;
  const agreements: SettleableSupplyAgreement[] = [];
  for (const a of docs) {
    if (isStateScopedCommodity(a.commodity) && !a.stateId) {
      legacyStateLocalAgreementLive = true;
    }
    agreements.push({
      agreementId: a._id?.toString(),
      supplierCorpId: a.supplierCorpId.toString(),
      buyerCorpId: a.buyerCorpId.toString(),
      commodity: a.commodity,
      ...(a.stateId ? { stateId: a.stateId } : {}),
      volumeCap: Math.max(0, a.volumeCap ?? 0),
      pricePremium: clampAgreementPremium(a.pricePremium ?? 0),
      // Shortfall damages only apply to contracts whose `volumeCap` was
      // checked against scaled plant capacity when it was signed. Contracts
      // predating that check carry no basis, so they settle their price
      // premium as usual and are grandfathered out of the damages leg, see
      // the stamp in corporations/commands/supplyAgreements.
      shortfallEligible: a.volumeCapBasis === "scaledCapacity",
      lastDeliveryTurn: a.lastDeliveryTurn,
      lastDeliveredUnits: a.lastDeliveredUnits,
      lastBuyerConsumptionUnits: a.lastBuyerConsumptionUnits,
      previousDeliveryTurn: a.previousDeliveryTurn,
      previousDeliveredUnits: a.previousDeliveredUnits,
      previousBuyerConsumptionUnits: a.previousBuyerConsumptionUnits,
      lastDamagesNoticeTurn: a.lastDamagesNoticeTurn,
    });
  }
  if (legacyStateLocalAgreementLive) {
    console.warn(
      "[corporationTurn] state-local clearing deferred: a legacy state-local supply agreement is still live"
    );
  }
  return { agreements, legacyStateLocalAgreementLive };
}
