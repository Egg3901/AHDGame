/**
 * Phase 5/6, NPC unionization metric + standing labor-cost premium
 * (`labourSystemMode >= "unions"`).
 *
 * Per-sector, 0, 100, drifts toward a condition-driven target each turn.
 * `unionPremium()` turns unionization into a standing labor-cost surcharge
 * (Phase 6), see `src/lib/labour/strikes.ts` for the other Phase 6
 * mechanism (bounded-duration strike events), which is a separate file
 * since it carries its own state machine and constants. See
 * docs/plans/2026-06-30-labour-system.md, Phases 5, 6.
 *
 * Shape note (why this is safe without v2's Δ-not-level discipline): the
 * v2 metric-engine registry nodes (medianIncome, unemploymentRate in
 * laborCost.ts) are RECURSIVE series with no mean-reversion, so a constant
 * LEVEL term held there would march the series to its bound and pin there,
 * they needed Δ-based terms instead. Unionization is a different shape: the
 * TARGET is recomputed fresh from current conditions every turn (never
 * accumulated onto its own past value), and `trendUnionization` only steps
 * the stored value toward that target by a bounded per-turn amount, hard-
 * clamped to [0,100]. A sustained condition produces a bounded SETTLE at
 * the corresponding target, not a runaway climb. This mirrors
 * `trendGrowthRate` (`sectorGrowth.ts`), the same pattern already used for
 * `currentGrowthRate` trending toward `targetGrowthRate`, not the v2
 * pattern. Safe by construction; LEVEL inputs are fine here.
 */

/** Per-turn step limit on unionization drift (pp/turn). */
export const UNIONIZATION_TREND_STEP_PER_TURN = 1.5;

/** Ambient unionization at baseline conditions (wageLevel 1, cost-of-living 100, unemployment 5, Kaitz neutral). */
export const UNIONIZATION_BASELINE = 20;

/** Neutral unemployment rate (%) the worker-leverage term is centered on, matches DEFAULT_UNEMPLOYMENT elsewhere. */
export const UNIONIZATION_NEUTRAL_UNEMPLOYMENT = 5;
/** Neutral Kaitz ratio the min-wage term is centered on. */
export const UNIONIZATION_NEUTRAL_KAITZ = 0.5;

/** Weight (pp of unionization target) per 1.0 deviation of the real-wage index from baseline (1.0). */
export const UNIONIZATION_REAL_WAGE_WEIGHT = 40;
/** Weight (pp) per 1pp of unemployment below the neutral rate (tight labor market ⇒ worker leverage). */
export const UNIONIZATION_UNEMPLOYMENT_WEIGHT = 3;
/** Weight (pp) per 1.0 deviation of the Kaitz ratio below neutral (weak minimum-wage protection). */
export const UNIONIZATION_MINWAGE_WEIGHT = 20;
/**
 * v3 Phase 7b: weight applied to the country's union-law bias (-50..+50)
 * before adding it to the target. 0.6 caps the law's own contribution at
 * ±30pp, strong (it's the government's structural lever, per the design
 * doc) but not so strong it swamps every other term outright.
 *
 * Composed with UNIONIZATION_MEMBERSHIP_PRESSURE_WEIGHT below, this raises
 * the target's real ceiling from ~63 (Phase 5/6, wage/employment/min-wage
 * only) to ~100 (clamped), see the updated calibration note at the top of
 * `strikes.ts` (STRIKE_UNIONIZATION_THRESHOLD). Deliberate: political
 * organizing is meant to be a real, independent lever, not one that only
 * matters on top of pre-existing economic distress.
 */
export const UNIONIZATION_LAW_WEIGHT = 0.6;
/**
 * Approval at which a representing union neither helps nor hurts its sector's
 * density. Members who are indifferent keep the shop exactly as organized as
 * economic conditions alone would.
 */
export const UNIONIZATION_APPROVAL_NEUTRAL = 50;

/**
 * Union dues v1: weight applied to the representing union's approval, measured
 * against {@link UNIONIZATION_APPROVAL_NEUTRAL}, before adding it to the
 * target. 0.6 puts the union's own contribution in ±30pp.
 *
 * SIGNED, unlike the `membershipPressure` term it replaces. That term could
 * only push density up, because recruitment was the only lever and there was no
 * way to run a union badly. Approval can sit below neutral, so a union that
 * charges heavy dues and funds nothing now watches its own shops drift back
 * toward unorganized. That downward half is the whole point: it is what makes
 * the dues slider a decision rather than free money, and it is what a targeted
 * organizing drive is pushing against when it spikes a sector above target and
 * `trendUnionization` walks it back down.
 */
