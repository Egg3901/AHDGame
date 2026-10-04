import type { Db, Document } from "mongodb";
import type { CorporateSector, Corporation } from "@/lib/db/types/corporation";
import {
  COMMODITY_BASE_PRICES,
  commodityMixWeight,
  embargoSupplyFactorFor,
  scaleMeasuredProducedUnits,
} from "@/lib/constants/commodities";
import {
  getEffectiveStrategyRates,
  plannedEconomyMediaSupplyFactor,
} from "@/lib/constants/sectorStrategies";
import { US_STATE_IDS } from "@/lib/countries/us/data/usStateBaselines";
import { isPlannedEconomy } from "@/lib/constants/commandEconomy";
import { currentTurnDeliveredAdvertisingUnits, type MediaOutletDelivery } from "./rules";
import { loadPoliticalMediaOrdersForClearing } from "@/lib/politicalMedia/journal";

/**
 * Load measured US media delivery for concentration-gated legislation.
 * The query uses the existing stateId + sectorType index and projects only the
 * prior production, sales and strategy fields used to reconstruct delivered ads.
 */
export interface MediaOutletLoadContext {
  currentTurn?: number | null;
  currentYear?: number | null;
  commandEconomyEnabled?: boolean;
  /** Count current-turn political units only after their seller receipt is applied. */
  includeSettledPolitical?: boolean;
}

interface PoliticalSellerReceiptRow extends Document {
  _id: string;
  kind: string;
  status: string;
  turn: number;
  politicalMediaOrderIdentity?: {
    orderId?: string;
    allocationId?: string;
    targetStateId?: string;
    sectorId?: string;
    corporationId?: string;
    units?: number;
  };
}

