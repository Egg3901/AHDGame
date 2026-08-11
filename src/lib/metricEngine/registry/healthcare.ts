import { fundingResponse } from "../spendingChannel";
import type { EngineNodeContext, RegistryNode } from "../types";
import { LIFE_EXPECTANCY_MID, PREVENTABLE_MORTALITY_MID } from "@/lib/demographics/flows/mortality";

/**
 * Healthcare outcome nodes (spec P2b §4.2), LIVE via the generic phase wiring.
 * Cold-start is parity-preserving (P2a-proven: the seed governs the LEVEL, these
 * formulas govern the RESPONSE to spending/access/demand changes). Constants are
 * first-pass directional; the per-phase balance pass tunes magnitudes.
 *
 * Roots NOT animated (seedCurrent reads): uninsuredRate (coverage policy),
 * publicHealthPreparedness (policy root), slaintecareProgress (IE reform).
 * Elder DEMAND uses population.dependencyRatio — a real demographic-phase output
 * ((youth+senior)/working, ~0.4-0.9) — so no new provider is needed.
 *
 * The mortality loop: lifeExpectancy + preventableMortality feed the demographic
 * phase's healthcareMortalityModifier (real units — Task 0a). Damping: both are
 * heavily inertia-smoothed AND the modifier is clamped [0.7,1.4]; the loop's sim
 * test asserts convergence.
 */

// Per-capita healthcare spend at which the channel reaches half its max response.
//
// Recalibrated (ticket #826 item 14 follow-up, coordinated 6-category pass).
// The old value (1.5) was a toy-scale placeholder against REAL per-capita
// spend (spendingProvider sums federal-per-capita + state-per-capita in real
// dollars, typically hundreds to low-thousands) -- every US region sat at
// >99.9% of max response regardless of budget posture (confirmed live:
// physicianRate simBaseline pinned at 5.49-5.50/1k in WA/NY/TX/CA/MS alike),
// so healthcare bills barely moved outcomes at all.
//
// Real range (US), grounded in seed data:
//   - FY2023 federal healthcare budget ($1.7T, src/lib/seeds/reference/budgets.ts)
//     / US population (~334.9M) ~= $5,076/capita federal actual.
//   - Every healthcare-budgetCategory legislationType's withPerCapitaCosts()
//     range (src/lib/seeds/reference/legislationTypes.ts): federal bills
//     us_federal_healthcare_funding ($0-4,650) + us_drug_pricing_medicare
//     ($0-744) + us_medicaid ($0-1,300) + us_public_health ($0-124) sum to
//     $0-6,818/capita nationally-spread; state bills us_state_healthcare
//     ($0-2,480) + us_state_public_health ($0-186) sum to $0-2,666/capita
//     region-local. Combined achievable range via spendingProvider (federal +
//     state per-capita) is $0 (fully defunded) to $9,484 (fully maximized).
//   - Policy-default baseline (FY2023 defaults + moderate state posture) is
//     ~$5,798/capita, closely matching the $5,076/capita real-world figure
//     above (cross-validates the bill-cost scale).
//
// HEALTH_SPEND_HALF_SAT=4000 sits near the middle of the $0-9,484 achievable
// range (and below the ~$5,798 realistic baseline, leaving room to climb
// toward max): response at baseline ~= 59.2%, at max ~= 70.3% (11pp of real
// slope), vs. the old constant's ~99.97%/99.98% (0.01pp of slope) -- a
// meaningful, non-degenerate curve across the range a player can actually
// reach via healthcare legislation.
//
// KNOWN LIMITATION: this is a single GLOBAL constant shared across all
// countries, but per-capita costs in non-US per-country legislation seed
// files (e.g. src/lib/seeds/jp/jpLegislationTypes.ts) are in LOCAL CURRENCY
// UNITS with no USD normalization -- a half-sat tuned to USD-scale ranges may
// under/over-saturate other countries' healthcare channel. Out of scope for
// this pass; flag for a follow-up per-country/currency-normalized constant.
export const HEALTH_SPEND_HALF_SAT = 4000;

const spendResp = (ctx: EngineNodeContext): number =>
  fundingResponse(ctx.spending["healthcare"] ?? 0, HEALTH_SPEND_HALF_SAT, 100); // 0..100

export const physicianRateNode: RegistryNode = {
  id: "healthcare.physicianRate",
  categoryId: "healthcare",
  metricId: "physicianRate",
  kind: "derived",
  // Capacity stock — builds/erodes slowly with sustained funding (per 1k scale).
  inputs: [{ spending: "healthcare" }],
  bounds: [0, 20],
  inertia: 0.95,
  decimals: 2,
  compute: (ctx) => 1 + (spendResp(ctx) / 100) * 4.5, // 0 spend → 1/1k … saturating → ~5.5/1k
};

