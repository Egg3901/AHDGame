import { NextResponse } from "next/server";
import { conditionalJson } from "@/lib/api/conditionalJson";
import { loadReachableBooks, reachableBooksFor } from "@/lib/trade/queries/loadReachableBooks";
import { getDb } from "@/lib/mongodb";
import { getMarketSystemMode, marketAtLeast } from "@/lib/market/featureFlag";
import type { CommodityFlow as CommodityFlowDoc } from "@/lib/db/types/commodityFlow";
import { handleRouteError } from "@/lib/api/errors";
import { getGameState } from "@/lib/gameState";
import { getAuthUser } from "@/lib/auth";
import { getEnabledCountryIds } from "@/lib/countryAccess";
import type { CountryId } from "@/lib/constants/countries";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import type {
  CommodityPrice,
  CommodityPriceHistory,
  Corporation,
  CorporateSector,
  FederalBudget,
  State,
} from "@/lib/db/types";
import {
  COMMODITY_TYPES,
  COMMODITY_LABELS,
  COMMODITY_ICONS,
  COMMODITY_COLORS,
  COMMODITY_BASE_PRICES,
  COMMODITY_UNITS,
  COMMODITIES_NATIONAL_REGIONAL_PRICE_BLEND,
  EXTRACTABLE_RESOURCES,
  SECTOR_SUPPLY,
  SECTOR_DEMAND,
  MARKETING_ADVERTISING_DEMAND_RATE,
  GOVT_HEALTHCARE_DEMAND_RATE,
  GOVT_HEALTHCARE_BUDGET_CATEGORIES,
  govtSpendForCategory,
  NATCORP_COMMODITY_MULTIPLIER,
  dollarsToUnits,
  getCommodityStabilizer,
  computeMarketPrice,
  blendPrice,
} from "@/lib/constants/commodities";
import type { ExtractableResource } from "@/lib/constants/commodities";
import type { StateResourceCapacity } from "@/lib/db/types/stateResourceCapacity";
import type { CommodityType } from "@/lib/constants/commodities";
import { CORPORATION_TYPE_LABELS } from "@/lib/constants/corporations";
import type { CorporationType } from "@/lib/constants/corporations";
import { getEffectiveStrategyRates, SECTOR_STRATEGIES } from "@/lib/constants/sectorStrategies";
import {
  computeExtractionCapacityMultipliers,
  type ExtractionSectorInput,
} from "@/lib/turn/extraction/extractionCapacity";
import { getStateResourceCapacityCollection } from "@/lib/db/collections/stateResourceCapacity";
import {
  getExtractionContractsCollection,
  activeExtractionContractFilter,
} from "@/lib/db/collections/extractionContracts";
import { computeRollingAnnualizedPercentChange } from "@/lib/utils/rollingAnnualizedChange";
import {
  fxRateForCorpFromMap,
  loadFxRatesByCurrency,
  resolveCorpLiquidCurrencyCode,
} from "@/lib/currency/corporationCapital";
import { readCorpEconomicAnchor } from "@/lib/currency/corpEconomyFields";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { getOutputMultiplier, getInputMultiplier } from "@/lib/utils/productionPolicy";

/**
 * Effective per-revenue supply or demand rate for one commodity, matching
 * `computeRawSupplyDemand` (operating strategies override base SECTOR_* tables).
 */
function getEffectiveCommodityRate(
  sector: CorporateSector,
  commodity: CommodityType,
  kind: "supply" | "demand",
  currentTurn: number
): number {
  const st = sector.sectorType as CorporationType;
  const hasStrategy = sector.strategyId && sector.strategyId !== "standard";
  const strategyRates =
    hasStrategy || sector.transitionFromStrategyId
      ? getEffectiveStrategyRates(
          st,
          sector.strategyId ?? "standard",
          sector.transitionFromStrategyId,
          sector.transitionStartTurn,
          currentTurn
        )
      : null;

  if (strategyRates) {
    const map = kind === "supply" ? strategyRates.supply : strategyRates.demand;
    return map[commodity] ?? 0;
  }

  const flows = kind === "supply" ? SECTOR_SUPPLY[st] : SECTOR_DEMAND[st];
  if (!flows) return 0;
  let sum = 0;
  for (const f of flows) {
    if (f.commodity === commodity) sum += f.rate;
  }
  return sum;
}

