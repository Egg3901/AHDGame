import { aggregateByCountry } from "@/lib/commodity-map/commodityAggregation";
import { getStateDisplayName } from "@/lib/commodity-map";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { isStateRegister } from "@/lib/constants/exchangeRegistry";
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
  regionCount: number;
  stateSupply: Record<string, number>;
  stateDemand: Record<string, number>;
  statePrices: Record<string, number>;
  stateCountryMap: Record<string, string>;
  capacityByState?: Record<string, number>;
  totalCapacity?: number;
  topProducers: CorpVolume[];
  topConsumers: CorpVolume[];
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
      regionCount: Object.keys(stateCountryMap).length,
      stateSupply: data.stateSupply,
      stateDemand: data.stateDemand,
      statePrices: data.statePrices,
      stateCountryMap,
      capacityByState: data.capacityByState,
      totalCapacity: data.totalCapacity,
      topProducers: data.topProducers,
      topConsumers: data.topConsumers,
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
    regionCount: Object.keys(countryStateCountryMap).length,
    stateSupply: countryStateSupply,
    stateDemand: countryStateDemand,
    statePrices: countryStatePrices,
    stateCountryMap: countryStateCountryMap,
    capacityByState: countryCapacityByState,
    totalCapacity: sumValues(countryCapacityByState),
    topProducers: data.topProducersByCountry?.[activeCountry] ?? [],
    topConsumers: data.topConsumersByCountry?.[activeCountry] ?? [],
    syntheticDemandSources: [],
  };
}
