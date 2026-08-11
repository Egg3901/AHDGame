"use client";

import Image from "next/image";
import Link from "next/link";
import { STATE_FLAGS } from "@/lib/constants";
import { bypassNextImageOptimization } from "@/lib/images/bypassImageOptimization";
import { CorporationLogo } from "@/components/corporation/CorporationLogo";
import { CORPORATION_TYPE_LABELS } from "@/lib/constants/corporations";
import { useCurrency } from "@/contexts/CurrencyContext";
import { getTypeColor } from "../lib/helpers";
import type {
  SectorData,
  CorporationRef,
  CeoRef,
  Financials,
  Margins,
  Market,
  FinancialVisibility,
} from "../types";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { financialVisibilityCopy } from "../lib/financialVisibility";
import { InfoTooltip } from "@/components/InfoTooltip";
import { Building2, MapPin, UserRound, EyeOff } from "lucide-react";

interface HeroCardProps {
  sector: SectorData;
  corporation: CorporationRef;
  ceo: CeoRef | null;
  financials: Financials | null;
  margins: Margins | null;
  financialVisibility?: FinancialVisibility;
  market: Market;
  corpHref: string;
  stateHref: string;
}

export default function HeroCard({
  sector,
  corporation,
  ceo,
  financials,
  margins,
  financialVisibility,
  market,
  corpHref,
  stateHref,
}: HeroCardProps) {
  // When a money stat is absent because it was withheld (not because it is
  // genuinely zero), render a labelled "Hidden" marker with the reason instead
  // of a bare dash that reads as a real $0. hidden === false (owner/admin) and
  // pre-label responses both fall through to the ordinary dash placeholder the
  // rest of the app uses for absent stats.
  const hiddenCopy =
    financialVisibility?.hidden === true
      ? financialVisibilityCopy(financialVisibility.reason)
      : null;
  const hiddenMarker = hiddenCopy ? (
    <InfoTooltip
      width={260}
      trigger={
        <span className="inline-flex cursor-help items-center gap-1 border-b border-dotted border-muted/40 text-body-xs font-semibold text-muted">
          <EyeOff className="h-3 w-3" aria-hidden />
          {hiddenCopy.short}
        </span>
      }
    >
      <p className="mb-1 font-semibold text-foreground">{hiddenCopy.title}</p>
      <p className="text-muted">{hiddenCopy.body}</p>
    </InfoTooltip>
  ) : (
    "—"
  );
  const { formatAmount, toInternalFrom } = useCurrency();
  const liquidCode = (corporation.liquidCurrencyCode as CurrencyCode | undefined) ?? undefined;
  const fmtMoney = (value: number) =>
    formatAmount(liquidCode ? toInternalFrom(value, liquidCode) : value, liquidCode);
  // ₳-anchored amounts (e.g. for-sale price) skip the local→anchor pre-conversion.
  // Pass undefined as nativeCurrencyCode so the user's wallet preference governs.
  const fmtAnchor = (value: number) => formatAmount(value);
  return (
    <div className="mb-6 overflow-hidden rounded-2xl border border-card-border bg-card shadow-card">
      {/* Flag + title + metadata */}
      <div className="flex items-center gap-3 px-5 py-4">
        {STATE_FLAGS[sector.stateId] && (
          <Image
            src={STATE_FLAGS[sector.stateId]}
            alt={sector.stateId}
            width={44}
            height={30}
            className="shrink-0 rounded-md object-cover"
            unoptimized={bypassNextImageOptimization(STATE_FLAGS[sector.stateId])}
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight text-foreground">
              {sector.displayName ?? sector.sectorLabel}
            </h1>
            {sector.displayName && (
              <span
                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${getTypeColor(sector.sectorType)}`}
              >
                {CORPORATION_TYPE_LABELS[sector.sectorType]}
              </span>
            )}
            {sector.forSale && (
              <span
                className="inline-flex items-center rounded-full border border-success/40 bg-success/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-success"
                title={`Asking price: ${fmtAnchor(sector.forSale.priceAnchor)}`}
              >
                For Sale · {fmtAnchor(sector.forSale.priceAnchor)}
              </span>
            )}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <Link
              href={stateHref}
              className="inline-flex items-center gap-1.5 rounded-full border border-card-border bg-card-elevated px-2.5 py-1 text-muted transition-colors hover:border-primary/40 hover:text-foreground"
            >
              <MapPin className="h-3 w-3 text-primary" />
              {sector.stateName}
            </Link>
            <Link
              href={corpHref}
              className="inline-flex items-center gap-1.5 rounded-full border border-card-border bg-card-elevated px-2.5 py-1 text-muted transition-colors hover:border-primary/40 hover:text-foreground"
            >
              <Building2 className="h-3 w-3 text-primary" />
              {corporation.name}
            </Link>
            {ceo && (
              <Link
                href={`/character/${ceo.sequentialId}`}
                className="inline-flex items-center gap-1.5 rounded-full border border-card-border bg-card-elevated px-2.5 py-1 text-muted transition-colors hover:border-primary/40 hover:text-foreground"
              >
                <UserRound className="h-3 w-3 text-primary" />
                {ceo.name}
              </Link>
            )}
          </div>
        </div>
        <CorporationLogo
          logoUrl={corporation.logoUrl}
          name={corporation.name}
          size="h-12 w-12"
          className="rounded-lg border border-card-border bg-card-elevated"
        />
      </div>

      {/* Stats strip, scrollable on mobile */}
      <div className="flex divide-x divide-card-border overflow-x-auto border-t border-card-border">
        <div className="min-w-[90px] shrink-0 px-4 py-3">
          <span className="block text-[10px] font-medium uppercase tracking-widest text-muted">
            Actual Revenue
          </span>
          <span className="text-sm font-bold tabular-nums text-success">
            {financials ? (
              <>
                {fmtMoney(financials.realizedRevenue ?? financials.revenue)}
                <span className="text-[10px] font-normal text-muted">/day</span>
              </>
            ) : (
              hiddenMarker
            )}
          </span>
        </div>
        <div className="min-w-[90px] shrink-0 px-4 py-3">
          <span className="block text-[10px] font-medium uppercase tracking-widest text-muted">
            Net Profit
          </span>
          <span
            className={`text-sm font-bold tabular-nums ${financials ? (financials.profit >= 0 ? "text-success" : "text-error") : ""}`}
          >
            {financials ? (
              <>
                {fmtMoney(financials.profit)}
                <span className="text-[10px] font-normal text-muted">/day</span>
              </>
            ) : (
              hiddenMarker
            )}
          </span>
        </div>
        <div className="min-w-[90px] shrink-0 px-4 py-3">
          <span className="block text-[10px] font-medium uppercase tracking-widest text-muted">
            Eff. Margin
          </span>
          <span className="text-sm font-bold tabular-nums text-foreground">
            {/* Rounded for display: the margin is a computed float, and the raw
                value renders as "37.40833333333334%" in this narrow stat cell. */}
            {margins ? `${margins.effective.toFixed(1)}%` : hiddenMarker}
          </span>
        </div>
        <div className="min-w-[90px] shrink-0 px-4 py-3">
          <span className="block text-[10px] font-medium uppercase tracking-widest text-muted">
            Market Share
          </span>
          <span className="text-sm font-bold tabular-nums text-primary">{market.marketShare}%</span>
        </div>
        <div className="min-w-[90px] shrink-0 px-4 py-3">
          <span className="block text-[10px] font-medium uppercase tracking-widest text-muted">
            Workers
          </span>
          <span className="text-sm font-bold tabular-nums text-foreground">
            {sector.workers != null ? sector.workers.toLocaleString("en-US") : hiddenMarker}
          </span>
        </div>
      </div>
    </div>
  );
}
