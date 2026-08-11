import { fundingResponse } from "../spendingChannel";
import { SOCIAL_SPEND_HALF_SAT } from "./social";
import type { EngineNodeContext, RegistryNode } from "../types";

/**
 * Governance core (P4b) — the legitimacy half. publicTrust closes the approval
 * feedback loop: it reads the sitting government's stored national approval
 * (LAST turn's snapshot via the governmentApproval provider) and itself feeds
 * the approval basket next turn — a damped cross-turn cycle (sim-proven, like
 * poverty↔crime). governmentTransparency stays a policy ROOT; all
 * country-specific governance metrics stay roots until P5. budgetBalance,
 * debtToGdp, and schuldenbremseHeadroom are 📊 budget-synced: they leave the
 * static-root regime and mirror the real federalBudget ratios each turn via the
 * fiscalRatios provider + fiscalMirror (phase.ts), NOT registry nodes.
 *
 * Reference anchors: approval 45, transparency 55, gini 42, corruption 40,
 * unemp 5, newsTrust 50, publicTrust 50. First-pass coefficients.
 */

const NEUTRAL_APPROVAL = 45;

function approvalOf(ctx: EngineNodeContext): number {
  const v = ctx.providers["governmentApproval"];
  return typeof v === "number" && Number.isFinite(v) ? v : NEUTRAL_APPROVAL;
}

export const corruptionIndexNode: RegistryNode = {
  id: "governance.corruptionIndex",
  categoryId: "governance",
  metricId: "corruptionIndex",
  kind: "derived",
  // LOWER is better. Transparency institutions suppress it; inequality is the
  // elite-capture term. Anti-corruption laws act via coexistence deltas.
  inputs: ["governance.governmentTransparency", "social.incomeInequality"],
  bounds: [0, 100],
  inertia: 0.92,
  decimals: 2, // 2dp: cabinet effects (≤0.05/turn) are reabsorbed at a coarser grain — bug #0800
  compute: (ctx) => {
    const transparency = ctx.current["governance.governmentTransparency"] ?? 55; // root
    const gini = ctx.current["social.incomeInequality"] ?? 42;
    return 40 - (transparency - 55) * 0.5 + (gini - 42) * 0.2;
  },
};

export const publicTrustNode: RegistryNode = {
  id: "governance.publicTrust",
  categoryId: "governance",
  metricId: "publicTrust",
  kind: "derived",
  inputs: [
    { provider: "governmentApproval" },
    "economic.unemploymentRate",
    "governance.corruptionIndex",
    "mediaInformation.newsTrust",
  ],
  bounds: [0, 100],
  inertia: 0.9,
  // 2dp storage: small approval shifts step below a 1dp half-grain (the P2c
  // rounding-plateau class) and the loop's response would be reabsorbed.
  decimals: 2,
  compute: (ctx) => {
    const unemployment = ctx.current["economic.unemploymentRate"] ?? 5;
    const corruption = ctx.current["governance.corruptionIndex"] ?? 40;
    const newsTrust = ctx.current["mediaInformation.newsTrust"] ?? 50;
    return (
      50 +
      (approvalOf(ctx) - 45) * 0.3 -
      (unemployment - 5) * 1 -
      (corruption - 40) * 0.25 +
      (newsTrust - 50) * 0.15
    );
  },
};

// ── P5 — country-specific indices ───────────────────────────────────────────
// Animated where the drivers are now live (publicTrust, dependencyRatio,
// migrationRate, the channels). Pure 🔧 roots (partyDiscipline, socialCredit,
// taiwanStrait, euCohesion, coDetermination, hukou, …) stay policy-driven; the
// 📊 budget sync (schuldenbremseHeadroom) mirrors the real federalBudget ratio
// (see fiscalMirror); futureIrelandFundBalance was removed (anachronistic — FIF
// est. 2024, after both start dates). The persist gate scopes every node to docs
// that store the metric. First-pass coefficients (balance pass).

/** Per-capita defense spend at which the channel reaches half its max response. */
export const DEF_SPEND_HALF_SAT = 2;

