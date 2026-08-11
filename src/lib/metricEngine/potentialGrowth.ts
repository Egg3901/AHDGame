/**
 * Supply-side POTENTIAL growth (design §5.1) — the slow trend GDP gravitates
 * toward. Solow LEVEL form (audit RA1): `potentialGrowth = αL·g_L + αK·g_K + TFP`,
 * `αL + αK = 1`; the capital input is stock growth `ΔK/K` (P1c-0), NOT per-worker
 * deepening. All terms are ANNUAL (audit-1). P1c-1 SURFACES this; the
 * `gdpGrowth = potential + cyclical` integration is P1c-2 (named). The full TFP
 * basket (R&D / education / infra / urban agglomeration, with the §6.1-C3
 * damping) replaces `TFP_BASELINE` in a later phase (named) — kept out of P1c-1
 * so the labor+capital demographic payoff lands without the C3 calibration loop.
 */

export const LABOR_SHARE = 0.66;
export const CAPITAL_SHARE = 0.34;
/** Calibrated long-run total-factor-productivity growth (%/yr) until the basket lands. */
export const TFP_BASELINE = 1.2;
/** Mid-band fallback when a region's laborParticipation metric is absent (50–75%). */
export const NEUTRAL_LABOR_PARTICIPATION = 62.5;

/**
 * Civilian labor force = (working-age − serving) × participation share (people).
 * Conscripts are subtracted before scaling (§4.5 — serving people are out of the
 * civilian labor force, lowering potential `L`).
 */
export function computeLaborForce(
  workingAgePop: number,
  militaryServicePop: number,
  laborParticipationPct: number
): number {
  const wa = Number.isFinite(workingAgePop) && workingAgePop > 0 ? workingAgePop : 0;
  const serving =
    Number.isFinite(militaryServicePop) && militaryServicePop > 0 ? militaryServicePop : 0;
  const civilian = Math.max(0, wa - serving);
  const pct = Number.isFinite(laborParticipationPct)
    ? laborParticipationPct
    : NEUTRAL_LABOR_PARTICIPATION;
  return civilian * (pct / 100);
}

/** Annualized growth rate (%) of a quantity from its prior-turn value. 0 on cold start. */
export function annualizedGrowthRate(curr: number, prev: number, turnsPerYear: number): number {
  if (!Number.isFinite(curr) || !Number.isFinite(prev) || prev <= 0) return 0;
  return ((curr - prev) / prev) * 100 * turnsPerYear;
}

// ── TFP basket (P2d — replaces the flat TFP_BASELINE) ───────────────────────

/** TFP basket inputs — each read from the PREV turn's stateMetrics (the C3 lag). */
export interface TfpBasketInputs {
  rdIntensity?: number; // % of GDP, THRESHOLDS [0.5, 4.5]
  workforceSkill?: number; // 0-100, THRESHOLDS [30, 90] (P2a education hand-off)
  transportEfficiency?: number; // 0-100 (P2c infrastructure hand-off)
  broadbandAccess?: number; // 0-100 % (P2c — the digital half of the infra composite)
  powerGridReliability?: number; // ~97-99.9 % (P2c — tight realistic band)
  urbanizationRate?: number; // 0-100 %, THRESHOLDS [25, 92]
}

/**
 * Typical mid-tier world-start levels. The basket is authored in
 * DEVIATION-FROM-REFERENCE form, so at these inputs TFP = TFP_BASELINE exactly —
 * going live is parity-preserving for an average region, and the terms only
 * express how a region DEVIATES (better schools, more R&D, denser cities).
 */
export const TFP_REFERENCE_INPUTS: Required<TfpBasketInputs> = {
  rdIntensity: 2.5,
  workforceSkill: 60,
  transportEfficiency: 55,
  broadbandAccess: 75,
  powerGridReliability: 98.5,
  urbanizationRate: 55,
};

/** TFP clamp: never negative-growth from TFP alone; bounded upside. */
export const TFP_BOUNDS: [number, number] = [0.2, 2.6];

/**
 * Saturating agglomeration (audit-C3): concave in urbanization so the
 * urbanization↔productivity↔GDP positive loop converges instead of running
 * away — marginal TFP gains shrink as urbanization → high. Lag is the other
 * half of the damping (inputs are prev-turn reads).
 */
export function agglomeration(urbanizationRate: number): number {
  const u = Math.max(0, Math.min(100, urbanizationRate));
  return u / (u + 40);
}

const orRef = (v: number | undefined, ref: number): number =>
  typeof v === "number" && Number.isFinite(v) ? v : ref;

/**
 * The living TFP (annual %): R&D + workforce skill + transport infrastructure +
 * saturating urban agglomeration, each as a bounded deviation from its
 * reference. Replaces `TFP_BASELINE` in the potential-growth computation (P2d);
 * `economic.productivityGrowth` is animated from the same formula.
 */
export function tfpBasket(inputs: TfpBasketInputs): number {
  const ref = TFP_REFERENCE_INPUTS;
  const rd = orRef(inputs.rdIntensity, ref.rdIntensity);
  const skill = orRef(inputs.workforceSkill, ref.workforceSkill);
  const transport = orRef(inputs.transportEfficiency, ref.transportEfficiency);
  const broadband = orRef(inputs.broadbandAccess, ref.broadbandAccess);
  const grid = orRef(inputs.powerGridReliability, ref.powerGridReliability);
  const urban = orRef(inputs.urbanizationRate, ref.urbanizationRate);

  // The infra composite (design §5: transport/broadband/grid). Grid normalizes
  // over its tight realistic band [97, 99.9].
  const infraTerm =
    0.2 * ((transport - ref.transportEfficiency) / 45) +
    0.15 * ((broadband - ref.broadbandAccess) / 25) +
    0.1 * ((grid - ref.powerGridReliability) / 1.45);

  const tfp =
    TFP_BASELINE +
    0.25 * ((rd - ref.rdIntensity) / 2) +
    0.5 * ((skill - ref.workforceSkill) / 30) +
    infraTerm +
    1.5 * (agglomeration(urban) - agglomeration(ref.urbanizationRate));

  return Math.max(TFP_BOUNDS[0], Math.min(TFP_BOUNDS[1], tfp));
}

/** Solow potential growth (annual %). Shares default to αL/αK (sum to 1). */
export function potentialGrowth(
  laborGrowthAnnual: number,
  capitalGrowthAnnual: number,
  tfpAnnual: number,
  laborShare: number = LABOR_SHARE,
  capitalShare: number = CAPITAL_SHARE
): number {
  const gL = Number.isFinite(laborGrowthAnnual) ? laborGrowthAnnual : 0;
  const gK = Number.isFinite(capitalGrowthAnnual) ? capitalGrowthAnnual : 0;
  const tfp = Number.isFinite(tfpAnnual) ? tfpAnnual : 0;
  return laborShare * gL + capitalShare * gK + tfp;
}
