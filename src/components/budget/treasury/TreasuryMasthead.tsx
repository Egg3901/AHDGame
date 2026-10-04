"use client";

import type { ReactNode } from "react";
import type { CountryId } from "@/lib/constants/countries";
import type { TreasuryIdentity } from "@/lib/constants/treasuryIdentity";
import { NationalSeal } from "@/components/national/NationalSeal";
import { hexToRgba } from "@/components/national/identityColor";

export type BudgetLens = "public" | "minister";

interface TreasuryMastheadProps {
  countryId: CountryId;
  identity: TreasuryIdentity;
  /** Executive label (e.g. "State Council", "HM Government") for the badge row. */
  executiveLabel: string;
  fiscalYear: number;
  /** FY scrubber bounds. */
  fyMin: number;
  fyMax: number;
  setFy: (fy: number) => void;
  /** True when viewing the live (current) fiscal year. */
  isLive: boolean;
  /** Turns until the next fiscal-year rollover (live only). */
  turnsUntilFY: number;
  lens: BudgetLens;
  setLens: (lens: BudgetLens) => void;
  /** Only the seated finance minister may switch to the minister lens. */
  isFinanceMinister: boolean;
  compare: boolean;
  setCompare: (compare: boolean) => void;
  /** Enables the compare toggle (a prior FY exists to compare against). */
  hasPrevFy: boolean;
  /** The fiscal stat strip rendered beneath the accent rule. */
  statStrip: ReactNode;
}

/**
 * Treasury masthead for the National Budget surface, the finance-ministry
 * counterpart to the corp `NationalMasthead`. Reuses the shared `NationalSeal`
 * (finance chop via glyph override), with a control bar (lens toggle, FY
 * scrubber, vs-FY compare) and the fiscal stat strip. The banner gradient and
 * accent are the country's fixed brand colors; everything else inherits
 * `ahd-design-system` tokens.
 */
export function TreasuryMasthead({
  countryId,
  identity: id,
  executiveLabel,
  fiscalYear,
  fyMin,
  fyMax,
  setFy,
  isLive,
  turnsUntilFY,
  lens,
  setLens,
  isFinanceMinister,
  compare,
  setCompare,
  hasPrevFy,
  statStrip,
}: TreasuryMastheadProps) {
  const bannerBg = `linear-gradient(135deg, ${id.palette[0]} 0%, ${id.palette[1]} 46%, ${id.palette[2]} 100%)`;

  return (
    <header className="overflow-hidden rounded-2xl border border-card-border bg-card shadow-lg">
      {/* Banner */}
      <div
        className="relative overflow-hidden px-5 pt-5 pb-4 sm:px-7 sm:pt-6"
        style={{ background: bannerBg }}
      >
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center">
          <NationalSeal country={countryId} size={76} glyph={id.glyph} serif={id.serif} />

          <div className="min-w-0 flex-1">
            <div
              className="text-body-sm font-medium"
              style={{ color: hexToRgba(id.accentSoft, 0.8) }}
            >
              {id.registry}
            </div>
            <h1
              data-coach="nav-budget"
              className="mt-1 text-2xl font-bold leading-[1.1] tracking-tight text-white sm:text-3xl"
            >
              {id.budgetTitle}
              {id.budgetTitleEn && (
                <span className="ml-2 align-middle text-lg font-semibold text-white/55 sm:text-xl">
                  ({id.budgetTitleEn})
                </span>
              )}
            </h1>
            <div
              className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm"
              style={{ color: hexToRgba(id.accentSoft, 0.92) }}
            >
              <span>
                {id.native}
                {id.nativeEn && <span className="text-white/45"> ({id.nativeEn})</span>}
              </span>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span
                className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold text-white"
                style={{
                  borderColor: hexToRgba(id.accent, 0.45),
                  background: hexToRgba(id.accent, 0.16),
                }}
              >
                Fiscal Year {fiscalYear}
              </span>
              <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-white/15 bg-black px-2.5 py-0.5 text-xs font-medium text-white/80">
                {executiveLabel}
              </span>
              {isLive ? (
                <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-white/15 bg-black px-2.5 py-0.5 text-xs font-medium text-white/80">
                  <span className="h-2 w-2 shrink-0 rounded-full bg-success" aria-hidden />
                  Live · next FY in {turnsUntilFY}t
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-warning/40 bg-warning/10 px-2.5 py-0.5 text-xs font-medium text-warning">
                  Historical snapshot
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Control bar */}
        <div className="relative mt-4 flex flex-wrap items-center gap-x-4 gap-y-2.5 border-t border-white/10 pt-3.5">
          {/* Lens toggle */}
          <div className="flex items-center gap-1.5">
            <span className="text-body-sm font-medium text-white/45">Lens</span>
            <div className="inline-flex rounded-lg border border-white/15 bg-black/30 p-0.5">
              <button
                type="button"
                onClick={() => setLens("public")}
                className={`rounded-md px-2.5 py-1 text-xs font-semibold ${
                  lens === "public" ? "bg-white/15 text-white" : "text-white/55 hover:text-white"
                }`}
              >
                Public
              </button>
              <button
                type="button"
                onClick={() => isFinanceMinister && setLens("minister")}
                disabled={!isFinanceMinister}
                title={
                  isFinanceMinister
                    ? undefined
                    : "Only the seated finance minister can open the minister lens"
                }
                className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold ${
                  lens === "minister"
                    ? "bg-gold/25 text-gold"
                    : isFinanceMinister
                      ? "text-white/55 hover:text-white"
                      : "cursor-not-allowed text-white/25"
                }`}
              >
                <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
                  <path d="M10 2l2.4 4.9 5.4.8-3.9 3.8.9 5.4L10 14.3 5.2 16.7l.9-5.4L2.2 7.7l5.4-.8z" />
                </svg>
                Finance Minister
              </button>
            </div>
          </div>

          {/* FY scrubber */}
          <div className="flex items-center gap-2">
            <span className="text-body-sm font-medium text-white/45">FY</span>
            <input
              type="range"
              min={fyMin}
              max={fyMax}
              value={fiscalYear}
              onChange={(e) => setFy(Number(e.target.value))}
              className="h-1.5 w-28 cursor-pointer accent-gold"
              aria-label="Fiscal year"
            />
            <span className="font-mono text-xs font-semibold tabular-nums text-white">
              {fiscalYear}
            </span>
          </div>

          {/* Compare toggle */}
          <button
            type="button"
            onClick={() => setCompare(!compare)}
            disabled={!hasPrevFy}
            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold ${
              compare
                ? "border-gold/50 bg-gold/15 text-gold"
                : "border-white/15 bg-black/30 text-white/60 hover:text-white"
            } ${!hasPrevFy ? "cursor-not-allowed opacity-40" : ""}`}
          >
            <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
              <path d="M3 5h10l-3-3 1.4-1.4L17 6l-5.6 5.4L10 10l3-3H3zM17 15H7l3 3-1.4 1.4L3 14l5.6-5.4L10 10l-3 3h10z" />
            </svg>
            vs FY{fiscalYear - 1}
          </button>
        </div>
      </div>

      <div aria-hidden className="h-px bg-card-border" />
      {statStrip}
    </header>
  );
}