export const UNIONIZATION_APPROVAL_WEIGHT = 0.6;

export interface UnionizationDriftInputs {
  /** CEO wage-level slider (1.0 = baseline). Absent/non-finite ⇒ 1 (neutral). */
  wageLevel: number | undefined;
  /** State cost-of-living index (100 = baseline). Absent/non-finite/≤0 ⇒ 100 (neutral). */
  costOfLivingIndex: number | undefined;
  /** State unemployment rate (%). Absent/non-finite ⇒ UNIONIZATION_NEUTRAL_UNEMPLOYMENT. */
  unemploymentRate: number | undefined;
  /**
   * Country minimum-wage Kaitz ratio (0, 1). Absent/non-finite/0 ⇒
   * UNIONIZATION_NEUTRAL_KAITZ, NOT 0, `minWageRatioByCountry` maps a
   * country with no minimum-wage policy configured to 0 (see
   * `buildMinWageRatioByCountry`), and most countries/eras don't have one
   * set (it's admin-only today). Treating that as "minimum wage maximally
   * lags" would skew unionization upward almost everywhere by default the
   * moment "unions" mode turns on, the absence of a policy isn't the same
   * signal as a deliberately weak one.
   */
  minWageKaitzRatio: number | undefined;
  /**
   * v3 Phase 7b: country union-law bias (-50 right-to-work .. +50
   * collective-bargaining). Absent/non-finite ⇒ 0 (neutral/no law), unlike
   * `minWageKaitzRatio`, absence genuinely means "no law", so 0 is the
   * correct neutral fallback here (no analogous "treat absence as weak"
   * pitfall).
   */
  unionLawBias: number | undefined;
  /**
   * Union dues v1: the approval (0-100) of the union that REPRESENTS this
   * sector, or undefined when no union holds it. Undefined leaves the term at
   * 0, so unrepresented sectors keep Phase 5's NPC drift exactly as it was
   * ("conversion not reinvention").
   *
   * Caller resolves this from `CorporateSector.representingUnionId`, not from
   * a (countryId, sectorType) match: since players can found rivals, matching
   * by industry no longer identifies a single union, and an unheld sector must
   * not inherit some other union's approval.
   */
  representingUnionApproval: number | undefined;
}

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * Real-wage index: `wageLevel` adjusted for the region's cost of living.
 * 1.0 at baseline (wageLevel 1, cost-of-living 100). Below 1 ⇒ pay hasn't
 * kept up with cost-of-living (or was cut) ⇒ more pressure; above 1 ⇒ less.
 * `costOfLivingIndex` absent/non-finite/≤0 ⇒ 100 (neutral), same defaulting
 * `unionizationDriftTarget` always applied inline before this was extracted,
 * kept here so every call site (unionization drift, the Phase 6 strike
 * trigger in `strikes.ts`) shares identical neutral-fallback behavior.
 */
export function realWageIndex(wageLevel: number, costOfLivingIndex: number | undefined): number {
  const rawCostOfLiving = finiteOr(costOfLivingIndex, 100);
  const safeCostOfLiving = rawCostOfLiving > 0 ? rawCostOfLiving : 100;
  return wageLevel / (safeCostOfLiving / 100);
}

/**
 * Target unionization level (0, 100) for the current turn's conditions. Pure
 *, no DB/turn state. `trendUnionization` steps the persisted value toward
 * this target by at most `UNIONIZATION_TREND_STEP_PER_TURN` per turn.
 */
