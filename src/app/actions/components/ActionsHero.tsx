"use client";

import type { Character } from "@/lib/db/types";
import { useCurrency } from "@/contexts/CurrencyContext";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { formatCurrencyFaceAmount } from "@/lib/currency/formatCurrencyFaceAmount";
import { HeroImage } from "@/components/HeroImage";
import { HeroStatsStrip } from "@/components/ui";
import { calculateFavorabilityAboveThresholdPenalty } from "@shared/constants/formulas";
import Link from "next/link";
import { useState } from "react";

interface ActionsHeroProps {
  character: Character;
  /** Hero art already resolved for the live era + the player's country. */
  imageUrl: string;
  /** Year chip copy, e.g. "1953" — the live in-game year. Omit to hide the chip. */
  eraLabel?: string | null;
  /** Stored campaign war chest in the character's home/local currency. */
  campaignFundsDisplay: number;
  campaignFundsCurrency: CurrencyCode;
  influence: number;
  infamy: number;
  influenceDecay: string;
  portfolioData: {
    totalValue: number;
    totalBondValue: number;
    totalBondIncomePerTurn: number;
    cashOnHand: number;
  } | null;
}

export default function ActionsHero({
  character,
  imageUrl,
  eraLabel,
  campaignFundsDisplay,
  campaignFundsCurrency,
  influence,
  infamy,
  influenceDecay,
  portfolioData,
}: ActionsHeroProps) {
  const { formatAmount } = useCurrency();
  const [fundsExpanded, setFundsExpanded] = useState(false);
  const favorability = character.favorability ?? 50;
  const favAboveThresholdPenalty = calculateFavorabilityAboveThresholdPenalty(favorability);
  const favDecayDisplay = favAboveThresholdPenalty > 0 ? favAboveThresholdPenalty.toFixed(1) : null;
  const favColor =
    favorability >= 60 ? "var(--success)" : favorability >= 40 ? "var(--warning)" : "var(--error)";

  return (
    <header className="relative overflow-hidden rounded-2xl border border-card-border bg-card shadow-lg">
      <div className="relative h-[175px] w-full sm:h-[220px]">
        <HeroImage
          src={imageUrl}
          alt="Political campaign"
          fill
          className="object-cover object-[center_55%]"
          sizes="(max-width: 1280px) 100vw, 1280px"
          priority
        />
        <div
          className="absolute inset-0 bg-gradient-to-t from-black/92 via-black/45 to-black/10"
          aria-hidden
        />
        <div
          className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent"
          aria-hidden
        />
        <div className="absolute inset-0 flex flex-col justify-end px-6 pb-6 sm:px-8 sm:pb-8">
          {eraLabel && (
            <span className="mb-2 inline-flex w-fit items-center rounded-full border border-white/25 bg-black/40 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-white/90 backdrop-blur-md">
              {eraLabel}
            </span>
          )}
          <h1 className="text-2xl font-bold tracking-tight text-white drop-shadow-md sm:text-3xl">
            Campaign Operations
          </h1>
          <p className="mt-2 text-sm text-white/90 drop-shadow sm:text-base max-w-2xl">
            Direct your political operation. Manage resources, expand your influence, and shape
            public opinion.
          </p>
        </div>
      </div>

      {/* Stats Bar */}
      <HeroStatsStrip variant="overlay">
        <div className="p-4 flex flex-col shrink-0 min-w-[80px] sm:min-w-[100px]">
          <span className="text-[10px] uppercase tracking-widest text-muted font-bold">
            Actions
          </span>
          <span className="text-lg font-bold text-foreground tabular-nums">
            {character.actions}
            <span className="text-xs font-normal text-muted ml-1">remaining</span>
          </span>
        </div>

        <div className="p-4 flex flex-col shrink-0 min-w-[90px] sm:min-w-[120px]">
          <button
            type="button"
            className="flex items-center gap-1 cursor-pointer rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            onClick={() => setFundsExpanded(!fundsExpanded)}
            aria-expanded={fundsExpanded}
            aria-label={fundsExpanded ? "Hide funds breakdown" : "Show funds breakdown"}
          >
            <span className="text-[10px] uppercase tracking-widest text-muted font-bold">
              Funds
            </span>
            <svg
              className={`w-3 h-3 text-muted transition-transform ${fundsExpanded ? "rotate-180" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </button>
          <span className="text-lg font-bold text-success tabular-nums">
            {formatCurrencyFaceAmount(campaignFundsDisplay, campaignFundsCurrency)}
          </span>
          {fundsExpanded && portfolioData && (
            <div className="mt-2 space-y-1 text-xs">
              <div className="flex justify-between gap-2">
                <span className="text-muted">Cash on hand:</span>
                <span className="text-foreground tabular-nums">
                  {formatAmount(portfolioData.cashOnHand)}
                </span>
              </div>
              {portfolioData.totalBondValue > 0 && (
                <div className="flex justify-between gap-2">
                  <span className="text-muted">Bond income:</span>
                  <span className="text-success tabular-nums">
                    +{formatAmount(portfolioData.totalBondIncomePerTurn)}/turn
                  </span>
                </div>
              )}
              <div className="flex justify-between gap-2">
                <span className="text-muted">Portfolio:</span>
                <span className="text-primary tabular-nums">
                  {formatAmount(portfolioData.totalValue + portfolioData.totalBondValue)}
                </span>
              </div>
              <Link href="/portfolio" className="block text-primary hover:underline mt-1">
                View Portfolio →
              </Link>
            </div>
          )}
        </div>

        <div className="p-4 flex flex-col shrink-0 min-w-[90px]">
          <span className="text-[10px] uppercase tracking-widest text-muted font-bold">Infamy</span>
          <span
            className={`text-lg font-bold tabular-nums ${infamy > 20 ? "text-error" : "text-foreground"}`}
          >
            {infamy.toFixed(1)}%
          </span>
        </div>

        <div className="p-4 flex flex-col shrink-0 min-w-[80px] sm:min-w-[100px]">
          <span className="text-[10px] uppercase tracking-widest text-muted font-bold">
            Donor Base
          </span>
          <span className="text-lg font-bold text-foreground tabular-nums">
            Lv. {character.donorBaseLevel ?? 0}
          </span>
        </div>

        <div className="p-4 flex flex-col flex-1 min-w-full sm:min-w-[200px] gap-3">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] uppercase tracking-widest text-muted font-bold">
                Influence
              </span>
              <span className="text-xs text-muted tabular-nums">{influence.toFixed(1)}%</span>
            </div>
            <div className="h-2 w-full rounded-full bg-background overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-all duration-500"
                style={{ width: `${Math.min(100, Math.max(0, influence))}%` }}
              />
            </div>
            <div className="mt-1 text-[10px] text-muted text-right">
              Decay: -{influenceDecay}%/turn
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] uppercase tracking-widest text-muted font-bold">
                Favorability
              </span>
              <span className="text-xs tabular-nums" style={{ color: favColor }}>
                {favorability.toFixed(1)}%
              </span>
            </div>
            <div className="h-2 w-full rounded-full bg-background overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${Math.min(100, Math.max(0, favorability))}%`,
                  backgroundColor: favColor,
                }}
              />
            </div>
            {favDecayDisplay && (
              <div className="mt-1 text-[10px] text-muted text-right">
                Decay: -{favDecayDisplay}%/turn
              </div>
            )}
          </div>
        </div>
      </HeroStatsStrip>
    </header>
  );
}
