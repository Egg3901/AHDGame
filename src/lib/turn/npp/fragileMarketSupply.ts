import type { Db } from "mongodb";
import type { CorporateSector, GameConfig, GameState } from "@/lib/db/types";
import type { UnownedSector } from "@/lib/db/types/unownedSector";
import type { StateResourceCapacity } from "@/lib/db/types/stateResourceCapacity";
import type { CommodityType } from "@/lib/constants/commodities";
import { STARTING_YEAR, TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { isPlannedEconomy } from "@/lib/constants/commandEconomy";
import { getEffectiveStrategyRates } from "@/lib/constants/sectorStrategies";
import { loadWorldEraUnitScale } from "@/lib/currency/gdpAnchorRate";
import { getExtractionOutputScaleEnabled } from "@/lib/market/featureFlag";
import { computeExtractionHeadroomByState } from "@/lib/turn/nppExtractionOpportunity";
import {
  fragileMarketCommodityForSector,
  fragileMarketFoundingStrategy,
  type CommodityPriceRatioFn,
  type PlacementSignals,
} from "@/lib/turn/npp/marketSignals";

export async function loadNppPlacementSignals(
  db: Db,
  turn: number,
  sectors: CorporateSector[],
  statePriceRatioOf: NonNullable<PlacementSignals["statePriceRatioOf"]>
): Promise<PlacementSignals> {
  const [capacity, eraUnitScale, config, gameState] = await Promise.all([
    db
      .collection<StateResourceCapacity>("stateResourceCapacity")
      .find({}, { projection: { stateId: 1, resources: 1 } })
      .toArray(),
    loadWorldEraUnitScale(db),
    db.collection<GameConfig>("gameConfig").findOne(
      { _id: "default" },
      {
        projection: {
          extractionOutputScaleEnabled: 1,
          nppMarketCoverageEnabled: 1,
          nppFragileMarketSupplyEnabled: 1,
          commandEconomyEnabled: 1,
        },
      }
    ),
    db
      .collection<GameState>("gameState")
      .findOne(
        { _id: "current" },
        { projection: { currentYear: 1, startingYear: 1, currentTurn: 1 } }
      ),
  ]);
  const extractionOutputScaleEnabled = await getExtractionOutputScaleEnabled(config);
  const extractionHeadroomByState = computeExtractionHeadroomByState(
    capacity,
    sectors,
    eraUnitScale,
    extractionOutputScaleEnabled
  );
  const currentYear =
    gameState?.currentYear ??
    (gameState?.startingYear ?? STARTING_YEAR) +
      Math.floor(((gameState?.currentTurn ?? turn) - 1) / TURNS_PER_YEAR);

  return {
    statePriceRatioOf,
    extractionHeadroomOf: (stateId) => extractionHeadroomByState.get(stateId) ?? 0,
    preferEmptyMarkets: config?.nppMarketCoverageEnabled === true,
    preferFragileMarketSupply: config?.nppFragileMarketSupplyEnabled === true,
    fragileMarketCountryEligible: (countryId) =>
      !isPlannedEconomy(countryId, currentYear, config?.commandEconomyEnabled === true),
  };
}

export function resolveFragileEntryTreatment(
  entryCandidate: UnownedSector | null,
  placementSignals: PlacementSignals | undefined,
  priceRatioOf: CommodityPriceRatioFn
): {
  candidatePriceRatioOf: CommodityPriceRatioFn;
  interventionTargetCommodity: CommodityType | null;
  foundingStrategyId: string | undefined;
} {
  const candidatePriceRatioOf: CommodityPriceRatioFn = (commodity, countryId) =>
    entryCandidate
      ? (placementSignals?.statePriceRatioOf?.(commodity, entryCandidate.stateId) ??
        priceRatioOf(commodity, countryId))
      : priceRatioOf(commodity, countryId);
  const treatmentEligible =
    entryCandidate !== null &&
    placementSignals?.preferFragileMarketSupply === true &&
    placementSignals.fragileMarketCountryEligible?.(entryCandidate.countryId) !== false;

  return {
    candidatePriceRatioOf,
    interventionTargetCommodity: treatmentEligible
      ? fragileMarketCommodityForSector(
          entryCandidate.sectorType,
          entryCandidate.countryId,
          candidatePriceRatioOf
        )
      : null,
    foundingStrategyId: treatmentEligible
      ? fragileMarketFoundingStrategy(
          entryCandidate.sectorType,
          entryCandidate.countryId,
          candidatePriceRatioOf
        )
      : undefined,
  };
}

export function fragileReinvestmentPriority(
  sector: CorporateSector,
  countryId: string,
  placementSignals: PlacementSignals | undefined,
  priceRatioOf: CommodityPriceRatioFn,
  turn: number
): number {
  if (
    !placementSignals?.preferFragileMarketSupply ||
    placementSignals.fragileMarketCountryEligible?.(countryId) === false
  ) {
    return 0;
  }
  const localPriceRatioOf: CommodityPriceRatioFn = (commodity, fallbackCountryId) =>
    placementSignals.statePriceRatioOf?.(commodity, sector.stateId) ??
    priceRatioOf(commodity, fallbackCountryId);
  const commodity = fragileMarketCommodityForSector(
    sector.sectorType,
    countryId,
    localPriceRatioOf
  );
  if (!commodity) return 0;
  const effectiveSupply = getEffectiveStrategyRates(
    sector.sectorType,
    sector.strategyId ?? "standard",
    sector.transitionFromStrategyId,
    sector.transitionStartTurn,
    turn
  ).supply;
  if ((effectiveSupply[commodity] ?? 0) <= 0) return 0;
  return localPriceRatioOf(commodity, countryId) ?? 0;
}
