/**
 * How player currency trading moves exchange rates. computeCurrencyVolumes sums
 * buy and sell volume per currency from the last VOLUME_LOOKBACK_TURNS turns of
 * trade history, normalized to internal units, and feeds the net buy minus sell
 * pressure into the rate formula.
 */
/**
 * Compute gross buy/sell volume per currency from trade history.
 *
 * The forex turn phase calls this once per turn to get the volume data
 * that feeds into the volume pressure component of the rate formula.
 *
 * Unit invariant (fixed 2026-04-15): both `buyVolume24` and `sellVolume24`
 * are accumulated in **internal (₳) units**. The prior implementation used
 * `trade.amount` (always in fromCurrency) for BOTH sides, which left
 * `buyVolume24[X]` as a meaningless mix of fromCurrency denominations
 * whenever X appeared on the `to` side — biasing net pressure (especially
 * for USD, which is the `to` side of most JPY/GBP → USD flows).
 *
 * Normalization: `internal = amount / rate_of_fromCurrency` for each trade,
 * attributed equally to both sides (sell on fromCurrency, buy on toCurrency).
 * This keeps VOLUME_PRESSURE_SENSITIVITY unit-agnostic and makes
 * `netVolume = buy - sell` a real directional demand signal.
 *
 * See docs/design/currency-exchange.md "Player Volume Pressure" section.
 */

import type { Db } from "mongodb";
import type { ExchangeRate, TradeHistoryEntry } from "@/lib/db/types";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { VOLUME_LOOKBACK_TURNS, FOREX_ACTIVE_CURRENCIES } from "@/lib/constants/currencies";
import type { VolumeInputs } from "./rateCalculation";

/** Volume data keyed by currency code */
export type CurrencyVolumeMap = Record<CurrencyCode, VolumeInputs>;

export async function computeCurrencyVolumes(
  db: Db,
  currentTurn: number
): Promise<CurrencyVolumeMap> {
  const lookbackStart = Math.max(1, currentTurn - VOLUME_LOOKBACK_TURNS);

  const [trades, rates] = await Promise.all([
    db
      .collection<TradeHistoryEntry>("tradeHistory")
      .find({ turn: { $gte: lookbackStart } })
      .toArray(),
    db.collection<ExchangeRate>("exchangeRates").find({}).toArray(),
  ]);

  const rateByCode = new Map<string, number>(rates.map((r) => [r.currencyCode, r.rate]));

  // Initialize all active currencies with zero volume
  const volumes: CurrencyVolumeMap = {} as CurrencyVolumeMap;
  for (const code of FOREX_ACTIVE_CURRENCIES) {
    volumes[code] = { buyVolume24: 0, sellVolume24: 0 };
  }

  for (const trade of trades) {
    const from = trade.fromCurrency;
    const to = trade.toCurrency;

    // Normalize the trade's notional to internal units via fromCurrency rate.
    // Derivation: `amount` is in `from` units; `from_rate` is "from per internal",
    // so internal_value = amount / from_rate. Equivalently, this also equals
    // (amount * crossRate) / to_rate, i.e. the same internal value of the trade
    // regardless of which side you compute from — so both legs attribute the
    // same amount of directional pressure to their respective currencies.
    const fromRate = rateByCode.get(from) ?? 1;
    const internalValue = fromRate > 0 ? trade.amount / fromRate : trade.amount;

    if (volumes[from]) {
      volumes[from].sellVolume24 += internalValue;
    }
    if (volumes[to]) {
      volumes[to].buyVolume24 += internalValue;
    }
  }

  return volumes;
}
