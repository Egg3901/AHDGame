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
import { SECTOR_STRATEGIES } from "@/lib/constants/sectorStrategies";
import { getStateResourceCapacityCollection } from "@/lib/db/collections/stateResourceCapacity";
import { computeRollingAnnualizedPercentChange } from "@/lib/utils/rollingAnnualizedChange";
import {
  fxRateForSectorHostFromMap,
  loadFxRatesByCurrency,
  resolveSectorHostCurrencyCode,
} from "@/lib/currency/corporationCapital";
import { readCorpEconomicAnchor } from "@/lib/currency/corpEconomyFields";
import { COUNTRY_CURRENCY_MAP, eraRateForCurrency } from "@/lib/constants/currencies";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { loadWorldPreset } from "@/lib/currency/gdpAnchorRate";
import { getEraUnitScale } from "@/lib/constants/sectorSeedEra";
import {
  aggregateRealizedCommodityVolumes,
  isExtractionExceptionCommodity,
  REALIZED_COMMODITY_ROUNDING_DECIMALS,
  REALIZED_COMMODITY_ROUNDING_UNIT,
} from "@/lib/commodities/realizedCommodityBasis";
import type { RealizedLeaderboardSector } from "@/lib/commodities/realizedCommodityBasis";

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
        code: resolveSectorHostCurrencyCode(
          { countryId: (c.countryId ?? c.countryOwnerId) as string | null },
          c
        ),
        rate: fxRateForSectorHostFromMap(
          { countryId: (c.countryId ?? c.countryOwnerId) as string | null },
          c,
          fxByCurrency
        ),
      });
    }
    // NOTE: fxByCorpId intentionally uses sector-host resolution (home country
    // fallback), matching the corporation commodities route, so the retail
    // synthetic leg and the realized leaderboard below normalize on the same
    // anchor basis the world supply ledger uses.

    // World context for the realized physical-unit basis (same turn, same
    // scope as the corporation tab). Loaded once; the leaderboard aggregation
    // below runs every sector through `computeSectorCommodityUnits`, the exact
    // chain `computeCorpCommodityFlows` uses.
    const worldPreset = includeHeavy ? await loadWorldPreset(db) : "modern";
    const eraUnitScale = getEraUnitScale(worldPreset);
    const [gameConfigDoc, gameStateDoc, stateResourceDocs] = includeHeavy
      ? await Promise.all([
          db
            .collection<{ _id: string; commandEconomyEnabled?: boolean }>("gameConfig")
            .findOne({ _id: "default" }, { projection: { commandEconomyEnabled: 1 } }),
          db
            .collection<{ _id: string; currentYear?: number }>("gameState")
            .findOne({ _id: "current" }, { projection: { currentYear: 1 } }),
          (await getStateResourceCapacityCollection(db))
            .find({}, { projection: { stateId: 1, resources: 1 } })
            .toArray(),
        ])
      : [null, null, [] as { stateId: string; resources?: Record<string, number> | null }[]];
    // Command-economy currencies are deliberately untraded and have no
    // exchangeRates row; fill only the absent ones from the authored preset,
    // exactly like the corporation commodities route. Live rates win.
    if (includeHeavy) {
      for (const code of Object.values(COUNTRY_CURRENCY_MAP) as CurrencyCode[]) {
        if (fxByCurrency.has(code)) continue;
        const authoredRate = eraRateForCurrency(code, worldPreset);
        if (authoredRate !== undefined) fxByCurrency.set(code, authoredRate);
      }
    }
    const stateResourcesByState = new Map(
      (stateResourceDocs ?? []).map((doc) => [doc.stateId, doc.resources ?? null])
    );

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

    // Advertising-budget demand, kept OUT of corporate input consumption and
    // reported as its own labelled row (see below). It is market-level demand
    // generated from marketing budgets, not plant input use.
    const advertisingBudgetByCorp = new Map<string, number>();
    let advertisingBudgetTotal = 0;

    if (includeHeavy) {
      // Realized physical-unit basis, shared with the corporation tab: every
      // sector runs through `computeSectorCommodityUnits` (measured production
      // + utilization-scaled inputs), the exact chain behind
      // `computeCorpCommodityFlows`. Revenue / price never masquerades as
      // realized output. Extraction keeps the documented exception (nameplate
      // plus state-capacity filter; unpersisted turn factors are not
      // reconstructed).
      const natcorpIds = new Set(
        allCorps.filter((c) => !!c.countryOwnerId).map((c) => c._id.toString())
      );
      const mode = await getMarketSystemMode();
      const realizedSectors: RealizedLeaderboardSector[] = allSectors.map((sector) => {
        const corpId = sector.corporationId.toString();
        const corp = corpMap.get(corpId);
        const hostCurrencyCode = resolveSectorHostCurrencyCode(
          {
            countryId:
              (sector.countryId as string | null | undefined) ??
              stateCountryMap[sector.stateId] ??
              corp?.countryId ??
              corp?.countryOwnerId ??
              null,
          },
          corp ?? null
        );
        return {
          sectorType: sector.sectorType,
          stateId: sector.stateId,
          countryId:
            (sector.countryId as string | null | undefined) ??
            stateCountryMap[sector.stateId] ??
            null,
          revenue: sector.revenue,
          strategyId: sector.strategyId,
          transitionFromStrategyId: sector.transitionFromStrategyId,
          transitionStartTurn: sector.transitionStartTurn,
          revenueAnchor: readCorpEconomicAnchor(
            sector.revenue,
            hostCurrencyCode,
            fxRateForSectorHostFromMap(
              {
                countryId:
                  (sector.countryId as string | null | undefined) ??
                  stateCountryMap[sector.stateId] ??
                  corp?.countryId ??
                  corp?.countryOwnerId ??
                  null,
              },
              corp ?? null,
              fxByCurrency
            )
          ),
          producedUnits: sector.producedUnits,
          capacityUnits: sector.operatingCapacityUnits ?? sector.capitalStock ?? null,
          mothballed: sector.mothballed,
          productionPolicyLevel: sector.productionPolicyLevel,
          embargoSuspended: sector.embargoSuspended,
          embargoExportExposure: sector.embargoExportExposure,
          militaryDivertedFraction: sector.militaryDivertedFraction,
          militaryDivertedTurn: sector.militaryDivertedTurn,
          corporationId: corpId,
          isNatcorp: natcorpIds.has(corpId),
        };
      });
      const realized = aggregateRealizedCommodityVolumes(
        realizedSectors,
        commodity,
        currentTurn,
        {
          plantsEnabled: marketAtLeast(mode, "plants"),
          eraUnitScale,
          currentYear: gameStateDoc?.currentYear ?? null,
          commandEconomyEnabled: gameConfigDoc?.commandEconomyEnabled === true,
          stateResourcesByState,
        },
        (stateId) => stateCountryMap[stateId]
      );
      const corpSupply = realized.supplyByCorp;
      const corpDemand = realized.demandByCorp;
      const corpSupplyByCountry = realized.supplyByCountry as Map<CountryId, Map<string, number>>;
      const corpDemandByCountry = realized.demandByCountry as Map<CountryId, Map<string, number>>;

      // Advertising-budget demand is computed but NOT folded into corporate
      // consumption: it stays a separately labelled market-level row.
      if (commodity === "advertising") {
        for (const corp of allCorps) {
          if (!(corp.marketingBudget > 0)) continue;
          const corpId = corp._id.toString();
          const fx = fxByCorpId.get(corpId);
          const budgetAnchor = readCorpEconomicAnchor(
            corp.marketingBudget,
            fx?.code,
            fx?.rate ?? 1
          );
          const msUnits = dollarsToUnits(
            budgetAnchor * MARKETING_ADVERTISING_DEMAND_RATE,
            basePrice
          );
          if (msUnits > 0) {
            advertisingBudgetByCorp.set(corpId, msUnits);
            advertisingBudgetTotal += msUnits;
          }
        }
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
        description: `Driven by marketing spending. Corporations allocate marketing budgets that convert to advertising commodity demand at a ${(MARKETING_ADVERTISING_DEMAND_RATE * 100).toFixed(0)}% rate. That budget demand is market-level demand reported separately below — Top Consumers shows plant input demand only, on the same realized basis as corporation commodity pages.`,
        ...(includeHeavy && advertisingBudgetTotal > 0
          ? {
              sourceLabel: "Marketing-budget demand (separate from corporate consumption)",
              sourceUnits: Math.round(advertisingBudgetTotal * 100) / 100,
              consumerNote:
                "Top Consumers shows realized plant input demand only. Marketing-budget demand is listed separately under system demand, not as corporation consumption.",
            }
          : {}),
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

    // Advertising-budget demand is market-level demand, not corporation input
    // consumption: it stays visible here as a labelled system row instead of
    // inflating any corporation's Top Consumers figure.
    if (includeHeavy && commodity === "advertising" && advertisingBudgetTotal > 0) {
      syntheticDemandSources.push({
        name: "Corporate Marketing Budgets",
        type: "system",
        units: Math.round(advertisingBudgetTotal * 100) / 100,
        description:
          "Market-level advertising demand generated from corporation marketing budgets. Reported separately — it is not plant input consumption and never appears in a corporation's Top Consumers figure.",
      });
    }

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
      priceAttribution: currentPrice?.priceAttribution ?? null,
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
      // Documented realized physical-unit basis shared with the corporation
      // commodity tab (see `realizedCommodityBasis`). Same turn, same
      // geographic scope; per-corp volumes round to
      // REALIZED_COMMODITY_ROUNDING_DECIMALS decimals.
      volumeBasis: {
        basis: "realized_physical_units" as const,
        turn: currentTurn,
        roundingDecimals: REALIZED_COMMODITY_ROUNDING_DECIMALS,
        roundingTolerance: REALIZED_COMMODITY_ROUNDING_UNIT,
        extractionException: isExtractionExceptionCommodity(commodity),
        advertisingBudgetSeparate: commodity === "advertising",
      },
      // Marketing-budget demand per corporation, deliberately NOT part of Top
      // Consumers. Null when the commodity is not advertising.
      advertisingBudgetDemand:
        commodity === "advertising"
          ? {
              total: Math.round(advertisingBudgetTotal * 100) / 100,
              byCorp: buildCorpVolumeRows(advertisingBudgetByCorp.entries(), corpMap),
            }
          : null,
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