export function unionizationDriftTarget(inputs: UnionizationDriftInputs): number {
  const wageLevel = finiteOr(inputs.wageLevel, 1);
  const unemploymentRate = finiteOr(inputs.unemploymentRate, UNIONIZATION_NEUTRAL_UNEMPLOYMENT);
  const rawKaitz = finiteOr(inputs.minWageKaitzRatio, UNIONIZATION_NEUTRAL_KAITZ);
  const minWageKaitzRatio = rawKaitz > 0 ? rawKaitz : UNIONIZATION_NEUTRAL_KAITZ;
  const unionLawBias = finiteOr(inputs.unionLawBias, 0);
  const representingUnionApproval = inputs.representingUnionApproval;

  const realWageTerm =
    (1 - realWageIndex(wageLevel, inputs.costOfLivingIndex)) * UNIONIZATION_REAL_WAGE_WEIGHT;
  // Worker leverage: a tight labor market (low unemployment) raises pressure.
  const unemploymentTerm =
    (UNIONIZATION_NEUTRAL_UNEMPLOYMENT - unemploymentRate) * UNIONIZATION_UNEMPLOYMENT_WEIGHT;
  // Weak minimum-wage protection (Kaitz ratio below neutral) raises pressure.
  const minWageTerm =
    (UNIONIZATION_NEUTRAL_KAITZ - minWageKaitzRatio) * UNIONIZATION_MINWAGE_WEIGHT;
  // v3 Phase 7b: the government's structural lever, positive bias (collective
  // bargaining protection) raises pressure, negative (right-to-work) lowers it.
  const lawTerm = unionLawBias * UNIONIZATION_LAW_WEIGHT;
  // Union dues v1: the representing union's approval, signed about neutral, so
  // a badly run union drags its own shops down as surely as a good one lifts
  // them. Undefined (nobody represents this sector) contributes nothing.
  const approvalTerm =
    representingUnionApproval == null || !Number.isFinite(representingUnionApproval)
      ? 0
      : (Math.max(0, Math.min(100, representingUnionApproval)) - UNIONIZATION_APPROVAL_NEUTRAL) *
        UNIONIZATION_APPROVAL_WEIGHT;

  const target =
    UNIONIZATION_BASELINE + realWageTerm + unemploymentTerm + minWageTerm + lawTerm + approvalTerm;
  return Math.max(0, Math.min(100, target));
}

/**
 * Trends a sector's stored unionization toward `target` by at most
 * `UNIONIZATION_TREND_STEP_PER_TURN` per turn, mirrors `trendGrowthRate`'s
 * (`sectorGrowth.ts`) step-limited, no-overshoot, rounded pattern exactly.
 */
export function trendUnionization(current: number, target: number): number {
  const clampedTarget = Math.max(0, Math.min(100, target));
  if (current === clampedTarget) return current;
  const diff = clampedTarget - current;
  const step = Math.sign(diff) * Math.min(UNIONIZATION_TREND_STEP_PER_TURN, Math.abs(diff));
  const next = current + step;
  const clamped = Math.max(0, Math.min(100, next));
  return Math.round(clamped * 10) / 10;
}

/**
 * Union ban (player suggestion #93): per-turn decay step applied to a
 * sector's unionization while its country has `unionsBanned`, deliberately
 * FASTER than the normal `UNIONIZATION_TREND_STEP_PER_TURN` (1.5) since a
 * ban dissolves organized labour outright rather than letting conditions
 * drift; 3pp/turn empties a fully-organized sector in ~33 turns.
 */
export const UNIONIZATION_BAN_DECAY_STEP_PER_TURN = 3;

/**
 * Steps a banned country's sector unionization toward 0 by at most
 * `UNIONIZATION_BAN_DECAY_STEP_PER_TURN` per turn. Replaces the normal
 * `unionizationDriftTarget` + `trendUnionization` pair while the ban is in
 * force (target is forced to 0 regardless of conditions); on repeal the
 * normal drift resumes from wherever this decay left the value. Same
 * no-overshoot + one-decimal rounding contract as `trendUnionization`.
 */
export function decayUnionizationUnderBan(current: number): number {
  const c = Math.max(0, Math.min(100, Number.isFinite(current) ? current : 0));
  const next = Math.max(0, c - UNIONIZATION_BAN_DECAY_STEP_PER_TURN);
  return Math.round(next * 10) / 10;
}

/** Labor-cost surcharge (percentage points) at unionization = 100. */
export const UNION_PREMIUM_MAX_PCT = 15;

/**
 * Phase 6: a standing labor-cost surcharge proportional to unionization,
 * 0 at unionization 0 (baseline-invariant), linear up to `UNION_PREMIUM_MAX_PCT`
 * at unionization 100. Returns a percentage POINT value (0, 15), consumed at
 * the call site as `1 + unionPremium(...) / 100`. Independent of the strike
 * mechanism (`strikes.ts`), this applies continuously whenever unionization
 * is above 0, with no event/state machine of its own.
 */
export function unionPremium(unionization: number): number {
  const u = Math.max(0, Math.min(100, Number.isFinite(unionization) ? unionization : 0));
  return (u / 100) * UNION_PREMIUM_MAX_PCT;
}
