import type { CorporationType } from "@/lib/constants/corporations";
import type { RepresentingUnionEffects } from "@/lib/unions/unionLookups";

/**
 * Phase 1–2 of the Labour/Unions system: make labor an explicit cost that can
 * move with a wage slider, automation, unions, and minimum wage — without
 * changing baseline outcomes.
 *
 * The key property is **baseline invariance**: labor is carved OUT of the
 * sector's existing maintenance (which already implicitly includes it), never
 * added on top. At `wageLevel === 1` with no union premium and no minimum-wage
 * floor, total maintenance — and therefore profit — is exactly what it was
 * before the labour system existed, for ANY labor share. Only deviations move
 * the economy. This is what lets the refactor ship behind a flag with golden
 * masters staying green.
 *
 * Labor is decomposed into **workers × wage-per-worker** so that:
 *   - High-skill sectors (few workers via the revenue/skill worker formula)
 *     get a high implied wage-per-worker — e.g. technology pays a lot to a few.
 *   - Low-skill sectors (many workers) get a low wage-per-worker — e.g. retail.
 * This decomposition is what minimum wage (a floor on wage-per-worker) and the
 * UI (implied wage vs. state median income) act on.
 *
 * See docs/plans/2026-06-30-labour-system.md.
 */

/** Per-turn labour context threaded into sector profit calculations. */
export interface LabourContext {
  /** True when `labourSystemMode >= "wages"`: labor becomes an explicit cost. */
  wagesEnabled: boolean;
  /**
   * Minimum-wage Kaitz ratio (min wage ÷ median wage) per country. Absent/0 ⇒
   * no minimum wage. Populated from legislation; floors low-pay sectors' labor.
   */
  minWageRatioByCountry?: ReadonlyMap<string, number>;
  /**
   * v3 Phase 5/6: true when `labourSystemMode >= "unions"`. A strict superset
   * of `wagesEnabled` (a higher tier in `LABOUR_MODE_ORDER`) — gates the NPC
   * unionization metric (`unionization.ts`) and strikes (`strikes.ts`).
   */
  unionsEnabled?: boolean;
  /**
   * v3 Phase 7b: true when `labourSystemMode >= "full"`. A strict superset of
   * `unionsEnabled` — gates union-law bias (`unionLawBiasByCountry` below)
   * feeding `unionizationDriftTarget()`/strike thresholds, and union-busting
   * (`src/lib/labour/unionBusting.ts`).
   */
  fullEnabled?: boolean;
  /**
   * v3 Phase 7b: per-country union-law bias (-50 right-to-work .. +50
   * collective-bargaining), set by an enacted `UnionLawProvision` bill.
   * Absent/0 ⇒ neutral/no law. See `buildUnionLawBiasByCountry` below and
   * `src/lib/labour/unionLaws.ts`.
   */
  unionLawBiasByCountry?: ReadonlyMap<string, number>;
  /**
   * Union dues v1: every union's approval + active services, keyed by union
   * `_id` (string) — see `buildUnionEffectsById` in
   * `src/lib/unions/unionLookups.ts`. The caller resolves a sector's
   * representing union via `CorporateSector.representingUnionId` and looks it
   * up here; a sector with no representing union gets nothing from this map,
   * so Phase 5's NPC drift is unaffected for it. Feeds
   * `unionizationDriftTarget()`'s `representingUnionApproval` input alongside
   * `unionLawBiasByCountry`, and the strike trigger's softening term.
   */
  unionsById?: ReadonlyMap<string, RepresentingUnionEffects>;
  /**
   * Release 1.1 collective agreements, keyed by CorporateSector id. The turn
   * uses the highest active floor when defensive legacy data overlaps.
   */
  collectiveAgreementWageFloorBySectorId?: ReadonlyMap<string, number>;
  /** CorporateSector ids covered by an active no-strike term this turn. */
  noStrikeProtectedSectorIds?: ReadonlySet<string>;
  /** Output factors from active employer-scoped industrial action. */
  industrialActionOutputFactorBySectorId?: ReadonlyMap<string, number>;
  /**
   * Union ban (player suggestion #93): countries whose `FederalBudget` has
   * `unionsBanned: true` (an enacted union-ban law). Read at the `unions`
   * tier and above: while banned, a country's sectors decay unionization
   * toward 0 (`decayUnionizationUnderBan`), skip the union wage premium, and
   * can't trigger strikes (active ones force-resolve). See
   * `buildUnionsBannedByCountry` below and `src/lib/labour/unionLaws.ts`.
   */
  unionsBannedByCountry?: ReadonlySet<string>;
}