// UK-origin, uniform-seeded broadly.
export const devolutionSatisfactionNode: RegistryNode = {
  id: "governance.devolutionSatisfaction",
  categoryId: "governance",
  metricId: "devolutionSatisfaction",
  kind: "derived",
  // Aligned with the uniform-seed derivation: regional buy-in tracks trust in
  // government; devolution acts move it via coexistence deltas.
  inputs: ["governance.publicTrust"],
  bounds: [0, 100],
  inertia: 0.9,
  decimals: 2, // 2dp: cabinet effects (≤0.05/turn) are reabsorbed at a coarser grain — bug #0800
  compute: (ctx) => ctx.current["governance.publicTrust"] ?? 50,
};

// NOTE: `governance.independenceDesire` is intentionally NOT a metric-engine node.
// The UK SCO/WAL/NIR First Minister "Independence/Reunification Desire" is owned
// solely by the dedicated per-turn drift engine
// (src/lib/turn/independenceDesireDrift.ts), which carries the policy / approval /
// inflation / mean-reversion drivers and the Devolution-tab UI. A metric-engine node
// here previously co-wrote the same field and re-rounded it to 1 decimal every turn,
// cancelling the drift engine's sub-0.1 increments and freezing the value (a
// metastable fixed point at X.95). See docs/design/uk-independence-desire-ownership-fix.md.

// IE seeds 42 (RoI rows) – 58.
export const unityReferendumSupportNode: RegistryNode = {
  id: "governance.unityReferendumSupport",
  categoryId: "governance",
  metricId: "unityReferendumSupport",
  kind: "derived",
  // LOWER is better per the defs (a destabilization gauge): hardship feeds the
  // appetite for constitutional upheaval, cohesion calms it.
  inputs: ["economic.unemploymentRate", "social.socialCohesion"],
  bounds: [0, 100],
  inertia: 0.93,
  decimals: 1,
  compute: (ctx) => {
    const unemployment = ctx.current["economic.unemploymentRate"] ?? 5;
    const cohesion = ctx.current["social.socialCohesion"] ?? 52;
    return 45 + (unemployment - 5) * 1 - (cohesion - 52) * 0.3;
  },
};

// DE seed 65.
export const rentenStabilitaetNode: RegistryNode = {
  id: "governance.rentenStabilitaet",
  categoryId: "governance",
  metricId: "rentenStabilitaet",
  kind: "derived",
  // Pension stability vs the LIVE demographic dependency ratio (P1 engine);
  // the social channel's socialSecurity alias carries pension spend.
  inputs: ["population.dependencyRatio", { spending: "social" }],
  bounds: [0, 100],
  inertia: 0.92,
  decimals: 1,
  compute: (ctx) => {
    const dependency = ctx.current["population.dependencyRatio"] ?? 0.6; // ratio, ~0.4-0.9
    const socialResp = fundingResponse(ctx.spending["social"] ?? 0, SOCIAL_SPEND_HALF_SAT, 100);
    // Center 0.6 matches the healthcare tier's dependencyRatio center AND makes
    // this compute hit the DE renten seed (65) at the typical dependency.
    return 65 - (dependency - 0.6) * 120 + socialResp * 0.08;
  },
};

// P6a axis metric (approval-excluded until the P6d cutover) — the UNIVERSAL
// defense-capacity stock; bundeswehrReadiness is its DE-flavored tracker
// (the bbcTrust reconciliation pattern — no double-author).
export const militaryReadinessNode: RegistryNode = {
  id: "governance.militaryReadiness",
  categoryId: "governance",
  metricId: "militaryReadiness",
  kind: "derived",
  inputs: [{ spending: "defense" }],
  bounds: [0, 100],
  inertia: 0.95,
  decimals: 1,
  compute: (ctx) =>
    30 + fundingResponse(ctx.spending["defense"] ?? 0, DEF_SPEND_HALF_SAT, 100) * 0.45,
};

// DE seed 55 — tracks the universal militaryReadiness (P6a reconcile).
export const bundeswehrReadinessNode: RegistryNode = {
  id: "governance.bundeswehrReadiness",
  categoryId: "governance",
  metricId: "bundeswehrReadiness",
  kind: "derived",
  inputs: ["governance.militaryReadiness"],
  bounds: [0, 100],
  inertia: 0.95,
  decimals: 1,
  compute: (ctx) => ctx.current["governance.militaryReadiness"] ?? 50,
};

