/**
 * Macro-growth v1 (design §4) — the convergence term (O2) and sector-signal
 * blend (O3) that fold corporate/tangible growth and historical catch-up into
 * potential growth. Pure functions + calibration constants; the phase wires the
 * inputs and gates the whole thing on `macroGrowthV1`. Flag-on only — off,
 * `phase.ts` never calls these.
 */

/** Convergence slope: pp of catch-up per natural-log unit of relative-income gap. */
export const CONVERGENCE_BETA = 2.0;
/** Hard cap on the convergence bonus (pp/yr) before the openness gate scales it. */
export const CONVERGENCE_CAP = 6.0;
/** Fraction of the (lagged) sector signal's deviation from potential folded in (O3). */
export const SECTOR_BLEND_WEIGHT = 0.15;

/** Openness gate weights (sum to 1): state-system, trade, economic freedom. */
const GATE_W_ECON = 0.5;
const GATE_W_TRADE = 0.3;
const GATE_W_FREEDOM = 0.2;

/**
 * SOCI band for the state-system openness component. SOCI is stored 0–100
 * (state-owned corporate revenue ÷ total × 100 — see nationalization/
 * concentration.ts), NOT 0–1: use percentage thresholds.
 */
const SOCI_MARKET = 20; // ≤ this ⇒ fully market (factor 1)
const SOCI_COMMAND = 67; // ≥ this ⇒ maximally state-owned; STATE_CAPITALIST_OWNERSHIP_THRESHOLD (0.67) on the 0–100 scale
/**
 * Floor on the state-system factor (user decision 2026-07-09): heavy state
 * ownership DAMPS convergence but never guts it — a state-capitalist but
 * trade-participating economy (e.g. in-game 76%-state-owned CN) still catches
 * up moderately rather than being pinned to near-zero convergence.
 */
const ECON_SYSTEM_FLOOR = 0.5;

/** Trade openness ramp around the world baseline (economic.ts WORLD_TRADE_BASELINE = 2.5). */
const TRADE_BASELINE = 2.5;
const TRADE_HALF_WIDTH = 5; // ±5pp around baseline spans [0,1]

/** Economic-freedom ramp (metric is 0-100, neutral 50). */
const FREEDOM_LOW = 25;
const FREEDOM_SPAN = 35; // 25→60 maps 0→1

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/**
 * State-system openness from state-ownership concentration (SOCI, 0–100). High
 * ownership → floored (ECON_SYSTEM_FLOOR); low → market (1); linear between the
 * bands, never below the floor. Missing ⇒ 1 (assume market — absence must never
 * suppress catch-up). Keyed off SOCI, NOT the economic-model archetype, so a
 * reform-era economy is classified by its actual ownership; the floor keeps a
 * state-heavy but trade-participating economy converging moderately.
 */
export function econSystemFactor(soci: number | undefined): number {
  if (typeof soci !== "number" || !Number.isFinite(soci)) return 1;
  if (soci <= SOCI_MARKET) return 1;
  if (soci >= SOCI_COMMAND) return ECON_SYSTEM_FLOOR;
  const ramp = (SOCI_COMMAND - soci) / (SOCI_COMMAND - SOCI_MARKET);
  return Math.max(ECON_SYSTEM_FLOOR, ramp);
}

/** Trade openness from lagged tradeGrowth vs the world baseline. Missing ⇒ 0.5. */
export function tradeFactor(tradeGrowth: number | undefined): number {
  const g =
    typeof tradeGrowth === "number" && Number.isFinite(tradeGrowth) ? tradeGrowth : TRADE_BASELINE;
  return clamp01((g - TRADE_BASELINE + TRADE_HALF_WIDTH) / (2 * TRADE_HALF_WIDTH));
}

/** Economic-freedom openness from the 0-100 metric. Missing ⇒ 0.5 (ramp midpoint). */
export function freedomFactor(economicFreedom: number | undefined): number {
  const f =
    typeof economicFreedom === "number" && Number.isFinite(economicFreedom)
      ? economicFreedom
      : FREEDOM_LOW + FREEDOM_SPAN / 2;
  return clamp01((f - FREEDOM_LOW) / FREEDOM_SPAN);
}

/** Weighted openness gate (0..1). */
export function opennessGate(f: { econSystem: number; trade: number; freedom: number }): number {
  return clamp01(GATE_W_ECON * f.econSystem + GATE_W_TRADE * f.trade + GATE_W_FREEDOM * f.freedom);
}