export const affordabilityIndexNode: RegistryNode = {
  id: "healthcare.affordabilityIndex",
  categoryId: "healthcare",
  metricId: "affordabilityIndex",
  kind: "derived",
  inputs: [{ spending: "healthcare" }, "healthcare.uninsuredRate", "economic.costOfLiving"],
  bounds: [0, 100],
  inertia: 0.8,
  decimals: 2, // 2dp: cabinet effects (≤0.05/turn) are reabsorbed at a coarser grain — bug #0800
  compute: (ctx) => {
    const uninsured = ctx.current["healthcare.uninsuredRate"] ?? 10; // seedCurrent, 0-25%
    const costOfLiving = ctx.current["economic.costOfLiving"] ?? 100; // index, 100 = avg
    return 60 + spendResp(ctx) * 0.3 - uninsured * 1.2 - (costOfLiving - 100) * 0.15;
  },
};

export const preventableMortalityNode: RegistryNode = {
  id: "healthcare.preventableMortality",
  categoryId: "healthcare",
  metricId: "preventableMortality",
  kind: "derived",
  // Per 100k; LOWER is better. Access (physicians, coverage) and preparedness
  // push it down; poverty (lagged — Social/economic tier not yet animated) up.
  inputs: [
    "healthcare.physicianRate",
    "healthcare.uninsuredRate",
    "healthcare.publicHealthPreparedness",
    { lagged: "economic.povertyRate" },
  ],
  bounds: [0, 1000],
  inertia: 0.85,
  decimals: 2, // 2dp: cabinet effects (≤0.05/turn) are reabsorbed at a coarser grain — bug #0800
  compute: (ctx) => {
    const physicians = ctx.current["healthcare.physicianRate"] ?? 2.5; // per 1k
    const uninsured = ctx.current["healthcare.uninsuredRate"] ?? 10; // %
    const preparedness = ctx.current["healthcare.publicHealthPreparedness"] ?? 50; // 0-100
    const poverty = ctx.prev["economic.povertyRate"] ?? 13; // lagged, %
    return (
      300 - (physicians - 2.5) * 40 + uninsured * 6 - (preparedness - 50) * 1.2 + (poverty - 13) * 8
    );
  },
};

export const lifeExpectancyNode: RegistryNode = {
  id: "healthcare.lifeExpectancy",
  categoryId: "healthcare",
  metricId: "lifeExpectancy",
  kind: "derived",
  // YEARS — slow-moving stock; the demographic mortality input.
  // Bounds must span every ERA, not just the modern Western slice. [70,85]
  // was a US-2019 assumption that evalNode applied every turn: after
  // metricDefinitions.minValue was widened 70→35, ahd_sim_preflightfx still
  // showed world-wide min LE exactly 70.0 (China 43, Nigeria ~50, Turkey 44–48
  // all snapped to 70; Sweden 72 survived). Match metricDefinitions [35,90].
  inputs: [
    "healthcare.physicianRate",
    "healthcare.preventableMortality",
    "healthcare.affordabilityIndex",
    { lagged: "environment.airQuality" },
    { lagged: "economic.povertyRate" },
  ],
  bounds: [35, 90],
  inertia: 0.92,
  // 2dp storage (P3c): the lagged airQuality term steps ~0.02 yr/turn — below
  // 1dp's half-grain, where policy-delta preservation reabsorbs every step
  // (the P2c rounding-plateau class) and the air→life edge dies.
  decimals: 2,
  compute: (ctx) => {
    const physicians = ctx.current["healthcare.physicianRate"] ?? 2.5;
    const preventable = ctx.current["healthcare.preventableMortality"] ?? PREVENTABLE_MORTALITY_MID; // per 100k
    const affordability = ctx.current["healthcare.affordabilityIndex"] ?? 50; // 0-100
    // AQI semantics: LOWER airQuality is better (THRESHOLDS best 8 / worst 80,
    // mid 44). The P2b first pass had the sign inverted (treated it as a
    // higher-is-better quality index) — harmless while the input was a static
    // seed read, fixed before P3c animates it.
    const airQuality = ctx.prev["environment.airQuality"] ?? 44; // lagged AQI
    const poverty = ctx.prev["economic.povertyRate"] ?? 13; // lagged, %
    return (
      LIFE_EXPECTANCY_MID +
      (physicians - 2.5) * 0.6 -
      (preventable - PREVENTABLE_MORTALITY_MID) * 0.012 +
      (affordability - 50) * 0.03 -
      // ~2.5 years across the full clean↔smog AQI span (≈50 points) — the
      // epidemiological ballpark; 0.02 was sub-grain (plateau) even at 2dp.
      (airQuality - 44) * 0.05 -
      (poverty - 13) * 0.08
    );
  },
};

