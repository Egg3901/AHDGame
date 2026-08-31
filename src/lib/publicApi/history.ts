import type { Db } from "mongodb";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { COMMODITY_LABELS, type CommodityType } from "@/lib/constants/commodities";

export const PUBLIC_HISTORY_DEFAULT_POINTS = 48;
export const PUBLIC_HISTORY_MAX_POINTS = 240;

export interface PublicHistoryRange {
  fromTurn?: number;
  toTurn?: number;
  limit?: number;
}

interface TurnRate {
  turn: number;
  rate: number;
}

export interface PublicHistoryPoint {
  turn: number;
  value: number;
}

export interface PublicCountryEconomyHistory {
  found: boolean;
  countryId: CountryId;
  countryName: string;
  range: { fromTurn: number | null; toTurn: number | null; limit: number };
  series: {
    primeRate: PublicHistoryPoint[];
    inflation: PublicHistoryPoint[];
    gdpGrowth: PublicHistoryPoint[];
  };
  fiscalYears: Array<{
    fiscalYear: number;
    turn: number;
    recordedAt: string;
    currencyCode: string | null;
    gdp: number;
    revenue: number;
    spending: number;
    surplus: number;
    debtPrincipal: number;
    debtToGdpRatio: number;
    creditRating: string;
    inflation: number;
  }>;
}

export interface PublicTradeFlowPoint {
  turn: number;
  recordedAt: string;
  world: { grossVolume: number; clearedVolume: number; unclearedSurplus: number };
  country?: {
    countryId: CountryId;
    exports: number;
    imports: number;
    net: number;
    topPartnerSurplus: { countryId: CountryId; net: number } | null;
    topPartnerDeficit: { countryId: CountryId; net: number } | null;
  } | null;
  commodity?: {
    key: CommodityType;
    label: string;
    worldVolume: number;
    country?: { exports: number; imports: number; net: number; uncleared: number } | null;
  } | null;
}

export interface PublicTradeFlowHistory {
  found: boolean;
  monetaryUnit: "anchor";
  filters: {
    country: CountryId | null;
    commodity: CommodityType | null;
    fromTurn: number | null;
    toTurn: number | null;
    limit: number;
  };
  points: PublicTradeFlowPoint[];
}

interface PublicCentralBankRow {
  countryId: CountryId;
  interestRateHistory?: TurnRate[];
  inflationHistory?: TurnRate[];
  gdpGrowthHistory?: TurnRate[];
}

interface PublicBudgetSnapshotRow {
  countryId: CountryId;
  fiscalYear: number;
  turn: number;
  createdAt: Date;
  budget: {
    currencyCode?: string;
    revenue: { total: number };
    spending: { total: number };
    debt: { principal: number };
    surplus: number;
    gdp: number;
    debtToGdpRatio: number;
    creditRating: string;
    economicFactors: { inflationRate: number };
  };
}

interface PublicNationalTradeRow {
  exports: number;
  imports: number;
  net: number;
  topPartnerSurplus?: { countryId: CountryId; net: number };
  topPartnerDeficit?: { countryId: CountryId; net: number };
}

interface PublicCommodityTradeRow {
  worldVolume: number;
  perCountry: Record<string, { exports: number; imports: number; net: number; uncleared: number }>;
}

interface PublicTradeFlowSnapshotRow {
  turn: number;
  updatedAt: Date;
  world: { grossVolume: number; clearedVolume: number; unclearedSurplus: number };
  national: Partial<Record<CountryId, PublicNationalTradeRow>>;
  commodities: Partial<Record<CommodityType, PublicCommodityTradeRow>>;
}

function normalizedRange(range: PublicHistoryRange) {
  return {
    fromTurn: range.fromTurn,
    toTurn: range.toTurn,
    limit: Math.min(
      Math.max(range.limit ?? PUBLIC_HISTORY_DEFAULT_POINTS, 1),
      PUBLIC_HISTORY_MAX_POINTS
    ),
  };
}

function selectRateHistory(
  points: TurnRate[] | undefined,
  range: PublicHistoryRange
): PublicHistoryPoint[] {
  const normalized = normalizedRange(range);
  return (points ?? [])
    .filter(
      (point) =>
        Number.isFinite(point.turn) &&
        Number.isFinite(point.rate) &&
        (normalized.fromTurn === undefined || point.turn >= normalized.fromTurn) &&
        (normalized.toTurn === undefined || point.turn <= normalized.toTurn)
    )
    .slice(-normalized.limit)
    .map((point) => ({ turn: point.turn, value: point.rate }));
}

function turnFilter(range: PublicHistoryRange): {
  turn?: { $gte?: number; $lte?: number };
} {
  const turn: { $gte?: number; $lte?: number } = {};
  if (range.fromTurn !== undefined) turn.$gte = range.fromTurn;
  if (range.toTurn !== undefined) turn.$lte = range.toTurn;
  return Object.keys(turn).length > 0 ? { turn } : {};
}

/**
 * Read public country history across the central-bank ring buffers and annual
 * fiscal snapshots. The interface hides both storage shapes and omits internal
 * policy drivers, actor ids, tax bases, and enacted-law implementation detail.
 */
