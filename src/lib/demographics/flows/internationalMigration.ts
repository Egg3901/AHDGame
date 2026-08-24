import type { AgeSexVector } from "../cohortVector";

const MIGRANT_PEAK = 27; // young-adult migration peak (22-32 band)
const MIGRANT_SIGMA = 7;

/**
 * Economic pull on international migration intake.
 *
 * v0 balance fix (2026-06-30): the growth term reads the region's OUTPUT GAP
 * (gdpGrowth − its own potential), NOT absolute growth vs a fixed 2.5% neutral.
 * The old fixed anchor split regions into permanent boom/doom basins at the 2.5%
 * line — a demographically weak region settles at gdpGrowth = potential below
 * 2.5%, so it perpetually shed population, lowering potential further (no interior
 * equilibrium; see docs/plans/2026-06-30-macro-balance-v0.md). Against each
 * region's OWN potential, a region growing at potential is migration-neutral
 * (pull = 1); only genuinely hot (above potential) or depressed (below potential)
 * regions move people. ADDITIVE to the national total; clamp reached only at
 * extremes. Unemployment term unchanged (still vs a fixed neutral).
 */
// Fallback for missing gdpGrowth/potential — NOT the migration-neutral anchor
// anymore (the pull's neutral point is each region's OWN potential). When both
// fall back to this, the output gap is 0 → pull 1 (parity).
const DEFAULT_GROWTH = 2.5; // %/yr
const UNEMP_NEUTRAL = 5; // % — neutral unemployment (the unemployment term is still vs a fixed neutral)
const K_GDP = 0.06; // pull per pt of output gap (gdpGrowth − potential)
const K_UNEMP = 0.04; // repulsion per pt of unemployment above neutral
const PULL_MIN = 0.5;
const PULL_MAX = 1.5;

export interface RegionEconomy {
  gdpGrowth: number; // %/yr
  unemployment: number; // %
  potential: number; // %/yr — the region's own potential growth (output-gap neutral)
}

/** Neutral-economy defaults — use for missing metrics so the pull is exactly 1.0 (parity). */
export const ECON_PULL_NEUTRAL: RegionEconomy = {
  gdpGrowth: DEFAULT_GROWTH,
  unemployment: UNEMP_NEUTRAL,
  potential: DEFAULT_GROWTH,
};

/**
 * Policy-gated economic multiplier in [0.5, 1.5]; 1.0 when a region grows at its
 * own potential with neutral unemployment.
 */
export function economicPullFactor(econ: RegionEconomy): number {
  const score =
    K_GDP * (econ.gdpGrowth - econ.potential) - K_UNEMP * (econ.unemployment - UNEMP_NEUTRAL);
  return Math.max(PULL_MIN, Math.min(PULL_MAX, 1 + score));
}

/**
 * Apply the economic pull to a region's policy-set net migration, sign-aware so a
 * stronger economy always shifts net migration toward "more positive":
 *   immigration (base ≥ 0): base × pull            (strong → more in)
 *   emigration  (base < 0):  base × (2 − pull)      (weak → MORE out, strong → fewer out)
 * A closed border (base 0) stays 0 — policy remains the master gate.
 */
export function applyEconomicPull(base: number, pull: number): number {
  return base >= 0 ? base * pull : base * (2 - pull);
}

/** Maximum annual migration-rate bonus from an undersupplied labour market. */
export const LABOUR_SHORTAGE_MIGRATION_MAX_PCT = 0.5;

/**
 * Extra annual migration pull from jobs that cannot be filled locally.
 * Relative wages modulate the signal, while the normal regional and world
 * migration caps remain the final circuit breakers.
 */
export function labourShortageMigrationBonusPct(
  tightness: number | undefined | null,
  wageIndex: number | undefined | null
): number {
  if (typeof tightness !== "number" || !Number.isFinite(tightness) || tightness <= 1) return 0;
  const wage =
    typeof wageIndex === "number" && Number.isFinite(wageIndex)
      ? Math.max(0.5, Math.min(1.5, wageIndex))
      : 1;
  return Math.min(LABOUR_SHORTAGE_MIGRATION_MAX_PCT, (1 - 1 / tightness) * 0.4 * wage);
}