export const mentalHealthAccessNode: RegistryNode = {
  id: "healthcare.mentalHealthAccess",
  categoryId: "healthcare",
  metricId: "mentalHealthAccess",
  kind: "derived",
  // Bounds must span every ERA. [5,95] floor snapped NG NORTH_WEST's authored
  // 3 up to 5 on turn 1. Match metricDefinitions [0,95].
  inputs: [{ spending: "healthcare" }, "healthcare.physicianRate"],
  bounds: [0, 95],
  inertia: 0.8,
  decimals: 2, // 2dp: cabinet effects (≤0.05/turn) are reabsorbed at a coarser grain — bug #0800
  compute: (ctx) => {
    const physicians = ctx.current["healthcare.physicianRate"] ?? 2.5;
    return 25 + spendResp(ctx) * 0.25 + (physicians - 2.5) * 4;
  },
};

export const elderCareQualityNode: RegistryNode = {
  id: "healthcare.elderCareQuality",
  categoryId: "healthcare",
  metricId: "elderCareQuality",
  kind: "derived",
  // Capacity (spend) vs elder DEMAND (dependency ratio, ~0.4-0.9).
  inputs: [{ spending: "healthcare" }, "population.dependencyRatio"],
  bounds: [0, 100],
  inertia: 0.85,
  decimals: 2, // 2dp: cabinet effects (≤0.05/turn) are reabsorbed at a coarser grain — bug #0800
  compute: (ctx) => {
    const dependency = ctx.current["population.dependencyRatio"] ?? 0.6;
    return 55 + spendResp(ctx) * 0.35 - (dependency - 0.6) * 60;
  },
};

export const nhsWaitingTimeNode: RegistryNode = {
  id: "healthcare.nhsWaitingTime",
  categoryId: "healthcare",
  metricId: "nhsWaitingTime",
  kind: "derived",
  // UK: weeks; LOWER is better. Capacity (spend) shortens; aging demand lengthens.
  inputs: [{ spending: "healthcare" }, "population.dependencyRatio"],
  bounds: [1, 52],
  inertia: 0.8,
  decimals: 1,
  compute: (ctx) => {
    const dependency = ctx.current["population.dependencyRatio"] ?? 0.6;
    return 22 - spendResp(ctx) * 0.18 + (dependency - 0.6) * 40;
  },
};

export const socialCareQualityNode: RegistryNode = {
  id: "healthcare.socialCareQuality",
  categoryId: "healthcare",
  metricId: "socialCareQuality",
  kind: "derived",
  // Bounds must span every ERA. [10,100] floor snapped NG NORTH_WEST's authored
  // 8 up to 10 on turn 1. Match metricDefinitions [0,100].
  inputs: [{ spending: "healthcare" }, "population.dependencyRatio"],
  bounds: [0, 100],
  inertia: 0.85,
  decimals: 1,
  compute: (ctx) => {
    const dependency = ctx.current["population.dependencyRatio"] ?? 0.6;
    return 50 + spendResp(ctx) * 0.35 - (dependency - 0.6) * 50;
  },
};

export const hseWaitingListMonthsNode: RegistryNode = {
  id: "healthcare.hseWaitingListMonths",
  categoryId: "healthcare",
  metricId: "hseWaitingListMonths",
  kind: "derived",
  // IE: months; LOWER is better. slaintecareProgress (reform root) also relieves.
  inputs: [
    { spending: "healthcare" },
    "population.dependencyRatio",
    "healthcare.slaintecareProgress",
  ],
  bounds: [0, 60],
  inertia: 0.8,
  decimals: 2, // 2dp: cabinet effects (≤0.05/turn) are reabsorbed at a coarser grain — bug #0800
  compute: (ctx) => {
    const dependency = ctx.current["population.dependencyRatio"] ?? 0.6;
    const slaintecare = ctx.current["healthcare.slaintecareProgress"] ?? 30; // reform root, 0-100
    return 16 - spendResp(ctx) * 0.1 + (dependency - 0.6) * 30 - (slaintecare - 30) * 0.08;
  },
};

/**
 * Healthcare derived nodes, registered in `METRIC_REGISTRY`. Topo within tier:
 * physicianRate → {preventableMortality, mentalHealthAccess};
 * {physicianRate, preventableMortality, affordabilityIndex} → lifeExpectancy.
 * Country-specific nodes (nhsWaitingTime UK, hse/slaintecare IE) are safe to
 * register globally — the persist gate only writes metrics a region stores.
 */
export const HEALTHCARE_NODES: RegistryNode[] = [
  physicianRateNode,
  affordabilityIndexNode,
  preventableMortalityNode,
  lifeExpectancyNode,
  mentalHealthAccessNode,
  elderCareQualityNode,
  nhsWaitingTimeNode,
  socialCareQualityNode,
  hseWaitingListMonthsNode,
];
