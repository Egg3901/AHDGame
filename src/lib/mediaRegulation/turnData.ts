import type { Db } from "mongodb";
import type { CorporateSector } from "@/lib/db/types/corporation";
import { COMMODITY_BASE_PRICES, commodityMixWeight } from "@/lib/constants/commodities";
import { getEffectiveStrategyRates } from "@/lib/constants/sectorStrategies";
import { US_STATE_IDS } from "@/lib/countries/us/data/usStateBaselines";
import type { MediaOutletDelivery } from "./rules";

/**
 * Load measured US media delivery for concentration-gated legislation.
 * The query uses the existing stateId + sectorType index and projects only the
 * prior production, sales and strategy fields used to reconstruct delivered ads.
 */
export async function loadUSMediaOutletDelivery(
  db: Db,
  currentTurn?: number
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
          corporationId: 1,
          sectorType: 1,
          strategyId: 1,
          transitionFromStrategyId: 1,
          transitionStartTurn: 1,
          producedUnits: 1,
          outputUnitsByCommodity: 1,
          soldFraction: 1,
          soldByCommodity: 1,
        },
      }
    )
    .toArray();

  return sectors.flatMap((sector) => {
    const hasTransition =
      typeof sector.transitionStartTurn === "number" &&
      typeof sector.transitionFromStrategyId === "string";
    const rates = getEffectiveStrategyRates(
      sector.sectorType,
      sector.strategyId ?? "standard",
      sector.transitionFromStrategyId,
      sector.transitionStartTurn,
      currentTurn ?? (hasTransition ? (sector.transitionStartTurn ?? 0) + 12 : 0)
    ).supply;
    if (!((rates.advertising ?? 0) > 0)) return [];

    const exactUnits = sector.outputUnitsByCommodity?.advertising;
    const producedAdvertising =
      typeof exactUnits === "number" && Number.isFinite(exactUnits)
        ? Math.max(0, exactUnits)
        : !(hasTransition && currentTurn == null) &&
            typeof sector.producedUnits === "number" &&
            Number.isFinite(sector.producedUnits) &&
            sector.producedUnits >= 0
          ? sector.producedUnits * commodityMixWeight(rates, COMMODITY_BASE_PRICES, "advertising")
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
