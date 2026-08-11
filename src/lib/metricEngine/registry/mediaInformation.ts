import type { EngineNodeContext, RegistryNode } from "../types";

/**
 * Media/Information tier (P4a) — the information half of the legitimacy tier.
 * socialMediaSentiment reads the sitting government's stored national approval
 * (the governmentApproval provider — LAST turn's snapshot, the lag that keeps
 * the approval feedback loop a damped cross-turn cycle). pressFreedom stays a
 * policy ROOT; mediaPolarization keeps its 🔧 half via coexistence deltas.
 *
 * Hand-back #2: social.socialCohesion already reads mediaPolarization — the
 * registration here resolves it into a live same-turn topo edge
 * (gini → sentiment → polarization → cohesion → education).
 *
 * Reference anchors: approval 45, sentiment 0, polarization 45, newsTrust 50,
 * pressFreedom 69, disinformation 42. First-pass coefficients (balance pass).
 */

const NEUTRAL_APPROVAL = 45;

function approvalOf(ctx: EngineNodeContext): number {
  const v = ctx.providers["governmentApproval"];
  return typeof v === "number" && Number.isFinite(v) ? v : NEUTRAL_APPROVAL;
}

export const socialMediaSentimentNode: RegistryNode = {
  id: "mediaInformation.socialMediaSentiment",
  categoryId: "mediaInformation",
  metricId: "socialMediaSentiment",
  kind: "derived",
  // Bipolar mood index [−100,100] — fast-moving: government popularity, the
  // economy's direction, and joblessness. ("Events" driver named, unwired.)
  inputs: [{ provider: "governmentApproval" }, "economic.gdpGrowth", "economic.unemploymentRate"],
  bounds: [-100, 100],
  inertia: 0.75,
  decimals: 1,
  compute: (ctx) => {
    const gdpGrowth = ctx.current["economic.gdpGrowth"] ?? 2.5;
    const unemployment = ctx.current["economic.unemploymentRate"] ?? 5;
    return (approvalOf(ctx) - 45) * 0.8 + (gdpGrowth - 2.5) * 4 - (unemployment - 5) * 3;
  },
};

export const mediaPolarizationNode: RegistryNode = {
  id: "mediaInformation.mediaPolarization",
  categoryId: "mediaInformation",
  metricId: "mediaPolarization",
  kind: "derived",
  // LOWER is better. Polarization feeds on inequality and a souring public
  // mood; media-policy laws act through coexistence (the 🔧 half).
  inputs: ["social.incomeInequality", "mediaInformation.socialMediaSentiment"],
  bounds: [0, 100],
  inertia: 0.9,
  decimals: 2, // 2dp: cabinet effects (≤0.05/turn) are reabsorbed at a coarser grain — bug #0800
  compute: (ctx) => {
    const gini = ctx.current["social.incomeInequality"] ?? 42;
    const sentiment = ctx.current["mediaInformation.socialMediaSentiment"] ?? 0;
    return 45 + (gini - 42) * 0.4 - sentiment * 0.08;
  },
};

export const newsTrustNode: RegistryNode = {
  id: "mediaInformation.newsTrust",
  categoryId: "mediaInformation",
  metricId: "newsTrust",
  kind: "derived",
  inputs: ["mediaInformation.pressFreedom", "mediaInformation.mediaPolarization"],
  bounds: [0, 100],
  inertia: 0.88,
  decimals: 1,
  compute: (ctx) => {
    const pressFreedom = ctx.current["mediaInformation.pressFreedom"] ?? 69; // root
    const polarization = ctx.current["mediaInformation.mediaPolarization"] ?? 45;
    return 50 + (pressFreedom - 69) * 0.3 - (polarization - 45) * 0.4;
  },
};

export const disinformationRiskNode: RegistryNode = {
  id: "mediaInformation.disinformationRisk",
  categoryId: "mediaInformation",
  metricId: "disinformationRisk",
  kind: "derived",
  // LOWER is better.
  inputs: [
    "mediaInformation.pressFreedom",
    "mediaInformation.newsTrust",
    "mediaInformation.socialMediaSentiment",
  ],
  bounds: [0, 100],
  inertia: 0.88,
  decimals: 1,
  compute: (ctx) => {
    const pressFreedom = ctx.current["mediaInformation.pressFreedom"] ?? 69;
    const newsTrust = ctx.current["mediaInformation.newsTrust"] ?? 50;
    const sentiment = ctx.current["mediaInformation.socialMediaSentiment"] ?? 0;
    return 42 - (pressFreedom - 69) * 0.25 - (newsTrust - 50) * 0.3 - sentiment * 0.08;
  },
};

// UK-origin metric, uniform-seeded broadly (the persist gate scopes it).
export const bbcTrustNode: RegistryNode = {
  id: "mediaInformation.bbcTrust",
  categoryId: "mediaInformation",
  metricId: "bbcTrust",
  kind: "derived",
  // Aligned with the uniform-seed derivation: it tracks newsTrust.
  inputs: ["mediaInformation.newsTrust"],
  bounds: [20, 90],
  inertia: 0.88,
  decimals: 1,
  compute: (ctx) => ctx.current["mediaInformation.newsTrust"] ?? 50,
};

/** Media/Information tier nodes (P4a). */
export const MEDIA_INFORMATION_NODES: RegistryNode[] = [
  socialMediaSentimentNode,
  mediaPolarizationNode,
  newsTrustNode,
  disinformationRiskNode,
  bbcTrustNode,
];