// ── Conservation + caps (design 2026-06-16) ────────────────────────────────
// The cohort flow consumes per-region `migrationRate` as a literal annual net %
// and adds it to the national headcount with no global renormalization. Two
// safeguards keep world population from inflating regardless of the inputs:
//   1. a per-region hard cap on |net| (a single region can't balloon), and
//   2. a global bound on the modeled bloc's NET inflow from the unmodeled
//      rest-of-world (positive nets scale down if the bloc would net more than
//      a realistic share of its own population per year).

/** Per-region |net international migration| ceiling, %/yr of region population. */
export const MAX_NET_MIGRATION_PCT_PER_YEAR = 1.5;

/** The modeled bloc may net at most this much immigration from the unmodeled ROW, %/yr. */
export const WORLD_NET_MIGRATION_PCT_PER_YEAR = 0.3;

/** Clamp a per-turn net-migration figure to ±MAX_NET_MIGRATION_PCT_PER_YEAR of the region pop. */
export function capNetMigrants(net: number, pop: number, turnsPerYear: number): number {
  if (!(pop > 0) || !(turnsPerYear > 0)) return 0;
  const cap = ((MAX_NET_MIGRATION_PCT_PER_YEAR / 100) * pop) / turnsPerYear;
  return Math.max(-cap, Math.min(cap, net));
}

/**
 * Scale factor applied to POSITIVE per-region nets so the modeled bloc's net inflow
 * stays within WORLD_NET_MIGRATION_PCT_PER_YEAR of its total population per year.
 * Outflows (negative nets) are never scaled. Returns 1 when the bloc is within bound
 * or net-emigrating, so a net-emigrating world is untouched.
 */
export function worldMigrationScale(
  perRegionNets: number[],
  totalPop: number,
  turnsPerYear: number
): number {
  if (!(totalPop > 0) || !(turnsPerYear > 0)) return 1;
  const worldPositive = perRegionNets.reduce((s, n) => s + Math.max(0, n), 0);
  if (worldPositive <= 0) return 1;
  const worldCap = ((WORLD_NET_MIGRATION_PCT_PER_YEAR / 100) * totalPop) / turnsPerYear;
  return worldPositive > worldCap ? worldCap / worldPositive : 1;
}

/**
 * Normalized migrant age×sex profile (design §4.2): peaks in the young-adult band,
 * `shareMale` skews the sex split (labor corridors male-heavy ~0.6-0.7; family
 * reunification ~0.5). Σ over all cells = 1. International net migration is
 * distributed by this profile, so it also shifts `medianAge` and `sexRatio`.
 */
export function migrantAgeSexProfile(shareMale: number): AgeSexVector {
  const sm = Math.max(0, Math.min(1, shareMale));
  const ageWeights: number[] = [];
  for (let a = 0; a <= 100; a++) {
    ageWeights.push(Math.exp(-0.5 * ((a - MIGRANT_PEAK) / MIGRANT_SIGMA) ** 2));
  }
  const ageSum = ageWeights.reduce((x, y) => x + y, 0);
  const male = ageWeights.map((w) => (w / ageSum) * sm);
  const female = ageWeights.map((w) => (w / ageSum) * (1 - sm));
  return { male, female };
}

/**
 * Apply one turn of international NET migration (national total may be negative
 * = net emigration). Distributed by `profile`. International net is allowed to
 * change the national headcount (§6.1). Out-migration is clamped per-cell at the
 * cell population (local non-negativity) — NO cross-region redistribution here
 * (that is internal migration, P1b-2). Returns the new vector + the net actually
 * applied (its magnitude may be smaller than requested if cells clamp).
 */
export function applyInternationalMigration(
  vector: AgeSexVector,
  netMigrants: number,
  profile: AgeSexVector
): { vector: AgeSexVector; applied: number } {
  const out: AgeSexVector = { male: vector.male.slice(), female: vector.female.slice() };
  let applied = 0;
  for (const sex of ["male", "female"] as const) {
    for (let a = 0; a <= 100; a++) {
      const delta = netMigrants * (profile[sex][a] ?? 0);
      const pop = out[sex][a];
      const clamped = delta < 0 ? Math.max(delta, -pop) : delta; // never below 0
      out[sex][a] = pop + clamped;
      applied += clamped;
    }
  }
  return { vector: out, applied };
}