/** Inert context — labor folded into maintenance exactly as before the system. */
export const LABOUR_DISABLED: LabourContext = {
  wagesEnabled: false,
  unionsEnabled: false,
  fullEnabled: false,
};

/**
 * Maximum minimum-wage Kaitz ratio. Real-world minimum-to-median ratios top out
 * around 0.6–0.7; we allow a little headroom but cap at 1.0 (a floor at the
 * median itself), beyond which the floor would lift above-median sectors too.
 */
export const MIN_WAGE_KAITZ_MAX = 1.0;

/** Clamp a requested Kaitz ratio into [0, MIN_WAGE_KAITZ_MAX]; non-finite → 0. */
export function clampKaitzRatio(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(MIN_WAGE_KAITZ_MAX, Math.max(0, value));
}

/**
 * Build the per-country minimum-wage Kaitz map the turn passes in the
 * LabourContext, from the federal budgets. Only countries with a positive ratio
 * are included (absent ⇒ no floor).
 */
export function buildMinWageRatioByCountry(
  budgets: ReadonlyArray<{ countryId?: string | null; minimumWageKaitzRatio?: number | null }>
): Map<string, number> {
  const out = new Map<string, number>();
  for (const b of budgets) {
    const ratio = clampKaitzRatio(b.minimumWageKaitzRatio ?? 0);
    if (b.countryId && ratio > 0) out.set(b.countryId, ratio);
  }
  return out;
}

/**
 * Build the per-country union-law bias map the turn passes in the
 * LabourContext, from the federal budgets. Mirrors `buildMinWageRatioByCountry`
 * exactly. Only countries with a non-zero bias are included (absent ⇒ neutral).
 */
export function buildUnionLawBiasByCountry(
  budgets: ReadonlyArray<{ countryId?: string | null; unionLawBias?: number | null }>
): Map<string, number> {
  const out = new Map<string, number>();
  for (const b of budgets) {
    const bias = b.unionLawBias;
    if (b.countryId && typeof bias === "number" && Number.isFinite(bias) && bias !== 0) {
      out.set(b.countryId, bias);
    }
  }
  return out;
}

/**
 * Build the set of countries under an enacted union ban, from the federal
 * budgets — the ban analog of `buildUnionLawBiasByCountry` above. Only banned
 * countries are included (absent ⇒ unions legal).
 */
export function buildUnionsBannedByCountry(
  budgets: ReadonlyArray<{ countryId?: string | null; unionsBanned?: boolean | null }>
): Set<string> {
  const out = new Set<string>();
  for (const b of budgets) {
    if (b.countryId && b.unionsBanned === true) out.add(b.countryId);
  }
  return out;
}

/**
 * CEO-set wage-level slider bounds. 1.0 is the profit-invariant baseline; below
 * it cuts wages (higher profit now, fuels unionization/strikes later), above it
 * pays up (lower profit now, buys labor peace + local goodwill later).
 */
export const WAGE_LEVEL_MIN = 0.8;
export const WAGE_LEVEL_MAX = 1.5;
export const WAGE_LEVEL_DEFAULT = 1.0;

