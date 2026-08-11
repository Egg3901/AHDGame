"use client";

import Link from "next/link";
import type { ExchangeRateDisplay } from "@/app/country/[code]/forex/types";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { CURRENCY_SYMBOLS } from "@/lib/constants/currencies";
import { formatCurrencyFaceAmount } from "@/lib/currency/formatCurrencyFaceAmount";
import {
  CURRENCY_COLORS,
  CURRENCY_NAMES,
  CURRENCY_FLAG_CODE,
} from "@/components/forex/currencyDisplay";
import { CountryFlag } from "@/components/CountryFlag";

interface Props {
  rates: ExchangeRateDisplay[];
  /**
   * Non-player currencies shown in a collapsed accordion (westernized econ-only
   * first). Omit or pass [] to hide the accordion.
   */
  otherRates?: ExchangeRateDisplay[];
  /**
   * Row Trade — same semantics as the currency detail page: trade vs home toward `currency`
   * (parent supplies home + counter leg when row is home).
   */
  onOpenTradeForCurrency?: (currency: CurrencyCode) => void;
  countryCode?: string; // used to build detail page URLs, defaults to "us"
}

function RateRow({
  rate,
  countryCode,
  rowIdx,
  onOpenTradeForCurrency,
}: {
  rate: ExchangeRateDisplay;
  countryCode: string;
  rowIdx: number;
  onOpenTradeForCurrency?: (currency: CurrencyCode) => void;
}) {
  const code = rate.currencyCode;
  const name = CURRENCY_NAMES[code] ?? code;
  const color = CURRENCY_COLORS[code] ?? "var(--color-muted)";
  const change = rate.strengthVsBase;
  const buyVol = rate.buyVolume24 ?? 0;
  const sellVol = rate.sellVolume24 ?? 0;
  const buyNative = Math.round(buyVol * rate.rate);
  const sellNative = Math.round(sellVol * rate.rate);

  return (
    <tr className={rowIdx % 2 === 0 ? "bg-card" : "bg-card-elevated/50"}>
      <td className="px-4 py-3">
        <Link
          href={`/country/${countryCode}/forex/${code}`}
          className="flex items-center gap-2 group"
        >
          <CountryFlag
            country={(CURRENCY_FLAG_CODE[code] ?? code).toUpperCase()}
            size="sm"
            className="rounded-[2px] shrink-0"
          />
          <div>
            <div className="flex items-center gap-1.5">
              <span
                className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-bold"
                style={{ backgroundColor: color + "1a", color }}
              >
                {CURRENCY_SYMBOLS[code] ?? code} {code}
              </span>
            </div>
            <div className="text-xs text-muted mt-0.5">{name}</div>
          </div>
        </Link>
      </td>

      <td className="px-4 py-3 text-right">
        <div className="font-mono font-medium tabular-nums text-foreground">
          {rate.rate >= 10 ? rate.rate.toFixed(2) : rate.rate.toFixed(4)}
          <span className="text-muted text-[10px] ml-1">{CURRENCY_SYMBOLS[code] ?? code}/₳</span>
        </div>
        {rate.rate > 0 && (
          <div className="text-[10px] text-muted/60 font-mono tabular-nums mt-0.5">
            1 {code} = {(1 / rate.rate).toFixed(4)} ₳
          </div>
        )}
      </td>

      <td className="px-4 py-3 text-right">
        <span
          className={`tabular-nums font-medium text-xs ${
            change > 0 ? "text-success" : change < 0 ? "text-error" : "text-muted"
          }`}
        >
          {change > 0 ? "+" : ""}
          {change.toFixed(2)}%
        </span>
      </td>

      <td className="px-4 py-3 text-right text-muted font-mono text-xs hidden sm:table-cell">
        {buyVol > 0 ? (
          <span title={`${formatCurrencyFaceAmount(buyNative, code)} (24 turns)`}>
            {formatCurrencyFaceAmount(buyNative, code)}
          </span>
        ) : (
          <span className="text-muted/40">—</span>
        )}
      </td>

      <td className="px-4 py-3 text-right text-muted font-mono text-xs hidden sm:table-cell">
        {sellVol > 0 ? (
          <span title={`${formatCurrencyFaceAmount(sellNative, code)} (24 turns)`}>
            {formatCurrencyFaceAmount(sellNative, code)}
          </span>
        ) : (
          <span className="text-muted/40">—</span>
        )}
      </td>

      <td className="px-4 py-3 text-right">
        <button
          onClick={(e) => {
            e.preventDefault();
            onOpenTradeForCurrency?.(code);
          }}
          className="rounded-md bg-primary/10 px-3 py-1 text-xs font-medium text-primary hover:bg-primary/20 transition-colors"
        >
          Trade
        </button>
      </td>
    </tr>
  );
}

