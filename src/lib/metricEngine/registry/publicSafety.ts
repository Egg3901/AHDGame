import { fundingResponse } from "../spendingChannel";
import { SOCIAL_SPEND_HALF_SAT } from "./social";
import type { EngineNodeContext, RegistryNode } from "../types";

/**
 * Public-safety tier (P3b) — closes the poverty↔crime two-way LAGGED cycle:
 * povertyRate already reads {lagged: publicSafety.crimeRate}; crimeRate here
 * reads {lagged: economic.povertyRate}. Both directions cross turns, so the
 * registry stays acyclic within a turn and the loop is damped by inertia
 * (the sim test proves convergence).
 *
 * Reference anchors (all computes return the anchor at this state): crime 4500,
 * poverty 13, unemployment 5, gradRate 88, police 2.5/1k, gini 42, violent 250,
 * incarceration 450, recidivism 43, confidence 58. Constants are first-pass
 * directional — the standing balance pass owns magnitudes.
 */

/**
 * Per-capita publicSafety spend at which the channel reaches half its max
 * response. Calibrated against the real achievable per-capita range (spend-
 * response recalibration pass, ticket #826 item 14 follow-up): summing the
 * four US publicSafety-tagged legislationTypes' policyOption per-capita costs
 * (federal us_law_enforcement_criminal_justice + us_prison_rehabilitation,
 * state us_state_policing + us_state_prison_rehabilitation — spendingProvider.ts
 * sums federal-per-capita + state-per-capita into this one channel) gives
 * MIN $418/capita (cheapest option on all four bills) .. MAX $1935/capita
 * (priciest option on all four), with a "center"/moderate-stance default
 * around $829/capita. The old HALF_SAT=1 saturated the channel to ~99.9%
 * response across that entire range (confirmed live in prod: NY/CA
 * policePerCapita.simBaseline=4.36, ~96% of its ~4.5 max, at ordinary enacted
 * spend) — a policy bill moving spend within its real range barely moved the
 * response at all. HALF_SAT=900 sits near the geometric mean of the range
 * (sqrt(418*1935)≈899) and close to the $829 center default, giving ~32%
 * response at the cheap end, ~48% at the moderate center, and ~68% at the
 * expensive end — real slope across the whole playable range instead of a
 * flat ~100% line.
 */
export const PS_SPEND_HALF_SAT = 900;

const spendResp = (ctx: EngineNodeContext): number =>
  fundingResponse(ctx.spending["publicSafety"] ?? 0, PS_SPEND_HALF_SAT, 100); // 0..100

export const policePerCapitaNode: RegistryNode = {
  id: "publicSafety.policePerCapita",
  categoryId: "publicSafety",
  metricId: "policePerCapita",
  kind: "derived",
  // Capacity stock (officers per 1k residents) — builds/erodes slowly with
  // sustained funding (the P2b physicianRate pattern).
  inputs: [{ spending: "publicSafety" }],
  bounds: [0, 20],
  inertia: 0.95,
  decimals: 2,
  compute: (ctx) => 1 + (spendResp(ctx) / 100) * 3.5, // 0 spend → 1/1k … saturating → ~4.5/1k
};

export const crimeRateNode: RegistryNode = {
  id: "publicSafety.crimeRate",
  categoryId: "publicSafety",
  metricId: "crimeRate",
  kind: "derived",
  // Per 100k. Poverty and unemployment are LAGGED (poverty itself reads lagged
  // crime — the two-way cycle stays acyclic within a turn); schooling, police
  // capacity, and inequality are same-turn engine edges.
  inputs: [
    { lagged: "economic.povertyRate" },
    { lagged: "economic.unemploymentRate" },
    "education.highSchoolGradRate",
    "publicSafety.policePerCapita",
    "social.incomeInequality",
  ],
  bounds: [0, 15000],
  inertia: 0.92,
  decimals: 2, // 2dp: cabinet effects (≤0.05/turn) are reabsorbed at a coarser grain — bug #0800
  compute: (ctx) => {
    const povLag = ctx.prev["economic.povertyRate"] ?? 13;
    const unempLag = ctx.prev["economic.unemploymentRate"] ?? 5;
    const grad = ctx.current["education.highSchoolGradRate"] ?? 88;
    const police = ctx.current["publicSafety.policePerCapita"] ?? 2.5;
    const gini = ctx.current["social.incomeInequality"] ?? 42; // Gini-100
    return (
      4500 +
      (povLag - 13) * 180 +
      (unempLag - 5) * 120 -
      (grad - 88) * 40 -
      // #887: police→crime channel trimmed 400→200. Policing LAWS now carry a
      // direct crimeRate stance effect (CRIME_TICK_RATES_7); halving the funding
      // channel's sensitivity keeps the two from double-counting while leaving
      // the baseline at the reference police level (2.5) unchanged.
      (police - 2.5) * 200 +
      (gini - 42) * 35
    );
  },
};

