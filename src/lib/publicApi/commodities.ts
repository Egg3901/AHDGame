import type { Db } from "mongodb";
import type { CommodityPrice } from "@/lib/db/types";
import {
  COMMODITY_TYPES,
  COMMODITY_LABELS,
  COMMODITY_BASE_PRICES,
  COMMODITY_UNITS,
  type CommodityType,
} from "@/lib/constants/commodities";

export async function queryCommodities(db: Db, params: { country?: string }) {
  const { country } = params;

  const prices = await db.collection<CommodityPrice>("commodityPrices").find({}).toArray();
  const priceMap = new Map(prices.map((p) => [p.commodity, p]));

  const result = COMMODITY_TYPES.map((commodity) => {
    const data = priceMap.get(commodity);
    const basePrice = COMMODITY_BASE_PRICES[commodity];
    const nationalPrice =
      country && data?.nationalPrices ? (data.nationalPrices[country] ?? null) : null;
    const nationalSupply =
      country && data?.nationalSupply ? (data.nationalSupply[country] ?? null) : null;
    const nationalDemand =
      country && data?.nationalDemand ? (data.nationalDemand[country] ?? null) : null;

    return {
      key: commodity,
      label: COMMODITY_LABELS[commodity],
      unit: COMMODITY_UNITS[commodity],
      basePrice,
      globalPrice: data?.globalPrice ?? basePrice,
      globalSupply: data?.globalSupply ?? 0,
      globalDemand: data?.globalDemand ?? 0,
      ...(country !== undefined && {
        nationalPrice,
        nationalSupply,
        nationalDemand,
      }),
      turn: data?.turn ?? 0,
    };
  });

  return { commodities: result };
}

export async function queryCommodityDetail(db: Db, params: { key: string; country?: string }) {
  const { key, country } = params;

  if (!COMMODITY_TYPES.includes(key as CommodityType)) return null;
  const commodity = key as CommodityType;

  const data = await db.collection<CommodityPrice>("commodityPrices").findOne({ commodity });

  const basePrice = COMMODITY_BASE_PRICES[commodity];

  const statePrices = data?.statePrices ?? {};
  const stateSupply = data?.stateSupply ?? {};
  const stateDemand = data?.stateDemand ?? {};

  // Filter state-level data by country if provided
  const filterState = country
    ? async () => {
        const states = await db
          .collection("states")
          .find({ countryId: country })
          .project<{ _id: string }>({ _id: 1 })
          .toArray();
        const stateIds = new Set(states.map((s) => s._id));
        const filteredPrices: Record<string, number> = {};
        const filteredSupply: Record<string, number> = {};
        const filteredDemand: Record<string, number> = {};
        for (const id of stateIds) {
          if (statePrices[id] !== undefined) filteredPrices[id] = statePrices[id];
          if (stateSupply[id] !== undefined) filteredSupply[id] = stateSupply[id];
          if (stateDemand[id] !== undefined) filteredDemand[id] = stateDemand[id];
        }
        return { prices: filteredPrices, supply: filteredSupply, demand: filteredDemand };
      }
    : async () => ({ prices: statePrices, supply: stateSupply, demand: stateDemand });

  const filtered = await filterState();

  // Top producers / consumers by state supply/demand
  const topProducers = Object.entries(filtered.supply)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([stateId, supply]) => ({ stateId, supply }));

  const topConsumers = Object.entries(filtered.demand)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([stateId, demand]) => ({ stateId, demand }));

  const nationalPrice =
    country && data?.nationalPrices ? (data.nationalPrices[country] ?? null) : null;
  const nationalSupply =
    country && data?.nationalSupply ? (data.nationalSupply[country] ?? null) : null;
  const nationalDemand =
    country && data?.nationalDemand ? (data.nationalDemand[country] ?? null) : null;

  return {
    key: commodity,
    label: COMMODITY_LABELS[commodity],
    unit: COMMODITY_UNITS[commodity],
    basePrice,
    globalPrice: data?.globalPrice ?? basePrice,
    globalSupply: data?.globalSupply ?? 0,
    globalDemand: data?.globalDemand ?? 0,
    ...(country !== undefined && {
      nationalPrice,
      nationalSupply,
      nationalDemand,
    }),
    statePrices: filtered.prices,
    stateSupply: filtered.supply,
    stateDemand: filtered.demand,
    topProducers,
    topConsumers,
    turn: data?.turn ?? 0,
  };
}