// P6a axis metric (approval-excluded): the libertarian scoreboard anchor.
export const civilLibertiesNode: RegistryNode = {
  id: "governance.civilLiberties",
  categoryId: "governance",
  metricId: "civilLiberties",
  kind: "derived",
  // Surveillance/state-media (roots) and mass incarceration erode liberties;
  // press freedom underwrites them. socialCreditCoverage is CN-scoped (the ??
  // neutral keeps other countries unaffected).
  inputs: [
    "mediaInformation.pressFreedom",
    "mediaInformation.stateMediaControl",
    "publicSafety.incarcerationRate",
    "governance.socialCreditCoverage",
  ],
  bounds: [0, 100],
  inertia: 0.9,
  decimals: 1,
  compute: (ctx) => {
    const press = ctx.current["mediaInformation.pressFreedom"] ?? 69;
    const stateMedia = ctx.current["mediaInformation.stateMediaControl"] ?? 30;
    const incarceration = ctx.current["publicSafety.incarcerationRate"] ?? 450;
    const socialCredit = ctx.current["governance.socialCreditCoverage"] ?? 10;
    return (
      50 +
      (press - 69) * 0.35 -
      (stateMedia - 30) * 0.3 -
      (incarceration - 450) * 0.015 -
      (socialCredit - 10) * 0.1
    );
  },
};

// P6a axis metric (approval-excluded): the authoritarian scoreboard anchor.
export const nationalPrideNode: RegistryNode = {
  id: "governance.nationalPride",
  categoryId: "governance",
  metricId: "nationalPride",
  kind: "derived",
  // Military prestige + a booming economy; nationalist policy acts via
  // coexistence. Event drivers named, unwired.
  inputs: ["governance.militaryReadiness", "economic.gdpGrowth"],
  bounds: [0, 100],
  inertia: 0.9,
  decimals: 1,
  compute: (ctx) => {
    const readiness = ctx.current["governance.militaryReadiness"] ?? 50;
    const gdpGrowth = ctx.current["economic.gdpGrowth"] ?? 2.5;
    return 52 + (readiness - 50) * 0.25 + (gdpGrowth - 2.5) * 2;
  },
};

// Uniform-seeded broadly; CN/JP flavor comes through the roots.
export const roboticsAdoptionNode: RegistryNode = {
  id: "governance.roboticsAdoption",
  categoryId: "governance",
  metricId: "roboticsAdoption",
  kind: "derived",
  // Aligned with the uniform-seed derivation (manufacturingCompetitiveness)
  // plus the live R&D root: robots go where factories and research are.
  inputs: ["economic.manufacturingCompetitiveness", "economic.rdIntensity"],
  bounds: [0, 100],
  inertia: 0.92,
  decimals: 2, // 2dp: cabinet effects (≤0.05/turn) are reabsorbed at a coarser grain — bug #0800
  compute: (ctx) => {
    const manufacturing = ctx.current["economic.manufacturingCompetitiveness"] ?? 60; // root
    const rd = ctx.current["economic.rdIntensity"] ?? 2.5; // root, % of GDP
    return manufacturing * 0.6 + rd * 8 + 4;
  },
};

// IE-only seed 85 (% IPAS capacity utilization).
export const directProvisionLoadNode: RegistryNode = {
  id: "governance.directProvisionLoad",
  categoryId: "governance",
  metricId: "directProvisionLoad",
  kind: "derived",
  // LOWER is better. Net inflow (live demographic migrationRate, [−5,5]%)
  // strains capacity; social spending builds it out.
  inputs: ["population.migrationRate", { spending: "social" }],
  bounds: [0, 100],
  inertia: 0.85,
  decimals: 1,
  compute: (ctx) => {
    const migration = ctx.current["population.migrationRate"] ?? 0.3;
    const socialResp = fundingResponse(ctx.spending["social"] ?? 0, SOCIAL_SPEND_HALF_SAT, 100);
    return 85 + (migration - 0.3) * 8 - socialResp * 0.1;
  },
};

/** Governance nodes — the P4b core + the P5 country indices. */
export const GOVERNANCE_NODES: RegistryNode[] = [
  corruptionIndexNode,
  publicTrustNode,
  devolutionSatisfactionNode,
  unityReferendumSupportNode,
  rentenStabilitaetNode,
  militaryReadinessNode,
  bundeswehrReadinessNode,
  civilLibertiesNode,
  nationalPrideNode,
  roboticsAdoptionNode,
  directProvisionLoadNode,
];
