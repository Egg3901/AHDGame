import { fundingResponse } from "../spendingChannel";
import type { EngineNodeContext, RegistryNode } from "../types";

/**
 * Education outcome nodes (spec P2a §4.1), LIVE in `METRIC_REGISTRY` via the
 * generic phase wiring. Cold-start is parity-preserving by construction: with no
 * stored simBaseline, evalNode's fallbacks yield `value = storedValue` exactly
 * (no maxPolicyDelta cap), so going live does not move any metric at t0 — the
 * seed governs the LEVEL; these compute() formulas govern the DYNAMICS (how the
 * value responds to spending/poverty/upstream shifts). Constants are first-pass
 * directional; the per-phase balance pass tunes magnitudes.
 *
 * Drivers (design §4.1): `{spending:education}` via the diminishing-returns
 * channel; childPoverty as a LAGGED edge (live since P3a); socialCohesion and
 * medianIncome animated in P3d/P3a (their bare-string reads resolved into topo
 * edges on registration); academicPressure / apprenticeshipRate remain
 * seedCurrent roots.
 */

// Calibration anchors (per-metric, P2a parity will tune). `*_HALF_SAT` is the
// per-capita education spend at which the channel reaches half its max response.
//
// Recalibrated (ticket #826 item 14 / coordinated 6-category spend-response pass,
// 2026-07-01). The toy value of 1 meant fundingResponse saturated to ~99.9% of max
// at ANY realistic per-capita spend, so enacting an education bill barely moved
// highSchoolGradRate/testPerformance/etc -- confirmed live in production (WA
// testPerformance simBaseline 95.21 pre-fix) and confirmed analytically: with
// halfSat=1, fundingResponse($806, 1, 100) = 99.88%.
//
// Real per-capita range, grounded in the actual seed + legislation data:
//  - Baseline (today): US federal FY2023 baselineSpendingByCategory.education =
//    $270B / 334.9M population = $806.21/capita
//    (src/lib/seeds/reference/budgets.ts NATIONAL_BUDGET_SEED_CONFIGS_2023).
//  - Floor: $0 -- every education-budgetCategory bill has a full-defund/
//    "abolition" policy option.
//  - Ceiling: the engine's spending channel SUMS federal-per-capita (national
//    pop) + state-per-capita (region pop) (src/lib/metricEngine/spendingProvider.ts),
//    and ALL FIVE budgetCategory:"education" US legislationTypes stack additively
//    (src/lib/budget/spending.ts calculateFederalSpending/calculateStateSpending
//    sum every enacted law's annualCostPerCapita in a category). Maxing every
//    lever's top (`withPerCapitaCosts`) option in src/lib/seeds/reference/
//    legislationTypes.ts: us_federal_education_funding $1303 (national) +
//    us_federal_science_funding $1042 (national) + us_school_standards $261
//    (national) + us_state_education_funding $3040 (state) +
//    us_state_higher_education $869 (state) = $6515/capita theoretical max
//    (before the COST_SCALE_ANCHORS US era ramp, which can push this to ~$8274
//    at 2020s-era GDP/capita, scaleHigh=1.27).
//
// EDU_SPEND_HALF_SAT=1300 sits close to the single flagship lever's max cost
// ($1303, us_federal_education_funding) -- an intentional game-design anchor: a
// dedicated education administration that fully funds JUST that one bill reaches
// ~50% of max response. Response at today's $806 baseline: 38.28%. Response at
// the full $6515 five-bill stacked max: 83.37%. That's real, perceptible slope
// (0% -> 38% -> 50% -> 83%) across the whole realistic range instead of the old
// ~99.88%-to-99.98% near-total saturation.
export const EDU_SPEND_HALF_SAT = 1300;

const spendResp = (ctx: EngineNodeContext): number =>
  fundingResponse(ctx.spending["education"] ?? 0, EDU_SPEND_HALF_SAT, 100); // 0..100

export const highSchoolGradRateNode: RegistryNode = {
  id: "education.highSchoolGradRate",
  categoryId: "education",
  metricId: "highSchoolGradRate",
  kind: "derived",
  // socialCohesion went LIVE in P3d — the bare-string read is now a same-turn
  // topo edge (cohesion evaluates before the education tier).
  // Bounds must span every ERA. [55,98] was a Western secondary-school
  // assumption — evalNode snapped NG NORTH_EAST's authored 1 (and GR rural 6,
  // IE west 20, JP 45) up to 55 on turn 1 in ahd_sim_preflightfx while DE 60
  // survived. Match metricDefinitions [0,98].
  inputs: [{ spending: "education" }, { lagged: "social.childPoverty" }, "social.socialCohesion"],
  bounds: [0, 98],
  inertia: 0.8,
  decimals: 2, // 2dp: cabinet effects (≤0.05/turn) are reabsorbed at a coarser grain — bug #0800
  compute: (ctx) => {
    const childPoverty = ctx.prev["social.childPoverty"] ?? 18; // lagged, 0..100
    const cohesion = ctx.current["social.socialCohesion"] ?? 50; // seedCurrent
    return 70 + spendResp(ctx) * 0.4 - childPoverty * 0.5 + (cohesion - 50) * 0.1;
  },
};