/** Clamp a requested wage level into [WAGE_LEVEL_MIN, WAGE_LEVEL_MAX]; non-finite → default. */
export function clampWageLevel(value: number): number {
  if (!Number.isFinite(value)) return WAGE_LEVEL_DEFAULT;
  return Math.min(WAGE_LEVEL_MAX, Math.max(WAGE_LEVEL_MIN, value));
}

/**
 * Baseline labor share of revenue by sector — "how labor-intensive is this
 * industry." People-are-the-product sectors are high; capital/materials-heavy
 * sectors are low. Combined with the worker count (which already falls as skill
 * rises) this yields realistic wage-per-worker spreads: technology = high share
 * over few workers (high pay each); retail = moderate share over many workers
 * (low pay each); extraction = low share over a moderate crew.
 *
 * These are the only sector-level tuned numbers in Phase 2. Because the carve-out
 * is profit-invariant at wageLevel=1 for ANY value here, they change nothing at
 * baseline — they only set how big the wage lever's bite is per sector — so they
 * are safe to refine alongside ongoing balance work.
 */
export const SECTOR_LABOR_INTENSITY: Record<CorporationType, number> = {
  technology: 0.3,
  healthcare: 0.3,
  media: 0.28,
  entertainment: 0.28,
  construction: 0.28,
  financial: 0.25,
  defense: 0.24,
  retail: 0.22,
  telecommunications: 0.2,
  manufacturing: 0.18,
  logistics: 0.18,
  agriculture: 0.16,
  automobiles: 0.16,
  chemical_industries: 0.15,
  energy: 0.12,
  extraction: 0.12,
  real_estate: 0.1,
};

/** Fallback labor share when a sector type isn't in the table. */
export const LABOUR_DEFAULT_LABOR_SHARE = 0.2;

/**
 * Era multiplier on labor share — older eras were more labor-intensive across
 * the board (less automation). Applied on top of the per-sector intensity.
 * Ordered high→low year; first `year >= minYear` wins. Profit-invariant at
 * baseline, so calibrate era-by-era alongside seed completion.
 */
const ERA_LABOR_MULTIPLIER: ReadonlyArray<{ minYear: number; mult: number }> = [
  { minYear: 2007, mult: 1.0 },
  { minYear: 1991, mult: 1.1 },
  { minYear: 1953, mult: 1.25 },
];

export function eraLaborMultiplier(year?: number | null): number {
  if (typeof year === "number" && Number.isFinite(year)) {
    for (const tier of ERA_LABOR_MULTIPLIER) {
      if (year >= tier.minYear) return tier.mult;
    }
    return 1.35; // pre-1953 (most labor-intensive)
  }
  return 1.0;
}

/**
 * Resolve a sector's baseline labor share of revenue for the active era.
 * `laborShare0 = sectorIntensity × eraMultiplier`.
 */
export function getSectorLaborShare(
  sectorType: CorporationType | string,
  year?: number | null
): number {
  const intensity =
    SECTOR_LABOR_INTENSITY[sectorType as CorporationType] ?? LABOUR_DEFAULT_LABOR_SHARE;
  return intensity * eraLaborMultiplier(year);
}

/**
 * Per-sector relative WAGE LEVEL (pay per worker), centered near 1.0. This is
 * deliberately SEPARATE from labor intensity (share of revenue): a sector can be
 * labor-intensive yet low-paid (retail, agriculture — many low-skill workers) or
 * capital-light yet high-paid (technology, finance — few skilled workers).
 * Decoupling the two is what lets minimum wage bite the genuinely low-paid
 * sectors instead of merely the capital-intensive ones.
 *
 * Pay level drives (a) which sectors a minimum wage floors and (b) the displayed
 * wage-per-worker. It does NOT change a sector's total labor cost on its own —
 * cost is intensity × revenue (see getSectorLaborShare) and stays invariant.
 */
