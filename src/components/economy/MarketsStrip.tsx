"use client";

import Link from "next/link";
import type { CountryId } from "@/lib/constants/countries";
import { formatCurrencyCompactChip } from "@/lib/utils/formatters";
import { getCurrencyPrefix } from "@/lib/utils/budgetCalculations";
import { forexUrl, stockmarketUrl } from "@/lib/urls";

interface MarketsData {
  chairName: string | null;
  stockMarketCap: number | null;
  exchangeName: string | null;
  forexRate: number | null;
  surplus: number | null;
  deficitToGdp: number | null;
}

interface MarketsStripProps {
  countryId: CountryId | string;
  markets: MarketsData;
}

function Card({
  href,
  label,
  stat,
  sub,
}: {
  href: string;
  label: string;
  stat: string;
  sub: string;
}) {
  return (
    <Link
      href={href}
      className="block rounded-xl border border-card-border bg-card px-4 py-3.5 transition-colors hover:border-foreground/30"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted">
          {label}
        </span>
        <span className="text-[11px] text-primary">&rarr;</span>
      </div>
      <div className="mt-1.5 font-mono text-[17px] font-bold tabular-nums text-foreground">
        {stat}
      </div>
      <div className="mt-0.5 text-[10.5px] text-muted">{sub}</div>
    </Link>
  );
}

/**
 * Markets handoff cards — Stock Market and Forex. The Central Bank (prime
 * rate) and National Budget (credit · debt-to-GDP) live in the pulse strip
 * already, so they are not duplicated here. The Forex card's ₳ rate is the
 * page's single deliberate anchor-unit appearance, matching the Forex page's
 * own convention.
 */
export function MarketsStrip({ countryId, markets }: MarketsStripProps) {
  const prefix = getCurrencyPrefix(countryId as CountryId);

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Card
          href={stockmarketUrl(countryId)}
          label="Stock Market"
          stat={
            markets.stockMarketCap != null
              ? formatCurrencyCompactChip(markets.stockMarketCap, prefix)
              : "—"
          }
          sub={`total market cap${markets.exchangeName ? ` · ${markets.exchangeName}` : ""}`}
        />
        <Card
          href={forexUrl(countryId)}
          label="Forex"
          stat={markets.forexRate != null ? `₳1 = ${prefix}${markets.forexRate.toFixed(2)}` : "—"}
          sub="exchange rate · anchor convention"
        />
      </div>
      <Link
        href="/world/trade"
        className="flex items-center justify-between rounded-xl border border-card-border bg-card px-4 py-3 transition-colors hover:border-foreground/30"
      >
        <span className="text-[12.5px] font-semibold text-foreground">
          World Trade Ledger
          <span className="ml-2 font-normal text-muted">balance of trade between nations</span>
        </span>
        <span className="text-[11px] text-primary">&rarr;</span>
      </Link>
    </div>
  );
}

export default MarketsStrip;