export const violentCrimeRateNode: RegistryNode = {
  id: "publicSafety.violentCrimeRate",
  categoryId: "publicSafety",
  metricId: "violentCrimeRate",
  kind: "derived",
  inputs: ["publicSafety.crimeRate"],
  bounds: [0, 3000],
  inertia: 0.9,
  decimals: 2, // 2dp: cabinet effects (≤0.05/turn) are reabsorbed at a coarser grain — bug #0800
  // Violent share of overall crime: crime 1500 → ~52, 11000 → ~679
  // (THRESHOLDS [80, 700]).
  compute: (ctx) => 250 + ((ctx.current["publicSafety.crimeRate"] ?? 4500) - 4500) * 0.066,
};

export const incarcerationRateNode: RegistryNode = {
  id: "publicSafety.incarcerationRate",
  categoryId: "publicSafety",
  metricId: "incarcerationRate",
  kind: "derived",
  // Prison populations track crime with a long lag; sentencing POLICY moves the
  // rest via coexistence deltas from justice laws (kept by the §4.7 sweep).
  // Bounds must span every ERA. Ceiling 1200 still truncated RU 1953 gulag-era
  // rates (CEN 1400, FEA 2600). Match metricDefinitions [0,3000].
  inputs: [{ lagged: "publicSafety.crimeRate" }],
  bounds: [0, 3000],
  inertia: 0.96,
  decimals: 2, // 2dp: cabinet effects (≤0.05/turn) are reabsorbed at a coarser grain — bug #0800
  compute: (ctx) => 450 + ((ctx.prev["publicSafety.crimeRate"] ?? 4500) - 4500) * 0.05,
};

export const recidivismRateNode: RegistryNode = {
  id: "publicSafety.recidivismRate",
  categoryId: "publicSafety",
  metricId: "recidivismRate",
  kind: "derived",
  // Reoffending: prison churn (+), reintegration prospects — jobs (−) and
  // social-program support (− via the social channel).
  inputs: ["publicSafety.incarcerationRate", "economic.unemploymentRate", { spending: "social" }],
  bounds: [0, 100],
  inertia: 0.9,
  decimals: 2, // 2dp: cabinet effects (≤0.05/turn) are reabsorbed at a coarser grain — bug #0800
  compute: (ctx) => {
    const incarc = ctx.current["publicSafety.incarcerationRate"] ?? 450;
    const unemp = ctx.current["economic.unemploymentRate"] ?? 5;
    const socialResp = fundingResponse(ctx.spending["social"] ?? 0, SOCIAL_SPEND_HALF_SAT, 100);
    return 43 + (incarc - 450) * 0.02 + (unemp - 5) * 0.8 - socialResp * 0.06;
  },
};

export const publicSafetyConfidenceNode: RegistryNode = {
  id: "publicSafety.publicSafetyConfidence",
  categoryId: "publicSafety",
  metricId: "publicSafetyConfidence",
  kind: "derived",
  inputs: ["publicSafety.crimeRate", "publicSafety.policePerCapita"],
  bounds: [0, 100],
  inertia: 0.85,
  decimals: 2, // 2dp: cabinet effects (≤0.05/turn) are reabsorbed at a coarser grain — bug #0800
  compute: (ctx) => {
    const crime = ctx.current["publicSafety.crimeRate"] ?? 4500;
    const police = ctx.current["publicSafety.policePerCapita"] ?? 2.5;
    return 58 - (crime - 4500) * 0.004 + (police - 2.5) * 4;
  },
};

// UK-origin metrics (uniform-seeded across countries via uniformStateMetrics;
// the persist gate scopes them to docs that actually store them).
export const antiSocialBehaviourRateNode: RegistryNode = {
  id: "publicSafety.antiSocialBehaviourRate",
  categoryId: "publicSafety",
  metricId: "antiSocialBehaviourRate",
  kind: "derived",
  // Aligned with the uniform-seed derivation (crime/800) + a youth-poverty term.
  inputs: ["publicSafety.crimeRate", { lagged: "economic.povertyRate" }],
  bounds: [0, 20],
  inertia: 0.85,
  decimals: 2,
  compute: (ctx) =>
    (ctx.current["publicSafety.crimeRate"] ?? 4500) / 800 +
    ((ctx.prev["economic.povertyRate"] ?? 13) - 13) * 0.15,
};

export const knifeCrimeRateNode: RegistryNode = {
  id: "publicSafety.knifeCrimeRate",
  categoryId: "publicSafety",
  metricId: "knifeCrimeRate",
  kind: "derived",
  // Aligned with the uniform-seed derivation (violentCrime/100).
  inputs: ["publicSafety.violentCrimeRate"],
  bounds: [0, 10],
  inertia: 0.85,
  decimals: 2,
  compute: (ctx) => (ctx.current["publicSafety.violentCrimeRate"] ?? 250) / 100,
};

/** Public-safety tier nodes (P3b). */
export const PUBLIC_SAFETY_NODES: RegistryNode[] = [
  policePerCapitaNode,
  crimeRateNode,
  violentCrimeRateNode,
  incarcerationRateNode,
  recidivismRateNode,
  publicSafetyConfidenceNode,
  antiSocialBehaviourRateNode,
  knifeCrimeRateNode,
];