export const SECTOR_WAGE_LEVEL: Record<CorporationType, number> = {
  technology: 1.8,
  financial: 1.7,
  healthcare: 1.3,
  defense: 1.3,
  energy: 1.2,
  chemical_industries: 1.2,
  telecommunications: 1.2,
  extraction: 1.1,
  media: 1.1,
  automobiles: 1.0,
  manufacturing: 0.95,
  construction: 0.9,
  real_estate: 0.9,
  entertainment: 0.85,
  logistics: 0.8,
  retail: 0.6,
  agriculture: 0.55,
};

/** Median pay level across sectors — the denominator for the Kaitz minimum-wage ratio. */
export const MEDIAN_SECTOR_WAGE_LEVEL = (() => {
  const vals = Object.values(SECTOR_WAGE_LEVEL).sort((a, b) => a - b);
  const mid = Math.floor(vals.length / 2);
  return vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
})();

/** Pay level for a sector type, falling back to the median for unknown types. */
export function sectorWageLevel(sectorType: CorporationType | string): number {
  return SECTOR_WAGE_LEVEL[sectorType as CorporationType] ?? MEDIAN_SECTOR_WAGE_LEVEL;
}

/**
 * Minimum-wage floor as a cost MULTIPLIER, using the Kaitz index (minimum wage
 * as a fraction of the median wage). A sector paying below `kaitzRatio × median`
 * must lift its wages to the floor, raising its labor cost proportionally; one
 * paying at/above the floor is unaffected (multiplier 1). The per-state wage base
 * cancels, so this needs no absolute-wage units or per-state aggregation.
 *
 * `kaitzRatio` 0 (or unset) ⇒ no minimum wage ⇒ always 1.
 */
export function minWageFloorMultiplier(
  sectorType: CorporationType | string,
  kaitzRatio: number
): number {
  if (!(kaitzRatio > 0)) return 1;
  const wage = sectorWageLevel(sectorType);
  const floor = kaitzRatio * MEDIAN_SECTOR_WAGE_LEVEL;
  return wage < floor ? floor / wage : 1;
}

export interface SectorLaborCostResult {
  /** Labor slice carved out of gross maintenance at baseline (multiplier 1). */
  baselineLaborCost: number;
  /** Actual labor cost = baselineLaborCost × wageMultiplier. */
  laborCost: number;
  /** Maintenance excluding the baseline labor slice (non-labor operating cost). */
  maintenanceNonLabor: number;
  /** Total maintenance to substitute for gross (non-labor + actual labor). */
  maintenance: number;
}

/**
 * Split a sector's gross maintenance into non-labor cost + an explicit labor
 * cost, scaling labor by a single combined multiplier (wage slider × union
 * premium × minimum-wage floor × automation — assembled by the caller).
 *
 * Invariant: with `wageMultiplier === 1`, `result.maintenance ===
 * grossMaintenance` for any inputs — labor is carved OUT of existing
 * maintenance, never added on top, so baseline profit is unchanged.
 */
export function computeSectorLaborCost(params: {
  hourlyRevenue: number;
  grossMaintenance: number;
  laborShare0: number;
  wageMultiplier: number;
}): SectorLaborCostResult {
  const { hourlyRevenue, grossMaintenance, laborShare0, wageMultiplier } = params;
  // Never carve out more than the maintenance that exists (keeps non-labor ≥ 0
  // even for implausibly high labor shares or thin-margin sectors).
  const baselineLaborCost = Math.max(0, Math.min(grossMaintenance, laborShare0 * hourlyRevenue));
  const laborCost = baselineLaborCost * wageMultiplier;
  const maintenanceNonLabor = grossMaintenance - baselineLaborCost;
  return {
    baselineLaborCost,
    laborCost,
    maintenanceNonLabor,
    maintenance: maintenanceNonLabor + laborCost,
  };
}

