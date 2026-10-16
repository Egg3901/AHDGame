"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { useCurrency } from "@/contexts/CurrencyContext";
import { holdingMarketTotals } from "@/lib/corporations/rules/holdingTerms";
import { StocksTable, type Holding } from "./HoldingsTables";
export function StockHoldingValues({ holdings }: { holdings: Holding[] }) {
  const { formatAmount, toInternalFrom } = useCurrency();
  const t = useTranslations("profile.stockHoldings");
  const values = holdingMarketTotals(
    holdings.map((holding) => ({
      position: { shares: holding.shares, holdingTerms: holding.holdingTerms },
      turn: holding.holdingTurn ?? 0,
      anchorSharePrice: holding.currencyCode
        ? toInternalFrom(holding.sharePrice, holding.currencyCode)
        : holding.sharePrice,
    }))
  );
  const totals = {
    all: values.stockValue,
    short: values.shortTermStockValue,
    long: values.longTermStockValue,
  };
  return (
    <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      {(["all", "short", "long"] as const).map((term) => (
        <div key={term} className="rounded-lg border border-card-border bg-card p-3">
          <dt className="text-xs text-muted">{t(term)}</dt>
          <dd className="font-semibold tabular-nums">{formatAmount(totals[term])}</dd>
        </div>
      ))}
    </dl>
  );
}
export function StockHoldingsView({ holdings }: { holdings: Holding[] }) {
  const [term, setTerm] = useState<"all" | "short" | "long">("all");
  const t = useTranslations("profile.stockHoldings");
  return (
    <div className="space-y-4">
      <StockHoldingValues holdings={holdings} />
      <div role="group" aria-label={t("filter")} className="flex flex-wrap gap-2">
        {(["all", "short", "long"] as const).map((value) => (
          <button
            type="button"
            key={value}
            aria-pressed={value === term}
            onClick={() => setTerm(value)}
            className={`rounded-full border px-3 py-1 text-sm ${value === term ? "border-primary bg-primary/10" : "border-card-border"}`}
          >
            {t(value)}
          </button>
        ))}
      </div>
      <StocksTable holdings={holdings} holdingTerm={term} />
    </div>
  );
}