/** Sector-type flow rows for the Production Flow panel: base tables plus strategies that add commodities not present in the base map. */
function buildSectorFlowRows(
  commodity: CommodityType,
  kind: "supply" | "demand"
): { sectorType: CorporationType; label: string; rate: number }[] {
  const rows: { sectorType: CorporationType; label: string; rate: number }[] = [];
  const baseFlows = kind === "supply" ? SECTOR_SUPPLY : SECTOR_DEMAND;

  for (const [sectorType, flows] of Object.entries(baseFlows)) {
    if (!flows) continue;
    for (const flow of flows) {
      if (flow.commodity === commodity) {
        rows.push({
          sectorType: sectorType as CorporationType,
          label: CORPORATION_TYPE_LABELS[sectorType as CorporationType],
          rate: flow.rate,
        });
      }
    }
  }

  for (const [sectorType, strategies] of Object.entries(SECTOR_STRATEGIES)) {
    const st = sectorType as CorporationType;
    const baseCommodities = new Set((baseFlows[st] ?? []).map((f) => f.commodity));
    for (const strat of strategies) {
      if (strat.id === "standard") continue;
      const commodityMap = kind === "supply" ? strat.supply : strat.demand;
      const rate = commodityMap[commodity];
      if (rate == null || rate <= 0) continue;
      if (baseCommodities.has(commodity)) continue;
      rows.push({
        sectorType: st,
        label: `${CORPORATION_TYPE_LABELS[st]} — ${strat.name}`,
        rate,
      });
    }
  }

  return rows;
}

function buildCorpVolumeRows(
  unitsByCorp: Iterable<[string, number]>,
  corpMap: Map<
    string,
    Pick<
      Corporation,
      | "_id"
      | "name"
      | "type"
      | "marketingBudget"
      | "sequentialId"
      | "logoUrl"
      | "countryId"
      | "countryOwnerId"
      | "liquidCurrencyCode"
    >
  >
) {
  return [...unitsByCorp]
    .sort((a, b) => b[1] - a[1])
    .map(([corpId, units]) => {
      const corp = corpMap.get(corpId);
      return {
        corpId,
        name: corp?.name ?? "Unknown",
        type: corp?.type,
        typeLabel: corp?.type ? CORPORATION_TYPE_LABELS[corp.type] : undefined,
        sequentialId: corp?.sequentialId,
        logoUrl: corp?.logoUrl,
        units: Math.round(units * 100) / 100,
      };
    });
}

interface RouteParams {
  params: Promise<{ type: string }>;
}

/**
 * Build the commodity detail payload for a single commodity.
 * Returns detailed data for a single commodity including price history,
 * global supply/demand, which sectors supply/demand it, and top
 * corporations by production/consumption volume.
 */