export async function queryCountryEconomyHistory(
  db: Db,
  country: string,
  range: PublicHistoryRange = {}
): Promise<PublicCountryEconomyHistory | null> {
  const countryId = country.toUpperCase() as CountryId;
  const config = COUNTRY_CONFIGS[countryId];
  if (!config) return null;

  const normalized = normalizedRange(range);
  const fiscalFilter: { countryId: CountryId; turn?: { $gte?: number; $lte?: number } } = {
    countryId,
    ...turnFilter(normalized),
  };
  const [centralBank, fiscalDescending] = await Promise.all([
    db.collection<PublicCentralBankRow>("centralBanks").findOne(
      { countryId },
      {
        projection: {
          interestRateHistory: 1,
          inflationHistory: 1,
          gdpGrowthHistory: 1,
        },
      }
    ),
    db
      .collection<PublicBudgetSnapshotRow>("federalBudgetSnapshots")
      .find(fiscalFilter, {
        projection: {
          countryId: 1,
          fiscalYear: 1,
          turn: 1,
          createdAt: 1,
          "budget.currencyCode": 1,
          "budget.revenue.total": 1,
          "budget.spending.total": 1,
          "budget.debt.principal": 1,
          "budget.surplus": 1,
          "budget.gdp": 1,
          "budget.debtToGdpRatio": 1,
          "budget.creditRating": 1,
          "budget.economicFactors.inflationRate": 1,
        },
      })
      .sort({ turn: -1 })
      .limit(normalized.limit)
      .toArray(),
  ]);

  const series = {
    primeRate: selectRateHistory(centralBank?.interestRateHistory, normalized),
    inflation: selectRateHistory(centralBank?.inflationHistory, normalized),
    gdpGrowth: selectRateHistory(centralBank?.gdpGrowthHistory, normalized),
  };
  const fiscalYears = fiscalDescending.reverse().map((snapshot) => ({
    fiscalYear: snapshot.fiscalYear,
    turn: snapshot.turn,
    recordedAt:
      snapshot.createdAt instanceof Date
        ? snapshot.createdAt.toISOString()
        : String(snapshot.createdAt),
    currencyCode: snapshot.budget.currencyCode ?? null,
    gdp: snapshot.budget.gdp,
    revenue: snapshot.budget.revenue.total,
    spending: snapshot.budget.spending.total,
    surplus: snapshot.budget.surplus,
    debtPrincipal: snapshot.budget.debt.principal,
    debtToGdpRatio: snapshot.budget.debtToGdpRatio,
    creditRating: snapshot.budget.creditRating,
    inflation: snapshot.budget.economicFactors.inflationRate,
  }));

  return {
    found:
      fiscalYears.length > 0 ||
      series.primeRate.length > 0 ||
      series.inflation.length > 0 ||
      series.gdpGrowth.length > 0,
    countryId,
    countryName: config.name,
    range: {
      fromTurn: normalized.fromTurn ?? null,
      toTurn: normalized.toTurn ?? null,
      limit: normalized.limit,
    },
    series,
    fiscalYears,
  };
}

export interface PublicTradeFlowFilters extends PublicHistoryRange {
  country?: CountryId;
  commodity?: CommodityType;
}

/**
 * Return a bounded, chronological view of cleared world trade. The stored
 * reachable books and full bilateral matrices stay private; callers receive
 * only world totals and the country or commodity rollups they requested.
 */
export async function queryTradeFlowHistory(
  db: Db,
  filters: PublicTradeFlowFilters = {}
): Promise<PublicTradeFlowHistory> {
  const normalized = normalizedRange(filters);
  const snapshotsDescending = await db
    .collection<PublicTradeFlowSnapshotRow>("tradeFlowSnapshots")
    .find(turnFilter(normalized), {
      projection: {
        turn: 1,
        updatedAt: 1,
        world: 1,
        ...(filters.country ? { [`national.${filters.country}`]: 1 } : {}),
        ...(filters.commodity ? { [`commodities.${filters.commodity}`]: 1 } : {}),
      },
    })
    .sort({ turn: -1 })
    .limit(normalized.limit)
    .toArray();

  const points = snapshotsDescending.reverse().map((snapshot) => {
    const national = filters.country ? (snapshot.national[filters.country] ?? null) : null;
    const commodity = filters.commodity ? (snapshot.commodities[filters.commodity] ?? null) : null;
    const commodityCountry =
      commodity && filters.country ? (commodity.perCountry[filters.country] ?? null) : null;

    return {
      turn: snapshot.turn,
      recordedAt:
        snapshot.updatedAt instanceof Date
          ? snapshot.updatedAt.toISOString()
          : String(snapshot.updatedAt),
      world: snapshot.world,
      ...(filters.country && {
        country: national
          ? {
              countryId: filters.country,
              exports: national.exports,
              imports: national.imports,
              net: national.net,
              topPartnerSurplus: national.topPartnerSurplus ?? null,
              topPartnerDeficit: national.topPartnerDeficit ?? null,
            }
          : null,
      }),
      ...(filters.commodity && {
        commodity: commodity
          ? {
              key: filters.commodity,
              label: COMMODITY_LABELS[filters.commodity],
              worldVolume: commodity.worldVolume,
              ...(filters.country && {
                country: commodityCountry
                  ? {
                      exports: commodityCountry.exports,
                      imports: commodityCountry.imports,
                      net: commodityCountry.net,
                      uncleared: commodityCountry.uncleared,
                    }
                  : null,
              }),
            }
          : null,
      }),
    };
  });

  return {
    found: points.length > 0,
    monetaryUnit: "anchor",
    filters: {
      country: filters.country ?? null,
      commodity: filters.commodity ?? null,
      fromTurn: normalized.fromTurn ?? null,
      toTurn: normalized.toTurn ?? null,
      limit: normalized.limit,
    },
    points,
  };
}
