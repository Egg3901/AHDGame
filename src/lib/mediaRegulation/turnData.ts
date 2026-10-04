import type { Db } from "mongodb";
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
import type { MediaOutletDelivery } from "./rules";

/**
 * Load measured US media delivery for concentration-gated legislation.
 * The query uses the existing stateId + sectorType index and projects only the
 * prior production, sales and strategy fields used to reconstruct delivered ads.
 */
export interface MediaOutletLoadContext {
  currentTurn?: number | null;
  currentYear?: number | null;
  commandEconomyEnabled?: boolean;
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

    return [
      {
        stateId: sector.stateId,
        countryId: "US",
        corporationId: sector.corporationId.toString(),
        deliveredAdvertisingUnits:
          producedAdvertising != null &&
          typeof soldFraction === "number" &&
          Number.isFinite(soldFraction)
            ? producedAdvertising * Math.max(0, Math.min(1, soldFraction))
            : null,
      },
    ];
  });
}