/**
 * Per-state labour wage index (v2): the worker-weighted average of the labour
 * system's wage multiplier (wageLevel × minimum-wage floor) across a state's
 * sectors. The per-sector pay structure cancels, so the index isolates *what the
 * labour system changed*: 1.0 = baseline (no slider moves, no binding floor),
 * >1 = wages pushed up, <1 = cut. The macro coupling reads this to move
 * economic.medianIncome (gated on labourSystemMode ≥ "macro"). Streamed during
 * the corp turn's sector loop, one accumulator per state.
 */
export interface WageIndexAccumulator {
  /** Σ workers × wageLevel × floorMultiplier */
  weighted: number;
  /** Σ workers */
  workers: number;
}

export function makeWageIndexAccumulator(): WageIndexAccumulator {
  return { weighted: 0, workers: 0 };
}

export function accumulateWageIndex(
  acc: WageIndexAccumulator,
  workers: number,
  wageLevel: number,
  floorMultiplier: number
): void {
  const w = Math.max(0, workers);
  acc.weighted += w * wageLevel * floorMultiplier;
  acc.workers += w;
}

/** Worker-weighted average wage multiplier; 1.0 (baseline) when a state has no workers. */
export function resolveWageIndex(acc: WageIndexAccumulator): number {
  return acc.workers > 0 ? acc.weighted / acc.workers : 1;
}

/**
 * v2-3b per-state automation index: the worker-weighted average of each
 * sector's tech-driven `laborCostMultiplier` (1.0 = no automation tech, down
 * to `1 − TECH_LABOR_REDUCTION_CAP` at full automation). Deliberately a
 * SEPARATE accumulator from `WageIndexAccumulator` — `accumulateWageIndex`'s
 * exclusion of automation (it cuts headcount, not pay) is load-bearing for
 * v2-2/v2-3a's parity guarantees, so automation gets its own signal here
 * instead of folding into the wage one.
 */
export interface AutomationIndexAccumulator {
  /** Σ workers × laborCostMultiplier */
  weighted: number;
  /** Σ workers */
  workers: number;
}

export function makeAutomationIndexAccumulator(): AutomationIndexAccumulator {
  return { weighted: 0, workers: 0 };
}

export function accumulateAutomationIndex(
  acc: AutomationIndexAccumulator,
  workers: number,
  laborCostMultiplier: number
): void {
  const w = Math.max(0, workers);
  acc.weighted += w * laborCostMultiplier;
  acc.workers += w;
}

/** Worker-weighted average automation multiplier; 1.0 (no automation) when a state has no workers. */
export function resolveAutomationIndex(acc: AutomationIndexAccumulator): number {
  return acc.workers > 0 ? acc.weighted / acc.workers : 1;
}

/**
 * v2-2 income coupling (gated on labourSystemMode ≥ "macro"): a CHANGE in the
 * per-state `labourWageIndex` (not its level — `medianIncome` compounds a
 * growth rate every turn, so a level term would grow income forever) feeds a
 * one-time wage-growth impulse into `medianIncomeNode`. `delta` is supplied
 * by the caller as `wageIndex − prevWageIndex` (the corp turn captures the
 * prior value before overwriting it). Δ 0 or non-finite ⇒ 0 (parity).
 */
export const LABOUR_WAGE_PASSTHROUGH = 0.5;
export function labourWageIncomePassthrough(delta: number): number {
  if (!Number.isFinite(delta)) return 0;
  return delta * 100 * LABOUR_WAGE_PASSTHROUGH;
}