export interface PlannedDevelopmentInputs {
  industrialPolicyExecution?: number;
  workforceSkill?: number;
  transportEfficiency?: number;
  /** Productive public investment effort, normalized to 0..1. */
  publicInvestmentEffort?: number;
  /** Pre-normalized trade factor in the range 0..1. */
  trade: number;
}

const scoreFactor = (value: number | undefined, fallback: number, scale: number): number => {
  const score = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return clamp01(score / scale);
};

/**
 * Administrative catch-up route for a planned economy. Strong execution,
 * human capital, infrastructure, public investment, and trade access can absorb frontier
 * technology even when private ownership and economic freedom are low.
 */
export function plannedDevelopmentGate(inputs: PlannedDevelopmentInputs): number {
  const execution = scoreFactor(inputs.industrialPolicyExecution, 0.5, 1);
  const skill = scoreFactor(inputs.workforceSkill, 60, 100);
  const transport = scoreFactor(inputs.transportEfficiency, 55, 100);
  const publicInvestment = scoreFactor(inputs.publicInvestmentEffort, 0, 1);
  const trade = clamp01(Number.isFinite(inputs.trade) ? inputs.trade : 0.5);
  return clamp01(
    0.25 * execution + 0.25 * skill + 0.2 * transport + 0.1 * trade + 0.2 * publicInvestment
  );
}

export interface DevelopmentGateInputs {
  soci?: number;
  tradeGrowth?: number;
  economicFreedom?: number;
  industrialPolicyExecution?: number;
  workforceSkill?: number;
  transportEfficiency?: number;
  publicInvestmentEffort?: number;
}

/**
 * Use the stronger credible development route. The planned route fades in
 * only above the market-ownership band, so a market economy cannot stack both
 * systems while a state-heavy economy is not forced to liberalize to catch up.
 */
export function developmentGate(inputs: DevelopmentGateInputs): number {
  const trade = tradeFactor(inputs.tradeGrowth);
  const market = opennessGate({
    econSystem: econSystemFactor(inputs.soci),
    trade,
    freedom: freedomFactor(inputs.economicFreedom),
  });
  const soci =
    typeof inputs.soci === "number" && Number.isFinite(inputs.soci) ? inputs.soci : SOCI_MARKET;
  const plannedWeight = clamp01((soci - SOCI_MARKET) / (SOCI_COMMAND - SOCI_MARKET));
  const planned = plannedDevelopmentGate({
    industrialPolicyExecution: inputs.industrialPolicyExecution,
    workforceSkill: inputs.workforceSkill,
    transportEfficiency: inputs.transportEfficiency,
    publicInvestmentEffort: inputs.publicInvestmentEffort,
    trade,
  });
  return Math.max(market, plannedWeight * planned);
}

/**
 * Conditional convergence bonus (pp/yr): `openness × min(CAP, β·ln(frontier/own))`,
 * only when the region is BEHIND the frontier (ratio > 1). Never negative — at or
 * above parity the term is exactly 0 (no maturity penalty). Self-extinguishing:
 * recomputed each turn from live per-capita, so it shrinks ~β·ln2 per income
 * doubling and hits 0 at parity.
 */
export function convergenceBonus(ownPc: number, frontierPc: number, openness: number): number {
  if (!Number.isFinite(ownPc) || !Number.isFinite(frontierPc) || ownPc <= 0 || frontierPc <= 0) {
    return 0;
  }
  const ratio = frontierPc / ownPc;
  if (ratio <= 1) return 0;
  const raw = Math.min(CONVERGENCE_CAP, CONVERGENCE_BETA * Math.log(ratio));
  const gate = clamp01(Number.isFinite(openness) ? openness : 0);
  return raw * gate;
}

/**
 * O3 sector blend: pull potential a fraction of the way toward the LAGGED sector
 * signal, so persistent tangible-economy growth becomes partially structural.
 * `sectorLagged == potential` ⇒ unchanged.
 */
export function applySectorBlend(
  potential: number,
  sectorLagged: number,
  weight: number = SECTOR_BLEND_WEIGHT
): number {
  const p = Number.isFinite(potential) ? potential : 0;
  const s = Number.isFinite(sectorLagged) ? sectorLagged : p;
  return p + weight * (s - p);
}
