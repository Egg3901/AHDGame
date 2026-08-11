/**
 * Per-country macro-growth precompute (design §4): anchor-normalized GDP-per-
 * capita, the frontier (live max across countries), and the openness gate — all
 * PURE so it's unit-testable. `phase.ts` gathers the raw rows from the DB
 * (national GDP, population, FX, lagged national metrics) and calls this once
 * per turn before the region loop.
 */
import { econSystemFactor, tradeFactor, freedomFactor, opennessGate } from "./convergence";

export interface CountryMacroRaw {
  countryId: string;
  /** Σ region GDP for the country (LOCAL-currency millions). */
  gdpLocalMillions: number;
  /** Σ region population. */
  population: number;
  /** FX rate, LOCAL per anchor (≤0 or non-finite ⇒ passthrough, treated as 1). */
  fxLocalPerAnchor: number;
  /** Lagged national state-ownership concentration (0–1). */
  soci?: number;
  /** Lagged national tradeGrowth (%). */
  tradeGrowth?: number;
  /** Lagged national economicFreedom (0–100). */
  economicFreedom?: number;
}

export interface CountryMacro {
  /** GDP per capita in anchor ₳ (cross-country comparable). */
  ownPcAnchor: number;
  /** Openness gate (0..1). */
  openness: number;
}

export interface MacroGrowthInputs {
  byCountry: Map<string, CountryMacro>;
  /** Max ownPcAnchor across all countries (the live frontier). 0 if none. */
  frontierPcAnchor: number;
}

export function buildMacroGrowthInputs(rows: CountryMacroRaw[]): MacroGrowthInputs {
  const byCountry = new Map<string, CountryMacro>();
  let frontierPcAnchor = 0;
  for (const r of rows) {
    const pop = Number.isFinite(r.population) && r.population > 0 ? r.population : 0;
    const gdp =
      Number.isFinite(r.gdpLocalMillions) && r.gdpLocalMillions > 0 ? r.gdpLocalMillions : 0;
    if (pop === 0 || gdp === 0) continue; // no pc → skip (never the frontier)
    const fx =
      Number.isFinite(r.fxLocalPerAnchor) && r.fxLocalPerAnchor > 0 ? r.fxLocalPerAnchor : 1;
    const ownPcAnchor = (gdp * 1_000_000) / fx / pop;
    const openness = opennessGate({
      econSystem: econSystemFactor(r.soci),
      trade: tradeFactor(r.tradeGrowth),
      freedom: freedomFactor(r.economicFreedom),
    });
    byCountry.set(r.countryId, { ownPcAnchor, openness });
    if (ownPcAnchor > frontierPcAnchor) frontierPcAnchor = ownPcAnchor;
  }
  return { byCountry, frontierPcAnchor };
}