/**
 * v2-3a jobs coupling — wage half (gated on labourSystemMode ≥ "macro"): a
 * CHANGE in `labourWageIndex` also feeds a one-time labor-demand-elasticity
 * bump into `unemploymentNode` — paying workers more makes labor more
 * expensive, so (all else equal) fewer get hired. Same Δ-not-level reasoning
 * as `labourWageIncomePassthrough`: `unemploymentRate` is itself a value
 * series carried forward turn to turn (`prevSimBaseline`), so a LEVEL term
 * held constant would march it to its registry bound and pin there (no
 * mean-reversion mechanism counteracts a sustained additive offset there,
 * unlike the Okun term's gap-closure dynamic) — the Δ form is a one-time
 * bump that stops once the wage change stops happening. Explicitly capped
 * per turn (independent of the node's own registry bounds) per the design's
 * "most coupling-prone, needs explicit damping" call-out. This is the SAME
 * `economic.labourWageIndexDelta` signal v2-2 reads — wage Δ this turn
 * nudges medianIncome up and unemployment up together (the income/jobs
 * tension the design names), not two unrelated signals.
 */
export const LABOUR_UNEMPLOYMENT_WAGE_K = 1.5; // pp of unemployment per 1.0 index-point Δ
export const LABOUR_UNEMPLOYMENT_WAGE_CAP_PP = 1.5;
export function labourUnemploymentWagePressure(delta: number): number {
  if (!Number.isFinite(delta)) return 0;
  const pp = delta * LABOUR_UNEMPLOYMENT_WAGE_K;
  return Math.max(-LABOUR_UNEMPLOYMENT_WAGE_CAP_PP, Math.min(LABOUR_UNEMPLOYMENT_WAGE_CAP_PP, pp));
}

/**
 * v2-3b jobs coupling — automation half (gated on labourSystemMode ≥
 * "macro"): a CHANGE in the per-state `automationIndex` feeds its own
 * one-time bump into `unemploymentNode`, summed with the wage term above.
 * Sign is INVERTED relative to the wage term: the automation index is LOWER
 * when more automated (1.0 = none, down toward `1 − TECH_LABOR_REDUCTION_CAP`
 * at full automation), so a DROP in the index (delta < 0 — automation just
 * came online) should RAISE unemployment, not lower it.
 *
 * Coefficient is a deliberately independent knob from
 * `LABOUR_UNEMPLOYMENT_WAGE_K`, not a copy of it: automation is a one-sided
 * corp investment with no offsetting income benefit to workers (unlike a
 * wage hike, which trades some jobs for higher pay for those who keep
 * theirs — the v2-3a tension), and "fewer effective jobs" reads as a more
 * direct, structural headcount effect than the softer wage-elasticity story.
 * Calibrated against the per-tech unlock size (nodes.ts grants 0.05–0.1 pct
 * per node): typical single-tech deltas land well under the cap; only an
 * implausible single-turn jump from no automation to the
 * `TECH_LABOR_REDUCTION_CAP` ceiling would hit it.
 */
export const LABOUR_UNEMPLOYMENT_AUTOMATION_K = 2.5; // pp of unemployment per 1.0 index-point Δ
export const LABOUR_UNEMPLOYMENT_AUTOMATION_CAP_PP = 1.5;
export function labourUnemploymentAutomationPressure(delta: number): number {
  if (!Number.isFinite(delta) || delta === 0) return 0;
  const pp = -delta * LABOUR_UNEMPLOYMENT_AUTOMATION_K;
  return Math.max(
    -LABOUR_UNEMPLOYMENT_AUTOMATION_CAP_PP,
    Math.min(LABOUR_UNEMPLOYMENT_AUTOMATION_CAP_PP, pp)
  );
}

/**
 * v2 migration coupling (gated on labourSystemMode ≥ "macro"): a region whose
 * labour system has pushed wages above baseline attracts more migrants, below
 * baseline fewer. Bounded so it can only modulate the (v0) output-gap pull, not
 * dominate it. At the baseline index (1.0) the factor is exactly 1.0 (parity).
 */
export const LABOUR_MIGRATION_WAGE_K = 0.5;
export function labourMigrationWageFactor(wageIndex: number): number {
  const idx = Number.isFinite(wageIndex) ? wageIndex : 1;
  const f = 1 + (idx - 1) * LABOUR_MIGRATION_WAGE_K;
  return Math.max(0.7, Math.min(1.3, f));
}
