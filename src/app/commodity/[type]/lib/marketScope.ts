import { aggregateByCountry } from "@/lib/commodity-map/commodityAggregation";
import { getStateDisplayName } from "@/lib/commodity-map";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { isStateRegister } from "@/lib/constants/exchangeRegistry";
import { importCoverage, stateImportsShare } from "@/lib/trade/postImportGap";
import type { CommodityDetail, CorpVolume, SyntheticDemandSource } from "../types";

export interface CommodityMarketScope {
  activeCountry: CountryId | null;
  activeState: string | null;
  marketLabel: string;
  marketCaption: string;
  marketPrice: number;
  priceChange: number;
  supply: number;
  demand: number;
  balance: number;
  /**
   * Units imported into this market, or null when imports are unknown (global
   * view, or a world without reachable books). Display-only: `balance` stays
   * the own-production figure and callers net this out via `postImportBalance`.
   */
  imports: number | null;
  /** Imports attributed to each state in scope (deficit-weighted); empty when unknown. */
  stateImports: Record<string, number>;
  regionCount: number;
  stateSupply: Record<string, number>;
  stateDemand: Record<string, number>;
  statePrices: Record<string, number>;
  stateCountryMap: Record<string, string>;
  capacityByState?: Record<string, number>;
  totalCapacity?: number;
  topProducers: CorpVolume[];
  topConsumers: CorpVolume[];
  marketingBudgets?: CommodityDetail["marketingBudgets"];
  syntheticDemandSources: SyntheticDemandSource[];
}

function percentChangeFromBase(value: number, basePrice: number): number {
  if (basePrice <= 0) return 0;
  return Math.round(((value - basePrice) / basePrice) * 10000) / 100;
}

function filterStateMap<T extends number>(
  map: Record<string, T> | undefined,
  countryId: CountryId | null,
  stateCountryMap: Record<string, string>
): Record<string, T> {
  if (!map) return {};
  if (!countryId) return map;
  return Object.fromEntries(
    Object.entries(map).filter(([stateId]) => stateCountryMap[stateId] === countryId)
  );
}

function sumValues(map: Record<string, number> | undefined): number {
  if (!map) return 0;
  return Object.values(map).reduce((sum, value) => sum + value, 0);
}

/** Imports booked for a country, or null when this world has no reachable books. */
function countryImports(data: CommodityDetail, countryId: string | undefined): number | null {
  if (!countryId) return null;
  const book = data.reachableBooks?.[countryId];
  return book ? Math.max(0, book.imports) : null;
}

function allocateStateImports(
  data: CommodityDetail,
  countryId: string | undefined,
  stateIds: string[]
): Record<string, number> {
  const imports = countryImports(data, countryId);
  if (imports === null || !countryId) return {};
  const supply =
    data.nationalSupply?.[countryId] ??
    stateIds.reduce((sum, id) => sum + (data.stateSupply?.[id] ?? 0), 0);
  const demand =
    data.nationalDemand?.[countryId] ??
    stateIds.reduce((sum, id) => sum + (data.stateDemand?.[id] ?? 0), 0);
  const coverage = importCoverage(supply, demand, imports);
  return Object.fromEntries(
    stateIds.map((id) => [
      id,
      stateImportsShare(data.stateSupply?.[id] ?? 0, data.stateDemand?.[id] ?? 0, coverage),
    ])
  );
}

