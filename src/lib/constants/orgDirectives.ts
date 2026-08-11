/**
 * Curated catalog of organization **directives** — standing, bloc-wide policy
 * measures an (economic) organization may pass that nudge a single curated
 * metric across every member state while active.
 *
 * Design constraints (Phase 2A-ii):
 * - **Curated allow-list, not free-form.** A directive may only target one of
 *   these reviewed metrics with the fixed, server-controlled delta below — the
 *   proposer picks a catalog entry by `key`; the magnitude is never client-set.
 * - **Bounded deltas, below the economic-model synergy scale.** A held economic
 *   model nudges its synergy metrics by 6–10 in exchange for a deep, single-
 *   model commitment; a directive applies to all members with no such trade-off,
 *   so its deltas are deliberately smaller.
 * - **Node-backed metrics only.** Each `metricId` must be a registry node's bare
 *   metricId; the metric turn driver resolves it to a node id and adds the delta
 *   to that node's TARGET (smoothed through coexistence, not hard-set), exactly
 *   like `synergyNudges`. Root-only metrics receive no nudge, so they are absent.
 */

export interface DirectiveDef {
  /** Stable key stored on the resolution (`directiveKey`). */
  key: string;
  /** Human-facing directive name. */
  label: string;
  /** Bare registry metricId the directive nudges (resolved to a node id). */
  metricId: string;
  /** Signed, bounded target nudge applied to every member while active. */
  delta: number;
  /** One-line description of the bloc policy + its effect direction. */
  blurb: string;
}

/**
 * The directive menu. All five target node-backed metrics (verified against the
 * metric registry) with bounded deltas calibrated to each node's scale and the
 * "good direction":
 * - economic.productivityGrowth [-3, 6], higher better  → +0.5
 * - economic.costOfLiving       [40, 200], lower better → −2
 * - social.incomeInequality     [15, 70],  lower better → −2
 * - social.socialCohesion       [0, 100],  higher better → +2
 * - environment.carbonEmissions [0, 60],   lower better → −1.5
 */
export const DIRECTIVE_CATALOG: DirectiveDef[] = [
  {
    key: "productivity_compact",
    label: "Productivity Compact",
    metricId: "productivityGrowth",
    delta: 0.5,
    blurb: "Coordinated investment and standards lift member productivity growth.",
  },
  {
    key: "price_stability_pact",
    label: "Price Stability Pact",
    metricId: "costOfLiving",
    delta: -2,
    blurb: "Common-market competition and supply coordination ease the cost of living.",
  },
  {
    key: "cohesion_funds",
    label: "Cohesion & Convergence Funds",
    metricId: "incomeInequality",
    delta: -2,
    blurb: "Convergence transfers across the bloc compress income inequality.",
  },
  {
    key: "solidarity_framework",
    label: "Solidarity Framework",
    metricId: "socialCohesion",
    delta: 2,
    blurb: "Shared institutions and mobility strengthen social cohesion.",
  },
  {
    key: "green_transition",
    label: "Green Transition Directive",
    metricId: "carbonEmissions",
    delta: -1.5,
    blurb: "Bloc-wide emissions standards cut carbon emissions per capita.",
  },
];

const DIRECTIVE_BY_KEY = new Map<string, DirectiveDef>(DIRECTIVE_CATALOG.map((d) => [d.key, d]));

/** Look up a directive definition by its stored key, or undefined if unknown. */
export function getDirectiveDef(key: string | undefined): DirectiveDef | undefined {
  return key == null ? undefined : DIRECTIVE_BY_KEY.get(key);
}

/** True if `key` names a known directive in the catalog. */
export function isDirectiveKey(key: string): boolean {
  return DIRECTIVE_BY_KEY.has(key);
}

/**
 * Turns a directive stays active before it auto-expires (96 turns ≈ 2 in-game
 * years). A standing bloc policy lasts longer than the 48-turn sanctions term;
 * members re-affirm it with a fresh vote. On expiry the metric nudge simply
 * stops being read and the engine smooths the metric back — no cleanup write.
 */
export const DIRECTIVE_DURATION_TURNS = 96;