export const literacyRateNode: RegistryNode = {
  id: "education.literacyRate",
  categoryId: "education",
  metricId: "literacyRate",
  kind: "derived",
  // High inertia: literacy is slow-moving (stock-like).
  // Bounds must span every ERA. [80,99] was a US-modern assumption — evalNode
  // snapped TR_IST's authored 55 (and CN down to ~22) up to 80 on turn 1 in
  // ahd_sim_preflightfx while SE 99 survived. Floor at 10 admits the 1953
  // band (TR east 15, CN ~22–38, TR_IST 55, SE/FI/AT ~99).
  inputs: ["education.highSchoolGradRate", { spending: "education" }],
  bounds: [10, 99],
  inertia: 0.92,
  decimals: 1,
  compute: (ctx) => {
    const gradRate = ctx.current["education.highSchoolGradRate"] ?? 88;
    return 82 + (gradRate - 88) * 0.25 + spendResp(ctx) * 0.08;
  },
};

export const testPerformanceNode: RegistryNode = {
  id: "education.testPerformance",
  categoryId: "education",
  metricId: "testPerformance",
  kind: "derived",
  // Index centered at 100 (national avg). academicPressure lifts scores (at a
  // mentalHealth cost modeled elsewhere); child poverty drags them.
  inputs: [
    { spending: "education" },
    { lagged: "social.childPoverty" },
    "education.academicPressure", // policy root → seedCurrent read
  ],
  bounds: [50, 150],
  inertia: 0.8,
  decimals: 2, // 2dp: cabinet effects (≤0.05/turn) are reabsorbed at a coarser grain — bug #0800
  compute: (ctx) => {
    const childPoverty = ctx.prev["social.childPoverty"] ?? 18;
    const academicPressure = ctx.current["education.academicPressure"] ?? 50; // seedCurrent
    return 90 + spendResp(ctx) * 0.25 - childPoverty * 0.6 + (academicPressure - 50) * 0.2;
  },
};

export const workforceSkillNode: RegistryNode = {
  id: "education.workforceSkill",
  categoryId: "education",
  metricId: "workforceSkill",
  kind: "derived",
  // The TFP hand-off (P2d consumes this). Skill = schooling outcomes + vocational
  // training (apprenticeshipRate, policy root via seedCurrent).
  inputs: [
    "education.highSchoolGradRate",
    "education.testPerformance",
    "education.apprenticeshipRate", // policy root → seedCurrent read
  ],
  bounds: [0, 100],
  inertia: 0.85,
  decimals: 2, // 2dp: cabinet effects (≤0.05/turn) are reabsorbed at a coarser grain — bug #0800
  compute: (ctx) => {
    const gradRate = ctx.current["education.highSchoolGradRate"] ?? 88;
    const testPerf = ctx.current["education.testPerformance"] ?? 100;
    const apprenticeship = ctx.current["education.apprenticeshipRate"] ?? 3; // seedCurrent, 0..8
    return (gradRate - 88) * 0.5 + (testPerf - 100) * 0.4 + apprenticeship * 3 + 50;
  },
};

export const gcseAttainmentNode: RegistryNode = {
  id: "education.gcseAttainment",
  categoryId: "education",
  metricId: "gcseAttainment",
  kind: "derived",
  inputs: [{ spending: "education" }, { lagged: "social.childPoverty" }],
  bounds: [20, 95],
  inertia: 0.8,
  decimals: 1,
  compute: (ctx) => {
    const childPoverty = ctx.prev["social.childPoverty"] ?? 18;
    return 60 + spendResp(ctx) * 0.3 - childPoverty * 0.6;
  },
};

export const universityEnrollmentNode: RegistryNode = {
  id: "education.universityEnrollment",
  categoryId: "education",
  metricId: "universityEnrollment",
  kind: "derived",
  // #909: the single higher-education enrolment metric (collegeEnrollment was
  // merged in). GCSE-driven where a country models GCSE attainment (UK/IE/JP/…);
  // HS-grad-driven in the US — the former collegeEnrollment model — so US states
  // keep their meaningful ~78 series instead of collapsing to the GCSE fallback.
  inputs: ["education.gcseAttainment", "education.highSchoolGradRate"],
  bounds: [0, 100],
  inertia: 0.8,
  // 2dp: inherited from the merged-in collegeEnrollment node — the US education
  // secretary's tier effects (±0.01–0.02/turn) are reabsorbed at a coarser
  // grain (bug #0800; regressed by the #909 merge which dropped the 2dp).
  decimals: 2,
  compute: (ctx) => {
    if (ctx.countryId === "US") {
      const gradRate = ctx.current["education.highSchoolGradRate"] ?? 88;
      // Anchor 55 (the former collegeEnrollment equilibrium) keeps the
      // downstream socialMobility center (55) at zero deviation.
      return (gradRate - 88) * 0.8 + 55;
    }
    const attainment = ctx.current["education.gcseAttainment"] ?? 60;
    return (attainment - 60) * 0.7 + 40;
  },
};

/**
 * Education derived nodes, registered in `METRIC_REGISTRY` (registry/index.ts).
 * Topo order within the tier: gradRate → literacy; testPerf + gradRate →
 * workforceSkill; {gcseAttainment, gradRate} → universityEnrollment (#909).
 */
export const EDUCATION_NODES: RegistryNode[] = [
  highSchoolGradRateNode,
  literacyRateNode,
  testPerformanceNode,
  workforceSkillNode,
  gcseAttainmentNode,
  universityEnrollmentNode,
];
