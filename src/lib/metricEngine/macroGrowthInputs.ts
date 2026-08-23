/**
 * Per-country macro-growth precompute (design §4): anchor-normalized GDP-per-
 * capita, the frontier (live max across active countries), and the openness gate. All are
 * PURE so it's unit-testable. `phase.ts` gathers the raw rows from the DB
 * (national GDP, population, era denomination, lagged national metrics) and calls this once
 * per turn before the region loop.
 */
import { gdpToAnchor } from "@/lib/currency/gdpAnchorRate";
import type { CountryId } from "@/lib/constants/countries";
import { developmentGate } from "./convergence";

export interface CountryMacroRaw {
  countryId: string;
  /** Σ region GDP for the country (LOCAL-currency millions). */
  gdpLocalMillions: number;
  /** Σ region population. */
  population: number;
  /** Lagged national state-ownership concentration (0-100). */
  soci?: number;
  /** Lagged national tradeGrowth (%). */
  tradeGrowth?: number;
  /** Lagged national economicFreedom (0–100). */
  economicFreedom?: number;
  /** Lagged industrial-plan execution, 0-1. */
  industrialPolicyExecution?: number;
  /** Lagged workforce and transport capacity, each 0-100. */
  workforceSkill?: number;
  transportEfficiency?: number;
  /** Productive public investment as a normalized share of GDP, 0-1. */
  publicInvestmentEffort?: number;
}

export interface CountryMacro {
  /** GDP per capita in anchor ₳ (cross-country comparable). */
  ownPcAnchor: number;
  /** Openness gate (0..1). */
  openness: number;
}

export interface MacroGrowthInputs {
  byCountry: Map<string, CountryMacro>;
  /** Max ownPcAnchor across active countries (the live frontier). 0 if none. */
  frontierPcAnchor: number;
}

export function buildMacroGrowthInputs(
  rows: CountryMacroRaw[],
  preset?: string,
  activeCountryIds?: ReadonlySet<string>
): MacroGrowthInputs {
  const byCountry = new Map<string, CountryMacro>();
  let frontierPcAnchor = 0;
  const restrictToActive = (activeCountryIds?.size ?? 0) > 0;
  for (const r of rows) {
    if (restrictToActive && activeCountryIds && !activeCountryIds.has(r.countryId)) continue;
    const pop = Number.isFinite(r.population) && r.population > 0 ? r.population : 0;
    const gdp =
      Number.isFinite(r.gdpLocalMillions) && r.gdpLocalMillions > 0 ? r.gdpLocalMillions : 0;
    if (pop === 0 || gdp === 0) continue; // no pc → skip (never the frontier)
    const ownPcAnchor = (gdpToAnchor(gdp, r.countryId as CountryId, preset) * 1_000_000) / pop;
    const openness = developmentGate(r);
    byCountry.set(r.countryId, { ownPcAnchor, openness });
    if (ownPcAnchor > frontierPcAnchor) frontierPcAnchor = ownPcAnchor;
  }
  return { byCountry, frontierPcAnchor };
}
