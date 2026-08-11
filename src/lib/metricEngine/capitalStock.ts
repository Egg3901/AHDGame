/**
 * Per-region Solow capital stock K (millions — the SAME unit as `state.gdp`,
 * audit-cap-2; never mix with `stateBudget.stateGdp` full units). Substrate for
 * the P1c-1 potential-growth term (`αK · ΔK/K`). Self-damping by construction:
 * depreciation pulls `K/Y` back toward the steady-state target, so the
 * GDP→investment→capital→GDP loop converges instead of running away (§6.1).
 * No consumer in P1c-0 — this module only maintains the stock and exposes the
 * annualized `ΔK/K` that potential growth will read.
 */

/** Steady-state capital/output ratio (seed multiple + convergence reference). */
export const CAPITAL_OUTPUT_RATIO_TARGET = 3;
/** Investment as a share of output at the neutral prime rate. */
export const BASE_INVESTMENT_RATE = 0.2;
/**
 * Annual depreciation, DERIVED so steady-state `K/Y = invRate/δ = target` at the
 * neutral rate (not a magic constant): δ = BASE_INVESTMENT_RATE / target ≈ 0.0667.
 */
export const ANNUAL_DEPRECIATION = BASE_INVESTMENT_RATE / CAPITAL_OUTPUT_RATIO_TARGET;
/** Long-run neutral prime rate r* (%); at this rate investmentRate = BASE. */
export const NEUTRAL_PRIME_RATE = 3;

/** Investment-rate response per percentage point of (neutral − prime). */
const INVESTMENT_RATE_SENSITIVITY = 0.02;
const INVESTMENT_RATE_MIN = 0.05;
const INVESTMENT_RATE_MAX = 0.4;
const CAPITAL_FLOOR = 0;

/**
 * Investment rate as a share of output, falling as the prime rate rises (cheap
 * money → more investment; decision #12 monetary coupling). Clamped to a sane
 * band so extreme rates can't drive investment negative or unbounded.
 */
export function investmentRate(primeRate: number, neutralRate?: number): number {
  const r = Number.isFinite(primeRate) ? primeRate : NEUTRAL_PRIME_RATE;
  // A country's neutral rate is era- and country-specific (monetaryEra.ts
  // authors DD 3.5, RU 2.5, BR 12.0), but this defaulted to a global 3 — so a
  // country whose ADMINISTERED rate legitimately sits above 3 was scored as
  // running tight money forever. DD at prime 5.0 got investmentRate 0.16
  // against a seeded K/Y of 3.0, i.e. a steady-state target of 2.4, so its
  // capital stock depreciated every turn while RU (prime 2.5, neutral 2.5) sat
  // exactly on target and accumulated. Passing the country's own neutral rate
  // makes "tight" mean tight RELATIVE TO THAT COUNTRY.
  const neutral =
    typeof neutralRate === "number" && Number.isFinite(neutralRate) && neutralRate > 0
      ? neutralRate
      : NEUTRAL_PRIME_RATE;
  const raw = BASE_INVESTMENT_RATE + INVESTMENT_RATE_SENSITIVITY * (neutral - r);
  return Math.max(INVESTMENT_RATE_MIN, Math.min(INVESTMENT_RATE_MAX, raw));
}

/** Seed K at `target × GDP` (millions). Non-finite/non-positive GDP → 0. */
export function seedCapitalStock(gdp: number): number {
  const y = Number.isFinite(gdp) && gdp > 0 ? gdp : 0;
  return CAPITAL_OUTPUT_RATIO_TARGET * y;
}

export interface CapitalStep {
  /** New capital stock K (millions). */
  capital: number;
  /** Per-turn gross investment (millions). */
  investment: number;
  /** Per-turn depreciation (millions). */
  depreciation: number;
  /** Annualized ΔK/K — the input the P1c-1 potential layer consumes. */
  annualizedGrowth: number;
}

/**
 * Advance K by one turn. audit-cap-1: investment AND depreciation share the
 * per-turn cadence (`/turnsPerYear`). `outputAnnual` is the region's annual GDP
 * (`state.gdp`, millions). Returns the new stock plus the ANNUALIZED `ΔK/K`
 * (`× turnsPerYear`) so the potential-growth term mixes cadences correctly.
 */
export function advanceCapitalStock(
  capital: number,
  outputAnnual: number,
  primeRate: number,
  turnsPerYear: number,
  /**
   * O1c (design §5): extra per-turn investment from corporate buildout — the
   * growth cost players actually paid this turn, in the SAME unit as `capital`
   * (local-currency millions), pre-capped by the caller. Default 0 ⇒
   * byte-identical to the pre-O1c capital math (flag-off / no macro-growth).
   */
  corpInvestmentPerTurn: number = 0,
  /**
   * The country's own long-run neutral prime rate (monetaryEra.ts). Omitted ⇒
   * the global NEUTRAL_PRIME_RATE, i.e. byte-identical to previous behaviour.
   */
  neutralRate?: number
): CapitalStep {
  const k = Number.isFinite(capital) && capital > 0 ? capital : 0;
  const y = Number.isFinite(outputAnnual) && outputAnnual > 0 ? outputAnnual : 0;
  const corp =
    Number.isFinite(corpInvestmentPerTurn) && corpInvestmentPerTurn > 0 ? corpInvestmentPerTurn : 0;
  const investment = (investmentRate(primeRate, neutralRate) * y) / turnsPerYear + corp;
  const depreciation = (ANNUAL_DEPRECIATION / turnsPerYear) * k;
  const next = Math.max(CAPITAL_FLOOR, k + investment - depreciation);
  const annualizedGrowth = k > 0 ? ((investment - depreciation) / k) * turnsPerYear : 0;
  return { capital: next, investment, depreciation, annualizedGrowth };
}