export async function getCommodityDetailData(
  commodity: CommodityType,
  options: { includeHeavy?: boolean } = {}
) {
  try {
    const includeHeavy = options.includeHeavy ?? true;
    const db = await getDb();
    // Only the heavy payload renders the map, so the light header request does
    // not pay for this read.
    const reachableBooks = includeHeavy ? await loadReachableBooks(db) : null;
    const currentTurn = (await getGameState())?.currentTurn ?? 1;
    const targetTurn = Math.max(1, currentTurn - TURNS_PER_YEAR);

    // Parallel fetches
    const [currentPrice, history, rollingReference, oldestHistory] = await Promise.all([
      db.collection<CommodityPrice>("commodityPrices").findOne({ commodity }),
      db
        .collection<CommodityPriceHistory>("commodityPriceHistory")
        .find({ commodity, turn: { $lte: currentTurn } })
        .sort({ turn: -1 })
        .limit(200)
        .toArray(),
      db
        .collection<CommodityPriceHistory>("commodityPriceHistory")
        .findOne({ commodity, turn: { $lte: targetTurn } }, { sort: { turn: -1 } }),
      db
        .collection<CommodityPriceHistory>("commodityPriceHistory")
        .findOne({ commodity, turn: { $lte: currentTurn } }, { sort: { turn: 1 } }),
    ]);

    let allSectors: CorporateSector[] = [];
    let allCorps: Pick<
      Corporation,
      | "_id"
      | "name"
      | "type"
      | "marketingBudget"
      | "sequentialId"
      | "logoUrl"
      | "countryId"
      | "countryOwnerId"
      | "liquidCurrencyCode"
    >[] = [];
    let allStates: State[] = [];
    if (includeHeavy) {
      [allSectors, allCorps, allStates] = await Promise.all([
        db.collection<CorporateSector>("corporateSectors").find({}).toArray(),
        db
          .collection<Corporation>("corporations")
          .find({})
          .project<
            Pick<
              Corporation,
              | "_id"
              | "name"
              | "type"
              | "marketingBudget"
              | "sequentialId"
              | "logoUrl"
              | "countryId"
              | "countryOwnerId"
              | "liquidCurrencyCode"
            >
          >({
            _id: 1,
            name: 1,
            type: 1,
            marketingBudget: 1,
            sequentialId: 1,
            logoUrl: 1,
            countryId: 1,
            countryOwnerId: 1,
            liquidCurrencyCode: 1,
          })
          .toArray(),
        db
          .collection<State>("states")
          .find({}, { projection: { _id: 1, countryId: 1 } })
          .toArray(),
      ]);
    }

    // Build state → country lookup for client-side aggregation
    const stateCountryMap: Record<string, string> = {};
    for (const s of allStates) {
      stateCountryMap[s._id] = s.countryId;
    }

    // Determine which state IDs are accessible based on enabled countries
    const authUser = includeHeavy ? await getAuthUser() : null;
    const isAdmin = authUser?.isAdmin === true;
    let allowedStateIds: Set<string> | null = null;
    if (includeHeavy && !isAdmin) {
      const enabledCountries = await getEnabledCountryIds();
      allowedStateIds = new Set(
        Object.entries(stateCountryMap)
          .filter(([, countryId]) => enabledCountries.includes(countryId as CountryId))
          .map(([stateId]) => stateId)
      );
    }

    // Filter a state-keyed map to only include accessible states
    const filterStateMap = (map: Record<string, number>): Record<string, number> => {
      if (!allowedStateIds) return map;
      return Object.fromEntries(
        Object.entries(map).filter(([stateId]) => allowedStateIds!.has(stateId))
      );
    };

    const synthesizeCompositeStatePrices = (
      stateIds: string[],
      prices: Record<string, number>,
      supply: Record<string, number>,
      demand: Record<string, number>,
      globalPrice: number,
      basePrice: number,
      nationalPrices: Record<string, number>,
      stateCountry: Record<string, string>,
      isMacroPriceBlend: boolean
    ): Record<string, number> => {
      const result: Record<string, number> = {};
      for (const stateId of stateIds) {
        if (prices[stateId] != null) {
          result[stateId] = prices[stateId];
          continue;
        }
        // Three-leg fallback mirrors commodityPriceTurn: 50/25/25 with the
        // regional leg redirected to national for macro-driven commodities.
        const countryId = stateCountry[stateId];
        const nationalLeg =
          countryId && nationalPrices[countryId] != null ? nationalPrices[countryId] : globalPrice;
        const regionalLeg = isMacroPriceBlend
          ? nationalLeg
          : computeMarketPrice(basePrice, supply[stateId] ?? 0, demand[stateId] ?? 0);
        result[stateId] = blendPrice(globalPrice, nationalLeg, regionalLeg);
      }
      return result;
    };

    // Reverse history to chronological order
    history.reverse();

    // Build corp lookup
    const corpMap = new Map(allCorps.map((c) => [c._id.toString(), c]));

    // Per-corp FX so per-sector revenue + marketingBudget normalize to ₳
    // before commodity-unit math (dollarsToUnits /
    // MARKETING_ADVERTISING_DEMAND_RATE are ₳-calibrated). Empty map on the
    // light-path (includeHeavy=false) — the synthetic retail and per-corp
    // producer/consumer blocks below check includeHeavy themselves, so the
    // lookup stays unused in that case.
    const fxByCurrency = includeHeavy ? await loadFxRatesByCurrency(db) : new Map();
    const fxByCorpId = new Map<string, { code: CurrencyCode | undefined; rate: number }>();
    for (const c of allCorps) {
      fxByCorpId.set(c._id.toString(), {
        code: resolveCorpLiquidCurrencyCode(c),
        rate: fxRateForCorpFromMap(c, fxByCurrency),
      });
    }

    // Sector-type supply/demand (base tables + operating strategies that add inputs/outputs not in base)
    const suppliers = buildSectorFlowRows(commodity, "supply");
    const consumers = buildSectorFlowRows(commodity, "demand");

    // ── Compute top producers and demanders by corporation ──────────────────
    // Prefer the world's OWN seeded basePrice (era-scaled) over the modern constant.
    const basePrice = currentPrice?.basePrice ?? COMMODITY_BASE_PRICES[commodity];

    const totalDemand = currentPrice?.globalDemand ?? 0;
    let totalCorporateDemand = 0;
    let nonCorporateDemandShare = 0;
    const topProducers = [] as {
      corpId: string;
      name: string;
      type?: CorporationType;
      typeLabel?: string;
      sequentialId?: number;
      logoUrl?: string;
      units: number;
    }[];
    const topConsumers = [] as {
      corpId: string;
      name: string;
      type?: CorporationType;
      typeLabel?: string;
      sequentialId?: number;
      logoUrl?: string;
      units: number;
    }[];
    const topProducersByCountry: Partial<
      Record<
        CountryId,
        {
          corpId: string;
          name: string;
          type?: CorporationType;
          typeLabel?: string;
          sequentialId?: number;
          logoUrl?: string;
          units: number;
        }[]
      >
    > = {};
    const topConsumersByCountry: Partial<
      Record<
        CountryId,
        {
          corpId: string;
          name: string;
          type?: CorporationType;
          typeLabel?: string;
          sequentialId?: number;
          logoUrl?: string;
          units: number;
        }[]
      >
    > = {};

    if (includeHeavy) {
      // Group sectors by corporation
      const sectorsByCorp = new Map<string, CorporateSector[]>();
      for (const sector of allSectors) {
        const key = sector.corporationId.toString();
        const list = sectorsByCorp.get(key) ?? [];
        list.push(sector);
        sectorsByCorp.set(key, list);
      }

      // Natcorps (country-owned enterprises) contribute only NATCORP_COMMODITY_MULTIPLIER
      // of their revenue-implied commodity flows — mirror commodityPriceTurn.ts so per-corp
      // totals reconcile with globalSupply / globalDemand.
      const natcorpIds = new Set(
        allCorps.filter((c) => !!c.countryOwnerId).map((c) => c._id.toString())
      );

      // For extractable commodities, mirror the turn engine's capacity cap so a producer
      // whose state-level revenue would exceed the available capacity is shown at its
      // actual capped output, not its uncapped revenue-implied projection. Without this,
      // a single producer can appear to "out-produce" the entire global supply.
      const isExtractable = (EXTRACTABLE_RESOURCES as readonly string[]).includes(commodity);
      let extractionMultipliers:
        Map<string, Partial<Record<ExtractableResource, number>>> | undefined;
      if (isExtractable) {
        const extractionSectors = allSectors.filter((s) => s.sectorType === "extraction");
        if (extractionSectors.length > 0) {
          const stateIds = [...new Set(extractionSectors.map((s) => s.stateId))];
          const [capacityDocs, activeContracts] = await Promise.all([
            (await getStateResourceCapacityCollection(db))
              .find({ stateId: { $in: stateIds } })
              .toArray(),
            (await getExtractionContractsCollection(db))
              .find({ stateId: { $in: stateIds }, ...activeExtractionContractFilter() })
              .toArray(),
          ]);

          const extractionInputs: ExtractionSectorInput[] = extractionSectors.map((sector) => {
            const hasStrategy = sector.strategyId && sector.strategyId !== "standard";
            const strategyRates =
              hasStrategy || sector.transitionFromStrategyId
                ? getEffectiveStrategyRates(
                    "extraction",
                    sector.strategyId ?? "standard",
                    sector.transitionFromStrategyId,
                    sector.transitionStartTurn,
                    currentTurn
                  )
                : null;

            const sectorFx = fxByCorpId.get(sector.corporationId.toString());
            const sectorRevenueAnchor = readCorpEconomicAnchor(
              sector.revenue,
              sectorFx?.code,
              sectorFx?.rate ?? 1
            );

            const revenueBasedOutput: Partial<Record<ExtractableResource, number>> = {};
            for (const resource of EXTRACTABLE_RESOURCES) {
              const rate = strategyRates
                ? (strategyRates.supply[resource] ?? 0)
                : ((SECTOR_SUPPLY["extraction"] ?? []).find((f) => f.commodity === resource)
                    ?.rate ?? 0);
              if (rate > 0) {
                revenueBasedOutput[resource] =
                  (sectorRevenueAnchor * rate) / COMMODITY_BASE_PRICES[resource];
              }
            }

            return {
              sectorId: sector._id.toString(),
              stateId: sector.stateId,
              corporationId: sector.corporationId,
              revenueBasedOutput,
            };
          });

          extractionMultipliers = computeExtractionCapacityMultipliers(
            extractionInputs,
            activeContracts,
            capacityDocs
          );
        }
      }

      // Calculate per-corporation supply and demand in units
      // (fxByCorpId hoisted above the first includeHeavy block so it's also
      // available to the retail-demand synthetic block below.)
      const corpSupply = new Map<string, number>(); // corpId -> units/day
      const corpDemand = new Map<string, number>(); // corpId -> units/day
      const corpSupplyByCountry = new Map<CountryId, Map<string, number>>();
      const corpDemandByCountry = new Map<CountryId, Map<string, number>>();

      const addCountryUnits = (
        target: Map<CountryId, Map<string, number>>,
        countryId: CountryId | undefined,
        corpId: string,
        units: number
      ) => {
        if (!countryId || units <= 0) return;
        const existing = target.get(countryId) ?? new Map<string, number>();
        existing.set(corpId, (existing.get(corpId) ?? 0) + units);
        target.set(countryId, existing);
      };

      for (const [corpId, sectors] of sectorsByCorp) {
        let supplyUnits = 0;
        let demandUnits = 0;
        const fx = fxByCorpId.get(corpId);
        const natcorpScale = natcorpIds.has(corpId) ? NATCORP_COMMODITY_MULTIPLIER : 1;

        for (const sector of sectors) {
          const sectorRevenueAnchor = readCorpEconomicAnchor(
            sector.revenue,
            fx?.code,
            fx?.rate ?? 1
          );
          const sectorCountryId = stateCountryMap[sector.stateId] as CountryId | undefined;
          const supplyRate = getEffectiveCommodityRate(sector, commodity, "supply", currentTurn);
          if (supplyRate > 0) {
            let units =
              dollarsToUnits(sectorRevenueAnchor * supplyRate, basePrice) *
              getOutputMultiplier(sector.productionPolicyLevel ?? 0) *
              natcorpScale;
            if (sector.sectorType === "extraction" && isExtractable && extractionMultipliers) {
              const sectorMults = extractionMultipliers.get(sector._id.toString());
              const mult = sectorMults?.[commodity as ExtractableResource] ?? 1;
              units *= mult;
            }
            supplyUnits += units;
            addCountryUnits(corpSupplyByCountry, sectorCountryId, corpId, units);
          }

          const demandRate = getEffectiveCommodityRate(sector, commodity, "demand", currentTurn);
          if (demandRate > 0) {
            const units =
              dollarsToUnits(sectorRevenueAnchor * demandRate, basePrice) *
              getInputMultiplier(sector.productionPolicyLevel ?? 0) *
              natcorpScale;
            demandUnits += units;
            addCountryUnits(corpDemandByCountry, sectorCountryId, corpId, units);
          }
        }

        // For advertising: add marketing budget demand (normalized to ₳).
        if (commodity === "advertising") {
          const corp = corpMap.get(corpId);
          if (corp && corp.marketingBudget > 0) {
            const budgetAnchor = readCorpEconomicAnchor(
              corp.marketingBudget,
              fx?.code,
              fx?.rate ?? 1
            );
            const msUnits = dollarsToUnits(
              budgetAnchor * MARKETING_ADVERTISING_DEMAND_RATE,
              basePrice
            );
            demandUnits += msUnits;
            const corpCountryId = (corp.countryId ?? corp.countryOwnerId) as CountryId | undefined;
            addCountryUnits(corpDemandByCountry, corpCountryId, corpId, msUnits);
          }
        }

        if (supplyUnits > 0) corpSupply.set(corpId, supplyUnits);
        if (demandUnits > 0) corpDemand.set(corpId, demandUnits);
      }

      // Sort all producers and consumers (client handles pagination)
      topProducers.push(...buildCorpVolumeRows(corpSupply.entries(), corpMap));
      topConsumers.push(...buildCorpVolumeRows(corpDemand.entries(), corpMap));
      for (const [countryId, unitsByCorp] of corpSupplyByCountry.entries()) {
        topProducersByCountry[countryId] = buildCorpVolumeRows(unitsByCorp.entries(), corpMap);
      }
      for (const [countryId, unitsByCorp] of corpDemandByCountry.entries()) {
        topConsumersByCountry[countryId] = buildCorpVolumeRows(unitsByCorp.entries(), corpMap);
      }

      totalCorporateDemand = [...corpDemand.values()].reduce((sum, units) => sum + units, 0);
      const nonCorporateDemand = Math.max(0, totalDemand - totalCorporateDemand);
      nonCorporateDemandShare =
        totalDemand > 0 ? Math.round((nonCorporateDemand / totalDemand) * 1000) / 10 : 0;
    }

    // ── Demand driver metadata ──────────────────────────────────────────────
    let demandDriver: {
      type: string;
      label: string;
      description: string;
      sourceLabel?: string;
      sourceUnits?: number;
      sourceShare?: number;
      consumerNote?: string;
    } | null = null;
    if (commodity === "advertising") {
      demandDriver = {
        type: "corporate",
        label: "Corporate Demand",
        description: `Driven by marketing spending. Corporations allocate marketing budgets that convert to advertising commodity demand at a ${(MARKETING_ADVERTISING_DEMAND_RATE * 100).toFixed(0)}% rate.`,
      };
    } else if (commodity === "financial_services") {
      demandDriver = {
        type: "macro",
        label: "Macro Demand",
        description:
          "Most financial contract demand is generated economy-wide from state GDP, interest rates, and GDP growth. Direct corporate input demand is only part of the market.",
        ...(includeHeavy
          ? {
              sourceLabel: "Economy-wide demand",
              sourceUnits: Math.round((totalDemand - totalCorporateDemand) * 100) / 100,
              sourceShare: nonCorporateDemandShare,
              consumerNote:
                "Top Consumers only shows direct corporate input demand. Most financial contract demand comes from economy-wide macro demand shown above.",
            }
          : {}),
      };
    } else if (commodity === "retail") {
      demandDriver = {
        type: "consumer",
        label: "Baseline Consumer Demand",
        description:
          "Driven by GDP growth. Consumer demand scales with a blend of 50% national and 50% regional GDP growth, ranging from 0.5x to 2.0x the baseline.",
      };
    }

    // ── Synthetic demand sources for display ──────────────────────────────────
    const syntheticDemandSources: {
      name: string;
      type: "system";
      units: number;
      description: string;
    }[] = [
      {
        name: "Base Economic Demand",
        type: "system",
        units: getCommodityStabilizer(commodity),
        description: "Baseline market activity representing background economic demand",
      },
    ];

    const retailDemandFlows = includeHeavy ? SECTOR_DEMAND["retail"] : undefined;
    if (retailDemandFlows) {
      const retailFlow = retailDemandFlows.find((f) => f.commodity === commodity);
      if (retailFlow) {
        let retailDemandUnits = 0;
        for (const sector of allSectors) {
          if (sector.sectorType === "retail") {
            // Cross-corp retail aggregation — normalize each sector's revenue
            // to ₳ via the owning corp's FX before multiplying by the
            // ₳-calibrated retailFlow.rate.
            const fx = fxByCorpId.get(sector.corporationId.toString());
            const sectorRevenueAnchor = readCorpEconomicAnchor(
              sector.revenue,
              fx?.code,
              fx?.rate ?? 1
            );
            retailDemandUnits += dollarsToUnits(sectorRevenueAnchor * retailFlow.rate, basePrice);
          }
        }
        if (retailDemandUnits > 0) {
          syntheticDemandSources.push({
            name: "GDP-Scaled Retail Demand",
            type: "system",
            units: Math.round(retailDemandUnits * 100) / 100,
            description: "Consumer demand flowing through retail channels, scaled by GDP growth",
          });
        }
      }
    }

    // GDP-scaled construction demand for building materials
    if (includeHeavy && commodity === "building_materials") {
      const macroDemand = Math.max(
        0,
        totalDemand - totalCorporateDemand - getCommodityStabilizer(commodity)
      );
      if (macroDemand > 0) {
        syntheticDemandSources.push({
          name: "GDP-Scaled Construction Demand",
          type: "system",
          units: Math.round(macroDemand * 100) / 100,
          description:
            "Construction and infrastructure demand driven by state GDP levels and economic growth",
        });
      }
    }

    // Economy-wide financial demand from bond/debt markets (latent demand not captured by corps)
    if (commodity === "financial_services") {
      const latentDemand = Math.max(
        0,
        totalDemand - totalCorporateDemand - getCommodityStabilizer(commodity)
      );
      if (latentDemand > 0) {
        syntheticDemandSources.push({
          name: "Economy-wide Financial Demand",
          type: "system",
          units: Math.round(latentDemand * 100) / 100,
          description:
            "Demand from sovereign and corporate debt markets, interest rate environment, and economy-wide financial activity not captured in direct corporate input demand",
        });
      }
    }

    // Per-state extraction capacity for extractable commodities
    let capacityByState: Record<string, number> | undefined;
    let totalCapacity: number | undefined;
    if (includeHeavy && (EXTRACTABLE_RESOURCES as readonly string[]).includes(commodity)) {
      const resource = commodity as ExtractableResource;
      const capDocs = await db
        .collection<StateResourceCapacity>("stateResourceCapacity")
        .find({}, { projection: { stateId: 1, resources: 1 } })
        .toArray();
      capacityByState = {};
      totalCapacity = 0;
      for (const doc of capDocs) {
        if (allowedStateIds && !allowedStateIds.has(doc.stateId)) continue;
        const cap = doc.resources?.[resource] ?? 0;
        if (cap > 0) {
          capacityByState[doc.stateId] = cap;
          totalCapacity += cap;
        }
      }
    }

    // Government healthcare expenditure (national budgets: Medicare, NHS, etc.)
    if (commodity === "healthcare_services") {
      const federalBudgets = await db
        .collection<FederalBudget>("federalBudget")
        // Whole category map, and alias-resolved below, so this panel reports
        // the same number the turn books. UK/CN/IE spell the category `health`
        // and were silently contributing nothing here too.
        .find({}, { projection: { "spending.byCategory": 1 } })
        .toArray();

      let govtHealthcareUnits = 0;
      const turnsPerYear = 48;
      for (const budget of federalBudgets) {
        const annualSpend = govtSpendForCategory(
          budget.spending?.byCategory,
          GOVT_HEALTHCARE_BUDGET_CATEGORIES
        );
        if (annualSpend <= 0) continue;
        govtHealthcareUnits +=
          (annualSpend / turnsPerYear / basePrice) * GOVT_HEALTHCARE_DEMAND_RATE;
      }
      if (govtHealthcareUnits > 0) {
        syntheticDemandSources.push({
          name: "Government Healthcare Expenditure",
          type: "system",
          units: Math.round(govtHealthcareUnits * 100) / 100,
          description:
            "Demand generated by national healthcare budgets (Medicare/Medicaid, NHS, etc.). Represents government-funded healthcare consumption as a fraction of total public health expenditure.",
        });
      }
    }

    // Flow ledger (marketSystemMode >= "ledger"): latest row for this commodity.
    let flows:
      | {
          basis: CommodityFlowDoc["basis"];
          clearingBasis: CommodityFlowDoc["clearingBasis"];
          turn: number;
          clearedUnits: number;
          clearedUnitsPooled: number;
          unmetDemandUnits: number;
          unmetDemandUnitsPooled: number;
          surplusUnits: number;
          surplusUnitsPooled: number;
          stockUnits: number | null;
          coverTurns: number | null;
        }
      | undefined;
    if (marketAtLeast(await getMarketSystemMode(), "ledger")) {
      const flowDoc = await db
        .collection<CommodityFlowDoc>("commodityFlows")
        .find({ commodity })
        .sort({ turn: -1 })
        .limit(1)
        .next();
      if (flowDoc) {
        flows = {
          basis: flowDoc.basis ?? "ledger_aggregate",
          clearingBasis: flowDoc.clearingBasis ?? "global_pooled_availability",
          turn: flowDoc.turn,
          clearedUnits: flowDoc.clearedUnits,
          clearedUnitsPooled: flowDoc.clearedUnitsPooled ?? flowDoc.clearedUnits,
          unmetDemandUnits: flowDoc.unmetDemandUnits,
          unmetDemandUnitsPooled: flowDoc.unmetDemandUnitsPooled ?? flowDoc.unmetDemandUnits,
          surplusUnits: flowDoc.surplusUnits,
          surplusUnitsPooled: flowDoc.surplusUnitsPooled ?? flowDoc.surplusUnits,
          stockUnits: flowDoc.stockUnits ?? null,
          coverTurns: flowDoc.coverTurns ?? null,
        };
      }
    }

    return {
      commodity,
      flows,
      label: COMMODITY_LABELS[commodity],
      icon: COMMODITY_ICONS[commodity],
      colors: COMMODITY_COLORS[commodity],
      unit: COMMODITY_UNITS[commodity],
      basePrice,
      globalPrice: currentPrice?.globalPrice ?? basePrice,
      globalSupply: currentPrice?.globalSupply ?? 0,
      globalDemand: currentPrice?.globalDemand ?? 0,
      priceChange:
        Math.round((((currentPrice?.globalPrice ?? basePrice) - basePrice) / basePrice) * 10000) /
        100,
      annualPriceChange: (() => {
        const reference = rollingReference ?? oldestHistory;
        return computeRollingAnnualizedPercentChange({
          currentValue: currentPrice?.globalPrice ?? basePrice,
          referenceValue: reference?.globalPrice,
          turnSpan: reference ? currentTurn - reference.turn : 0,
        });
      })(),
      stateCountryMap:
        includeHeavy && allowedStateIds
          ? Object.fromEntries(
              Object.entries(stateCountryMap).filter(([stateId]) => allowedStateIds!.has(stateId))
            )
          : includeHeavy
            ? stateCountryMap
            : {},
      statePrices: includeHeavy
        ? synthesizeCompositeStatePrices(
            Object.keys(
              includeHeavy && allowedStateIds
                ? Object.fromEntries(
                    Object.entries(stateCountryMap).filter(([stateId]) =>
                      allowedStateIds!.has(stateId)
                    )
                  )
                : stateCountryMap
            ),
            filterStateMap(currentPrice?.statePrices ?? {}),
            filterStateMap(currentPrice?.stateSupply ?? {}),
            filterStateMap(currentPrice?.stateDemand ?? {}),
            currentPrice?.globalPrice ?? basePrice,
            basePrice,
            currentPrice?.nationalPrices ?? {},
            stateCountryMap,
            COMMODITIES_NATIONAL_REGIONAL_PRICE_BLEND.has(commodity)
          )
        : {},
      stateSupply: includeHeavy ? filterStateMap(currentPrice?.stateSupply ?? {}) : {},
      stateDemand: includeHeavy ? filterStateMap(currentPrice?.stateDemand ?? {}) : {},
      nationalPrices: includeHeavy ? (currentPrice?.nationalPrices ?? {}) : {},
      nationalSupply: includeHeavy ? (currentPrice?.nationalSupply ?? {}) : {},
      nationalDemand: includeHeavy ? (currentPrice?.nationalDemand ?? {}) : {},
      // Per-country reachable books for the map's Reachable lens (ticket
      // #1077). Heavy-only: the light payload drives the header, which does not
      // render the map. Undefined rather than {} when no book is persisted, so
      // the client can tell "not available yet" from "every market is empty".
      reachableBooks: includeHeavy ? reachableBooksFor(reachableBooks, commodity) : undefined,
      turn: currentPrice?.turn ?? 0,
      history: history.map((h: CommodityPriceHistory) => ({
        turn: h.turn,
        price: h.globalPrice,
        supply: h.globalSupply,
        demand: h.globalDemand,
      })),
      suppliers,
      consumers,
      topProducers,
      topConsumers,
      topProducersByCountry,
      topConsumersByCountry,
      demandDriver,
      syntheticDemandSources,
      capacityByState,
      totalCapacity,
    };
  } catch (error) {
    throw error;
  }
}

/**
 * GET /api/commodities/[type]
 */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { type } = await params;
    const commodity = type as CommodityType;

    if (!COMMODITY_TYPES.includes(commodity)) {
      return NextResponse.json({ error: "Invalid commodity type" }, { status: 400 });
    }

    const data = await getCommodityDetailData(commodity);
    // Per-user (country-access filtered) payload — private ETag/304 only, never
    // shared-cached. Cuts egress on unchanged polls without a cross-user key.
    return conditionalJson(request, data);
  } catch (error) {
    return handleRouteError(error);
  }
}
