import type { Db } from "mongodb";
import type { CorporateSector, GameConfig, GameState } from "@/lib/db/types";
import type { UnownedSector } from "@/lib/db/types/unownedSector";
import type { StateResourceCapacity } from "@/lib/db/types/stateResourceCapacity";
import type { CommodityType } from "@/lib/constants/commodities";
import type { OperatingSectorType } from "@/lib/constants/corporations";
import { STARTING_YEAR, TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { isPlannedEconomy } from "@/lib/constants/commandEconomy";
import {
  getEffectiveStrategyRatesForOperatingModel,
  getOperatingSectorType,
} from "@/lib/constants/sectorStrategies";
import { loadWorldEraUnitScale } from "@/lib/currency/gdpAnchorRate";
import { getExtractionOutputScaleEnabled } from "@/lib/market/featureFlag";
import {
  computeExtractionHeadroomByState,
  computeExtractionHeadroomByStateResource,
  extractionHeadroomForSupply,
} from "@/lib/turn/nppExtractionOpportunity";
import {
  depositAwarePriceRatioOf,
  fragileMarketCommodityForSector,
  fragileMarketFoundingStrategy,
  fragileSupplyGate,
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
  const extractionHeadroomByStateResource = computeExtractionHeadroomByStateResource(
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
    // No capacity document means an uncapped legacy state, not an exhausted
    // deposit. A present document with no resources still resolves to 0.
    extractionHeadroomOf: (stateId) => extractionHeadroomByState.get(stateId) ?? 1,
    extractionResourceHeadroomOf: (stateId, resource) => {
      const byResource = extractionHeadroomByStateResource.get(stateId);
      return byResource ? (byResource[resource] ?? 0) : 1;
    },
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
  const statePriceRatioOf: CommodityPriceRatioFn = (commodity, countryId) =>
    entryCandidate
      ? (placementSignals?.statePriceRatioOf?.(commodity, entryCandidate.stateId) ??
        priceRatioOf(commodity, countryId))
      : priceRatioOf(commodity, countryId);
  // The entry gates (critical shortage, glut) score the candidate on what its
  // state can actually extract, not on a resource it holds no deposit of.
  const candidatePriceRatioOf: CommodityPriceRatioFn = entryCandidate
    ? depositAwarePriceRatioOf(
        entryCandidate.sectorType,
        entryCandidate.stateId,
        placementSignals,
        statePriceRatioOf
      )
    : statePriceRatioOf;
  const treatmentEligible =
    entryCandidate !== null &&
    placementSignals?.preferFragileMarketSupply === true &&
    placementSignals.fragileMarketCountryEligible?.(entryCandidate.countryId) !== false;
  // A founding is only steered onto a resource its state holds: a rare earth
  // recipe in a timber state extracts nothing and still buys its inputs.
  const canSupply = entryCandidate
    ? fragileSupplyGate(entryCandidate.sectorType, entryCandidate.stateId, placementSignals)
    : undefined;

  return {
    candidatePriceRatioOf,
    interventionTargetCommodity: treatmentEligible
      ? fragileMarketCommodityForSector(
          entryCandidate.sectorType,
          entryCandidate.countryId,
          candidatePriceRatioOf,
          canSupply
        )
      : null,
    foundingStrategyId: treatmentEligible
      ? fragileMarketFoundingStrategy(
          entryCandidate.sectorType,
          entryCandidate.countryId,
          candidatePriceRatioOf,
          canSupply
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
  const operatingSectorType = getOperatingSectorType(
    sector.sectorType,
    sector.industryModel,
    sector.mediaDiscriminator
  );
  const commodity = fragileMarketCommodityForSector(
    operatingSectorType as OperatingSectorType,
    countryId,
    localPriceRatioOf,
    // A mine whose state holds none of the commodity (or has no room left)
    // sells none of it, so it must not jump the reinvestment queue.
    fragileSupplyGate(sector.sectorType, sector.stateId, placementSignals)
  );
  if (!commodity) return 0;
  const effectiveSupply = getEffectiveStrategyRatesForOperatingModel(
    sector.sectorType,
    sector.strategyId ?? "standard",
    sector.transitionFromStrategyId,
    sector.transitionStartTurn,
    turn,
    sector.industryModel,
    sector.mediaDiscriminator
  ).supply;
  if ((effectiveSupply[commodity] ?? 0) <= 0) return 0;
  return localPriceRatioOf(commodity, countryId) ?? 0;
}

/**
 * Deposit headroom that gates an existing mine's growth, in [0, 1]. Read over
 * the resources the mine's own recipe extracts, so a rare earth mine in a
 * timber state reads 0 instead of the timber deposit's room. Falls back to the
 * aggregate state signal when the per-resource one is not loaded.
 */
export function extractionGrowthHeadroom(
  sector: CorporateSector,
  placementSignals: PlacementSignals | undefined,
  turn: number
): number {
  const resourceHeadroomOf = placementSignals?.extractionResourceHeadroomOf;
  if (!resourceHeadroomOf) {
    return Math.max(0, Math.min(1, placementSignals?.extractionHeadroomOf?.(sector.stateId) ?? 1));
  }
  const supply = getEffectiveStrategyRatesForOperatingModel(
    sector.sectorType,
    sector.strategyId ?? "standard",
    sector.transitionFromStrategyId,
    sector.transitionStartTurn,
    turn,
    sector.industryModel,
    sector.mediaDiscriminator
  ).supply;
  return extractionHeadroomForSupply(supply, (resource) =>
    resourceHeadroomOf(sector.stateId, resource)
  );
}
