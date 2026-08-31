import type { Db } from "mongodb";
import type { ExchangeRate } from "@/lib/db/types";
import type { CurrencyCode } from "@/lib/constants/currencies";

function percentChange(value: number, base: number): number | null {
  if (!Number.isFinite(value) || !Number.isFinite(base) || base === 0) return null;
  return Math.round((value / base - 1) * 100 * 100) / 100;
}

function mapRate(row: ExchangeRate, historyLimit = 0) {
  const policy = row.interventionPolicy;
  const history = historyLimit > 0 ? (row.rateHistory ?? []).slice(-historyLimit) : undefined;
  return {
    countryId: row.countryId,
    currencyCode: row.currencyCode,
    rate: row.rate,
    baseRate: row.baseRate,
    macroTarget: row.macroTarget,
    changeFromBasePct: percentChange(row.rate, row.baseRate),
    deviationFromTargetPct: percentChange(row.rate, row.macroTarget),
    volume24: {
      buy: row.buyVolume24 ?? 0,
      sell: row.sellVolume24 ?? 0,
      net: (row.buyVolume24 ?? 0) - (row.sellVolume24 ?? 0),
    },
    regime: {
      type: row.fxRegime ?? (row.hardPeg ? "peg" : "float"),
      pegTarget: row.pegTarget ?? row.hardPeg ?? null,
      capitalControls: row.capitalControls ?? false,
    },
    interventionBand: policy
      ? {
          floor: policy.floor,
          ceiling: policy.ceiling,
          setAtTurn: policy.setAtTurn,
          defending: row.rate < policy.floor || row.rate > policy.ceiling,
        }
      : null,
    cyclePressure: row.cyclePressureRegime
      ? {
          regime: row.cyclePressureRegime,
          untilTurn: row.cyclePressureUntilTurn ?? null,
        }
      : null,
    spreadStrength: row.forexSpreadStrength ?? 1,
    updatedAt: row.updatedAt?.toISOString() ?? null,
    ...(history
      ? {
          history: history.map((point) => ({ turn: point.turn, rate: point.rate })),
        }
      : {}),
  };
}

export async function queryForexRates(db: Db) {
  const rows = await db
    .collection<ExchangeRate>("exchangeRates")
    .find({})
    .sort({ currencyCode: 1 })
    .toArray();
  return { found: rows.length > 0, currencies: rows.map((row) => mapRate(row)) };
}

export async function queryForexCurrency(db: Db, currency: CurrencyCode, historyLimit = 48) {
  const row = await db
    .collection<ExchangeRate>("exchangeRates")
    .findOne({ currencyCode: currency });
  return row ? mapRate(row, historyLimit) : null;
}