export async function loadUSMediaOutletDelivery(
  db: Db,
  context: MediaOutletLoadContext = {}
): Promise<MediaOutletDelivery[]> {
  const sectors = await db
    .collection<CorporateSector>("corporateSectors")
    .find(
      {
        stateId: { $in: US_STATE_IDS },
        sectorType: { $in: ["media", "entertainment"] },
      },
      {
        projection: {
          stateId: 1,
          countryId: 1,
          corporationId: 1,
          sectorType: 1,
          strategyId: 1,
          transitionFromStrategyId: 1,
          transitionStartTurn: 1,
          producedUnits: 1,
          outputUnitsByCommodity: 1,
          soldFraction: 1,
          soldByCommodity: 1,
          soldByCommodityTurn: 1,
          embargoSuspended: 1,
          embargoExportExposure: 1,
        },
      }
    )
    .toArray();

  const corporationIds = [
    ...new Map(
      sectors.map((sector) => [sector.corporationId.toString(), sector.corporationId])
    ).values(),
  ];
  const corporations = corporationIds.length
    ? await db
        .collection<Corporation>("corporations")
        .find({ _id: { $in: corporationIds } }, { projection: { countryOwnerId: 1 } })
        .toArray()
    : [];
  const nationalCorporations = new Set(
    corporations
      .filter((corporation) => corporation.countryOwnerId)
      .map((corporation) => corporation._id.toString())
  );

  const plannedPoliticalUnits = new Map<string, number>();
  const plannedPoliticalAllocations = new Map<
    string,
    { units: number; stateId: string; sectorId: string; corporationId: string }
  >();
  if (
    context.includeSettledPolitical &&
    typeof context.currentTurn === "number" &&
    Number.isSafeInteger(context.currentTurn)
  ) {
    const orders = await loadPoliticalMediaOrdersForClearing(db, context.currentTurn as number);
    for (const order of orders) {
      const plan = order.settlementPlan;
      if (!plan || plan.plannedTurn !== context.currentTurn) continue;
      for (const seller of plan.sellers) {
        const key = `${order.identity.targetStateId}:${seller.sectorId}`;
        plannedPoliticalUnits.set(key, (plannedPoliticalUnits.get(key) ?? 0) + seller.units);
        plannedPoliticalAllocations.set(`${order.orderId}:${seller.allocationId}`, {
          units: seller.units,
          stateId: order.identity.targetStateId,
          sectorId: seller.sectorId,
          corporationId: seller.corporationId,
        });
      }
    }
  }

  const paidPoliticalUnits = new Map<string, number>();
  const countedReceiptIds = new Set<string>();
  if (
    plannedPoliticalAllocations.size > 0 &&
    typeof context.currentTurn === "number" &&
    Number.isSafeInteger(context.currentTurn)
  ) {
    const receipts = await db
      .collection<PoliticalSellerReceiptRow>("bankMoneyMoves")
      .find(
        {
          kind: "political-media-seller-receipt",
          status: "applied",
          turn: context.currentTurn,
        },
        {
          projection: {
            _id: 1,
            kind: 1,
            status: 1,
            turn: 1,
            politicalMediaOrderIdentity: 1,
          },
        }
      )
      .toArray();
    for (const receipt of receipts) {
      const identity = receipt.politicalMediaOrderIdentity;
      if (
        !identity?.orderId ||
        !identity.allocationId ||
        !identity.targetStateId ||
        !identity.sectorId ||
        !identity.corporationId ||
        !Number.isFinite(identity.units) ||
        identity.units! <= 0
      )
        continue;
      const allocationKey = `${identity.orderId}:${identity.allocationId}`;
      const expectedReceiptId = `political-media-seller:${allocationKey}`;
      if (receipt._id !== expectedReceiptId || countedReceiptIds.has(expectedReceiptId)) continue;
      const planned = plannedPoliticalAllocations.get(allocationKey);
      if (
        !planned ||
        planned.units !== identity.units ||
        planned.stateId !== identity.targetStateId ||
        planned.sectorId !== identity.sectorId ||
        planned.corporationId !== identity.corporationId
      )
        continue;
      countedReceiptIds.add(expectedReceiptId);
      const sectorKey = `${planned.stateId}:${planned.sectorId}`;
      paidPoliticalUnits.set(sectorKey, (paidPoliticalUnits.get(sectorKey) ?? 0) + identity.units!);
    }
  }

  return sectors.flatMap((sector) => {
    const hasTransition =
      typeof sector.transitionStartTurn === "number" &&
      typeof sector.transitionFromStrategyId === "string";
    const rates = getEffectiveStrategyRates(
      sector.sectorType,
      sector.strategyId ?? "standard",
      sector.transitionFromStrategyId,
      sector.transitionStartTurn,
      context.currentTurn ?? (hasTransition ? (sector.transitionStartTurn ?? 0) + 12 : 0)
    ).supply;
    if (!((rates.advertising ?? 0) > 0)) return [];

    const exactUnits = sector.outputUnitsByCommodity?.advertising;
    const producedAdvertising =
      typeof exactUnits === "number" && Number.isFinite(exactUnits)
        ? Math.max(0, exactUnits)
        : !(hasTransition && context.currentTurn == null) &&
            typeof sector.producedUnits === "number" &&
            Number.isFinite(sector.producedUnits) &&
            sector.producedUnits >= 0
          ? (scaleMeasuredProducedUnits({
              producedUnits: sector.producedUnits,
              isNatcorp: nationalCorporations.has(sector.corporationId.toString()),
              embargoSupplyFactor:
                embargoSupplyFactorFor(sector) *
                plannedEconomyMediaSupplyFactor(
                  sector.sectorType,
                  isPlannedEconomy(
                    sector.countryId ?? "US",
                    context.currentYear,
                    context.commandEconomyEnabled
                  )
                ),
            }) ?? 0) * commodityMixWeight(rates, COMMODITY_BASE_PRICES, "advertising")
          : null;
    const soldFraction =
      typeof sector.soldByCommodity?.advertising === "number"
        ? sector.soldByCommodity.advertising
        : sector.soldFraction;
    const physicalDelivered =
      producedAdvertising != null &&
      typeof soldFraction === "number" &&
      Number.isFinite(soldFraction)
        ? producedAdvertising * Math.max(0, Math.min(1, soldFraction))
        : null;
    const sectorKey =
      typeof sector._id?.toString === "function"
        ? `${sector.stateId}:${sector._id.toString()}`
        : "";
    const plannedUnits = plannedPoliticalUnits.get(sectorKey) ?? 0;
    const paidUnits = Math.min(plannedUnits, paidPoliticalUnits.get(sectorKey) ?? 0);
    const deliveredUnits =
      context.includeSettledPolitical === true
        ? currentTurnDeliveredAdvertisingUnits({
            snapshotTurn: sector.soldByCommodityTurn,
            currentTurn: context.currentTurn,
            physicalSoldUnits: physicalDelivered,
            plannedPoliticalUnits: plannedUnits,
            settledPoliticalUnits: paidUnits,
          })
        : physicalDelivered;

    return [
      {
        stateId: sector.stateId,
        countryId: "US",
        corporationId: sector.corporationId.toString(),
        deliveredAdvertisingUnits: deliveredUnits,
      },
    ];
  });
}