function RatesTableBody({
  rates,
  countryCode,
  onOpenTradeForCurrency,
}: {
  rates: ExchangeRateDisplay[];
  countryCode: string;
  onOpenTradeForCurrency?: (currency: CurrencyCode) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-card-border bg-card-elevated">
            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">
              Currency
            </th>
            <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted">
              <span>Rate</span>
              <span className="block text-[9px] font-normal normal-case text-muted/60">
                per 1 ₳
              </span>
            </th>
            <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted">
              <span>Strength vs. Base</span>
              <span className="block text-[9px] font-normal normal-case text-muted/60">
                Positive = currency stronger
              </span>
            </th>
            <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted hidden sm:table-cell">
              Buy Vol
            </th>
            <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted hidden sm:table-cell">
              Sell Vol
            </th>
            <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted">
              {/* Trade button column */}
            </th>
          </tr>
        </thead>
        <tbody>
          {rates.map((rate, rowIdx) => (
            <RateRow
              key={rate.currencyCode}
              rate={rate}
              countryCode={countryCode}
              rowIdx={rowIdx}
              onOpenTradeForCurrency={onOpenTradeForCurrency}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ExchangeRatesTable({
  rates,
  otherRates = [],
  onOpenTradeForCurrency,
  countryCode = "us",
}: Props) {
  if (rates.length === 0 && otherRates.length === 0) {
    return (
      <div className="rounded-xl border border-card-border bg-card p-6 text-center text-muted">
        No exchange rate data available
      </div>
    );
  }

  const primary = rates.length > 0 ? rates : otherRates;
  const accordionRates = rates.length > 0 ? otherRates : [];

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-card-border bg-card shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-card-border">
          <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">Currencies</h2>
          <p className="text-xs text-muted mt-0.5">
            {accordionRates.length > 0 ? "Player-enabled nations. " : null}
            Each rate is how many units of that currency you get for 1 ₳.{" "}
            <span className="font-medium text-foreground/70">
              The lower the rate, the stronger the currency.
            </span>{" "}
            If USD is 0.85, one ₳ buys only $0.85, so the dollar is strong.
          </p>
        </div>

        <RatesTableBody
          rates={primary}
          countryCode={countryCode}
          onOpenTradeForCurrency={onOpenTradeForCurrency}
        />
      </div>

      {accordionRates.length > 0 && (
        <details className="group rounded-xl border border-card-border bg-card shadow-sm overflow-hidden">
          <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden px-5 py-4 flex items-center justify-between gap-3 border-b border-transparent group-open:border-card-border hover:bg-card-elevated/40 transition-colors">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span
                  className="select-none text-muted transition-transform duration-200 group-open:rotate-90"
                  aria-hidden
                >
                  ▸
                </span>
                <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">
                  Other currencies
                </h2>
                <span className="rounded-full bg-card-elevated px-2 py-0.5 text-[10px] font-semibold text-muted tabular-nums">
                  {accordionRates.length}
                </span>
              </div>
              <p className="text-xs text-muted mt-1 pl-5">
                Econ-only and other market nations — westernized first, then planned economies.
              </p>
            </div>
            <span className="text-xs text-muted shrink-0 group-open:hidden">Show</span>
            <span className="text-xs text-muted shrink-0 hidden group-open:inline">Hide</span>
          </summary>
          <RatesTableBody
            rates={accordionRates}
            countryCode={countryCode}
            onOpenTradeForCurrency={onOpenTradeForCurrency}
          />
        </details>
      )}
    </div>
  );
}