export function buildCommodityMarketScope(
  data: CommodityDetail,
  activeCountry: CountryId | null,
  activeState?: string | null
): CommodityMarketScope {
  const stateCountryMap = data.stateCountryMap ?? {};

  if (activeState) {
    // stateCountryMap comes from the server as Record<string, string>. If a
    // state maps to a country code the client no longer has a config for
    // (removed/renamed country, stale seed data), treating it as a trusted
    // CountryId crashes every COUNTRY_CONFIGS[stateCountry] lookup below and
    // downstream (HeroPanel, drilldown view). Validate before trusting it.
    const rawStateCountry = stateCountryMap[activeState];
    const stateCountry =
      (rawStateCountry && rawStateCountry in COUNTRY_CONFIGS
        ? (rawStateCountry as CountryId)
        : undefined) ?? activeCountry;
    const stateSupply = data.stateSupply?.[activeState] ?? 0;
    const stateDemand = data.stateDemand?.[activeState] ?? 0;
    const statePrice = data.statePrices?.[activeState] ?? data.basePrice;
    const stateName = stateCountry ? getStateDisplayName(stateCountry, activeState) : activeState;
    const singleStateMap: Record<string, string> = stateCountry
      ? { [activeState]: stateCountry }
      : {};
    const countryStateIds = Object.keys(stateCountryMap).filter(
      (id) => stateCountry && stateCountryMap[id] === stateCountry
    );
    const allStateImports = allocateStateImports(data, stateCountry ?? undefined, countryStateIds);
    const activeStateImports = activeState in allStateImports ? allStateImports[activeState] : null;

    return {
      activeCountry: stateCountry ?? null,
      activeState,
      marketLabel: `${stateName} Market`,
      marketCaption: stateCountry
        ? `Filtered to ${stateName}, ${COUNTRY_CONFIGS[stateCountry]?.name ?? stateCountry}.`
        : `Filtered to ${stateName}.`,
      marketPrice: statePrice,
      priceChange: percentChangeFromBase(statePrice, data.basePrice),
      supply: stateSupply,
      demand: stateDemand,
      balance: stateSupply - stateDemand,
      imports: activeStateImports,
      stateImports: activeStateImports === null ? {} : { [activeState]: activeStateImports },
      regionCount: 1,
      stateSupply: { [activeState]: stateSupply },
      stateDemand: { [activeState]: stateDemand },
      statePrices: { [activeState]: statePrice },
      stateCountryMap: singleStateMap,
      capacityByState:
        data.capacityByState?.[activeState] !== undefined
          ? { [activeState]: data.capacityByState[activeState] }
          : undefined,
      totalCapacity: data.capacityByState?.[activeState],
      topProducers: (stateCountry ? data.topProducersByCountry?.[stateCountry] : undefined) ?? [],
      topConsumers: (stateCountry ? data.topConsumersByCountry?.[stateCountry] : undefined) ?? [],
      marketingBudgets: data.marketingBudgets?.filter(
        (row) => row.headquartersState === activeState
      ),
      syntheticDemandSources: [],
    };
  }

  if (!activeCountry) {
    return {
      activeCountry: null,
      activeState: null,
      marketLabel: "Global Market",
      marketCaption: "Aggregated across all enabled countries.",
      marketPrice: data.globalPrice,
      priceChange: data.priceChange,
      supply: data.globalSupply,
      demand: data.globalDemand,
      balance: data.globalSupply - data.globalDemand,
      imports: null,
      stateImports: {},
      regionCount: Object.keys(stateCountryMap).length,
      stateSupply: data.stateSupply,
      stateDemand: data.stateDemand,
      statePrices: data.statePrices,
      stateCountryMap,
      capacityByState: data.capacityByState,
      totalCapacity: data.totalCapacity,
      topProducers: data.topProducers,
      topConsumers: data.topConsumers,
      marketingBudgets: data.marketingBudgets,
      syntheticDemandSources: data.syntheticDemandSources,
    };
  }

  const countryStateCountryMap = Object.fromEntries(
    Object.entries(stateCountryMap).filter(([, countryId]) => countryId === activeCountry)
  );
  const countryStateSupply = filterStateMap(data.stateSupply, activeCountry, stateCountryMap);
  const countryStateDemand = filterStateMap(data.stateDemand, activeCountry, stateCountryMap);
  const countryStatePrices = filterStateMap(data.statePrices, activeCountry, stateCountryMap);
  const countryCapacityByState = filterStateMap(
    data.capacityByState,
    activeCountry,
    stateCountryMap
  );

  const countryRollups = aggregateByCountry(
    data.stateSupply,
    data.stateDemand,
    data.statePrices,
    new Map(Object.entries(stateCountryMap) as [string, CountryId][]),
    data.basePrice,
    data.globalPrice,
    data.nationalSupply,
    data.nationalDemand
  );
  const countryRollup = countryRollups[activeCountry];
  const supply =
    data.nationalSupply?.[activeCountry] ?? countryRollup?.supply ?? sumValues(countryStateSupply);
  const demand =
    data.nationalDemand?.[activeCountry] ?? countryRollup?.demand ?? sumValues(countryStateDemand);
  const marketPrice =
    data.nationalPrices?.[activeCountry] ?? countryRollup?.avgPrice ?? data.globalPrice;
  // Only a real bourse names the commodity market. A command economy's state
  // register is a listing venue for its enterprises, not a price-setting
  // exchange, so it falls back to the country name ("Russia Market", not
  // "GOSPLAN Market") — the same branch venue-less countries already took.
  const activeCountryConfig = COUNTRY_CONFIGS[activeCountry] as
    (typeof COUNTRY_CONFIGS)[CountryId] | undefined;
  const marketVenue = isStateRegister(activeCountry)
    ? undefined
    : activeCountryConfig?.exchangeName;
  const exchangeName = marketVenue ?? activeCountryConfig?.name ?? activeCountry;

  return {
    activeCountry,
    activeState: null,
    marketLabel: `${exchangeName} Market`,
    marketCaption: `Filtered to ${activeCountryConfig?.name ?? activeCountry}.`,
    marketPrice,
    priceChange: percentChangeFromBase(marketPrice, data.basePrice),
    supply,
    demand,
    balance: supply - demand,
    imports: countryImports(data, activeCountry),
    stateImports: allocateStateImports(data, activeCountry, Object.keys(countryStateCountryMap)),
    regionCount: Object.keys(countryStateCountryMap).length,
    stateSupply: countryStateSupply,
    stateDemand: countryStateDemand,
    statePrices: countryStatePrices,
    stateCountryMap: countryStateCountryMap,
    capacityByState: countryCapacityByState,
    totalCapacity: sumValues(countryCapacityByState),
    topProducers: data.topProducersByCountry?.[activeCountry] ?? [],
    topConsumers: data.topConsumersByCountry?.[activeCountry] ?? [],
    marketingBudgets: data.marketingBudgets?.filter((row) => row.countryId === activeCountry),
    syntheticDemandSources: [],
  };
}
