"use client";

import Link from "next/link";
import { useCurrency } from "@/contexts/CurrencyContext";
import { CorporationLogo } from "@/components/corporation/CorporationLogo";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { BondDetail } from "./bondTypes";

export function BondHeroPanel({
  bond,
  yieldToMaturity,
  corpHref,
  onTrade,
}: {
  bond: BondDetail;
  yieldToMaturity: number;
  corpHref: string | null;
  onTrade?: () => void;
}) {
  const { formatPrice, toInternalFrom } = useCurrency();
  // `bond.faceValue` + `bond.pricePerUnit` denominate in `bond.currencyCode`
  // (Task-18B). Normalize LOCAL → ₳ before formatPrice (which expects ₳ and
  // applies wallet-pref display). Same pattern as the Bond Details section
  // above; extracted here so the stats strip doesn't render raw LOCAL values
  // with the player's wallet-currency symbol on foreign-denominated bonds.
  const bondCode = (bond.currencyCode ??
    (bond.countryId
      ? COUNTRY_CURRENCY_MAP[bond.countryId as keyof typeof COUNTRY_CURRENCY_MAP]
      : undefined)) as CurrencyCode | undefined;
  const fmtBondPrice = (val: number) => {
    const anchor = bondCode ? toInternalFrom(val, bondCode) : val;
    return formatPrice(anchor, bondCode);
  };
  return (
    <div className="rounded-2xl border border-card-border bg-card overflow-hidden shadow-card">
      {/* Top row */}
      <div className="px-6 py-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-card-border">
        <div className="flex items-center gap-4">
          <div className="relative h-14 w-14 rounded-xl bg-card-elevated border border-card-border overflow-hidden shrink-0">
            <CorporationLogo
              logoUrl={bond.corporationLogoUrl}
              name={bond.corporationName}
              fill
              className="rounded-xl"
            />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-bold text-foreground">
                {corpHref ? (
                  <Link href={corpHref} className="hover:text-primary transition-colors">
                    {bond.corporationName}
                  </Link>
                ) : (
                  bond.corporationName
                )}{" "}
                Bond
              </h1>
              <span className="px-2 py-0.5 rounded-md bg-card-elevated border border-card-border text-xs font-bold uppercase tracking-wide text-muted">
                Series {bond.maturityLabel}
              </span>
              {bond.issuerType === "sovereign" && (
                <span className="px-2 py-0.5 rounded-md bg-secondary/10 border border-secondary/20 text-secondary text-xs font-bold uppercase tracking-wide">
                  Sovereign
                </span>
              )}
              {bond.defaulted && (
                <span className="px-2 py-0.5 rounded-md bg-error/10 border border-error/20 text-error text-xs font-bold uppercase tracking-wide">
                  Defaulted
                </span>
              )}
              {bond.matured &&
                !bond.defaulted &&
                (bond.defaultCure && bond.defaultedAtTurn != null ? (
                  <span
                    className="px-2 py-0.5 rounded-md bg-warning/10 border border-warning/20 text-warning text-xs font-bold uppercase tracking-wide"
                    title={`Defaulted on turn ${bond.defaultedAtTurn}, cured on turn ${bond.defaultCure.curedAtTurn} via ${bond.defaultCure.cureMethod.replace("_", " ")}`}
                  >
                    Default cured
                  </span>
                ) : bond.defaultCure?.cureMethod === "parent_payoff" ? (
                  <span
                    className="px-2 py-0.5 rounded-md bg-secondary/10 border border-secondary/20 text-secondary text-xs font-bold uppercase tracking-wide"
                    title={`Settled by parent corporation on turn ${bond.defaultCure.curedAtTurn}`}
                  >
                    Parent paid off
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded-md bg-muted/10 border border-muted/20 text-muted text-xs font-bold uppercase tracking-wide">
                    Matured
                  </span>
                ))}
            </div>
            <p className="text-sm text-muted mt-0.5">
              {bond.couponRate.toFixed(2)}% coupon
              <span className="mx-1.5 text-card-border">·</span>
              {bond.matured ? "Matured" : `${bond.turnsRemaining} turns remaining`}
              <span className="mx-1.5 text-card-border">·</span>
              {bond.publicFloat.toLocaleString("en-US")} units anyone can buy
              {bond.marketDepthUnits != null && (
                <>
                  <span className="mx-1.5 text-card-border">·</span>
                  market will buy up to {bond.marketDepthUnits.toLocaleString("en-US")} units
                </>
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4 shrink-0">
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-wider text-muted font-medium">
              Yield to Maturity
            </p>
            <p className="text-2xl font-mono font-bold tabular-nums text-success">
              {yieldToMaturity.toFixed(2)}%
            </p>
          </div>
          {onTrade && (
            <button
              onClick={onTrade}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90 transition-colors"
            >
              Trade
            </button>
          )}
        </div>
      </div>

      {/* Stats strip */}
      <div className="flex items-center overflow-x-auto divide-x divide-card-border">
        {(
          [
            { label: "Face Value", value: fmtBondPrice(bond.faceValue) },
            { label: "Coupon Rate", value: `${bond.couponRate.toFixed(2)}%` },
            { label: "Market Price", value: fmtBondPrice(bond.pricePerUnit) },
            ...(bond.bidPricePerUnit != null && bond.askPricePerUnit != null
              ? [
                  {
                    label: "Bid / Ask",
                    value: `${fmtBondPrice(bond.bidPricePerUnit)} / ${fmtBondPrice(bond.askPricePerUnit)}`,
                    hint: "What the market pays you for a unit, and what it charges. The gap is the dealer's spread; both move down when the market is short of cash or wary of the issuer.",
                  },
                ]
              : []),
            { label: "Maturity", value: bond.matured ? "Matured" : `${bond.turnsRemaining} turns` },
            { label: "Total Units", value: bond.totalUnits.toLocaleString("en-US") },
            {
              label: "Public Float",
              value: `${bond.publicFloatPercentage.toFixed(1)}%`,
              hint: "Units not held by the issuer. Anyone can buy them.",
            },
          ] as { label: string; value: string; hint?: string }[]
        ).map(({ label, value, hint }) => (
          <div key={label} className="flex flex-col px-5 py-3 min-w-max">
            <span
              className="text-[10px] uppercase tracking-widest text-muted font-medium"
              title={hint}
            >
              {label}
            </span>
            <span className="text-base font-bold tabular-nums text-foreground">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
