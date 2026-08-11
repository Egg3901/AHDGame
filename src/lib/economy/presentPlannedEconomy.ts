/**
 * Presentation helpers for command / dual-track economy readouts.
 * Pure — safe for client and server.
 */

import {
  COMMAND_CEILING,
  DUAL_TRACK_CEILING,
  isPlannedEconomy,
  marketizationLevel,
} from "@/lib/constants/commandEconomy";

export type PlannedEconomyRegime = "command" | "dual-track";

export interface PlannedEconomyFactors {
  monetaryOverhang?: number | null;
  shortageIndex?: number | null;
  blackMarketPremium?: number | null;
  secondEconomyShare?: number | null;
  /** The persisted, endogenous marketization level. The stored-level registry in
   *  `@/lib/constants/commandEconomy` is PROCESS-LOCAL — only the turn engine
   *  hydrates it — so read paths in other processes (API routes, SSR) must supply
   *  the persisted `economicFactors.marketizationLevel` here to render the dial
   *  consistently. Absent → the accessor falls back to the era schedule. */
  marketizationLevel?: number | null;
}

/**
 * Resolve the marketization level for a READ path (API/SSR/UI), preferring the
 * persisted `economicFactors.marketizationLevel` over the process-local registry
 * (which only the single turn-engine process hydrates). This is the P0→P1 seam
 * fix: callers outside the turn engine pass the persisted factors so cross-process
 * reads match what the engine drifted to, rather than the era-schedule fallback.
 */
export function resolveMarketizationLevel(
  countryId: string | null | undefined,
  currentYear: number | null | undefined,
  factors: PlannedEconomyFactors | null | undefined
): number {
  const persisted = factors?.marketizationLevel;
  if (typeof persisted === "number" && Number.isFinite(persisted)) return persisted;
  return marketizationLevel(countryId, currentYear);
}

export interface PlannedEconomyView {
  regime: PlannedEconomyRegime;
  regimeLabel: string;
  regimeExplainer: string;
  marketizationLevel: number;
  monetaryOverhang: number | null;
  shortageIndex: number | null;
  blackMarketPremium: number | null;
  secondEconomyShare: number | null;
}

function hasDefinedFactor(factors: PlannedEconomyFactors | null | undefined): boolean {
  if (!factors) return false;
  return (
    typeof factors.monetaryOverhang === "number" ||
    typeof factors.shortageIndex === "number" ||
    typeof factors.blackMarketPremium === "number" ||
    typeof factors.secondEconomyShare === "number"
  );
}

/** True when the panel should render (fields present, or planned regime + flag). */
export function shouldShowPlannedEconomy(
  countryId: string | null | undefined,
  currentYear: number | null | undefined,
  enabled: boolean | null | undefined,
  factors: PlannedEconomyFactors | null | undefined
): boolean {
  if (hasDefinedFactor(factors)) return true;
  return isPlannedEconomy(countryId, currentYear, enabled);
}

function regimeFromLevel(level: number): PlannedEconomyRegime | null {
  if (level < COMMAND_CEILING) return "command";
  if (level < DUAL_TRACK_CEILING) return "dual-track";
  return null;
}

const REGIME_COPY: Record<PlannedEconomyRegime, { label: string; explainer: string }> = {
  command: {
    label: "Command economy",
    explainer:
      "Prices and output are administered by the plan. Money does not clear markets the way it does in a market economy.",
  },
  "dual-track": {
    label: "Dual-track",
    explainer:
      "A planned sector and a market sector run in parallel. Official prices coexist with market-clearing ones.",
  },
};

/**
 * Build the view model, or null when the panel should stay hidden.
 * Regime badge prefers the marketization dial; falls back to "command" when
 * factors exist but the dial already reads market (stale post-transition rows).
 */
export function presentPlannedEconomy(
  countryId: string | null | undefined,
  currentYear: number | null | undefined,
  enabled: boolean | null | undefined,
  factors: PlannedEconomyFactors | null | undefined
): PlannedEconomyView | null {
  if (!shouldShowPlannedEconomy(countryId, currentYear, enabled, factors)) return null;

  // Prefer the persisted level so read paths in non-turn processes (where the
  // stored-level registry is empty) don't fall back to the era schedule.
  const level = resolveMarketizationLevel(countryId, currentYear, factors);
  const regime = regimeFromLevel(level) ?? "command";
  const copy = REGIME_COPY[regime];

  return {
    regime,
    regimeLabel: copy.label,
    regimeExplainer: copy.explainer,
    marketizationLevel: level,
    monetaryOverhang:
      typeof factors?.monetaryOverhang === "number" ? factors.monetaryOverhang : null,
    shortageIndex: typeof factors?.shortageIndex === "number" ? factors.shortageIndex : null,
    blackMarketPremium:
      typeof factors?.blackMarketPremium === "number" ? factors.blackMarketPremium : null,
    secondEconomyShare:
      typeof factors?.secondEconomyShare === "number" ? factors.secondEconomyShare : null,
  };
}

export const PLANNED_ECONOMY_METRIC_TOOLTIPS = {
  monetaryOverhang:
    "Forced savings: money households hold that cannot find goods at administered prices. 0 = cleared, 100 = acute overhang.",
  shortageIndex: "How scarce goods are at official prices. 0 = abundant, 100 = acute shortage.",
  blackMarketPremium:
    "How much more the shadow / second-economy price is above the official price.",
  secondEconomyShare: "Share of activity that has moved into the informal or black-market sector.",
} as const;
