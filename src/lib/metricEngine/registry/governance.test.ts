import { describe, expect, it } from "vitest";
import type { EngineNodeContext, NodeId } from "../types";
import { GOVERNANCE_NODES, corruptionIndexNode, publicTrustNode } from "./governance";

function ctx(over: {
  current?: Record<NodeId, number>;
  approval?: number;
  spending?: Record<string, number>;
}): EngineNodeContext {
  return {
    current: over.current ?? {},
    prev: {},
    prevSimBaseline: {},
    providers: over.approval === undefined ? {} : { governmentApproval: over.approval },
    spending: over.spending ?? {},
    policyValue: NaN,
  };
}

const REF = {
  current: {
    "governance.governmentTransparency": 55,
    "social.incomeInequality": 42,
    "economic.unemploymentRate": 5,
    "governance.corruptionIndex": 40,
    "mediaInformation.newsTrust": 50,
  },
  approval: 45,
};

describe("governance core registry nodes (P4b)", () => {
  it("exports the governance nodes with governance storage paths", () => {
    expect(GOVERNANCE_NODES.length).toBeGreaterThanOrEqual(2);
    for (const n of GOVERNANCE_NODES) expect(n.id).toBe(`governance.${n.metricId}`);
  });

  it("corruptionIndex (LOWER better): transparency suppresses, inequality feeds elite capture", () => {
    expect(corruptionIndexNode.compute!(ctx(REF))).toBeCloseTo(40, 5);
    const transparent = corruptionIndexNode.compute!(
      ctx({ current: { ...REF.current, "governance.governmentTransparency": 80 } })
    );
    const unequal = corruptionIndexNode.compute!(
      ctx({ current: { ...REF.current, "social.incomeInequality": 55 } })
    );
    expect(transparent).toBeLessThan(40);
    expect(unequal).toBeGreaterThan(40);
  });

  it("publicTrust: approval and news trust build it; joblessness and corruption corrode it", () => {
    expect(publicTrustNode.compute!(ctx(REF))).toBeCloseTo(50, 5);
    const popular = publicTrustNode.compute!(ctx({ ...REF, approval: 65 }));
    const jobless = publicTrustNode.compute!(
      ctx({ ...REF, current: { ...REF.current, "economic.unemploymentRate": 9 } })
    );
    const corrupt = publicTrustNode.compute!(
      ctx({ ...REF, current: { ...REF.current, "governance.corruptionIndex": 65 } })
    );
    const informed = publicTrustNode.compute!(
      ctx({ ...REF, current: { ...REF.current, "mediaInformation.newsTrust": 70 } })
    );
    expect(popular).toBeGreaterThan(50);
    expect(jobless).toBeLessThan(50);
    expect(corrupt).toBeLessThan(50);
    expect(informed).toBeGreaterThan(50);
    // missing provider → neutral anchor
    expect(publicTrustNode.compute!(ctx({ current: REF.current }))).toBeCloseTo(50, 5);
  });

  it("registration + topo: corruption before publicTrust; newsTrust before publicTrust", async () => {
    const { METRIC_REGISTRY_SORTED } = await import("./index");
    const order = new Map(METRIC_REGISTRY_SORTED.map((n, i) => [n.id, i]));
    expect(order.has("governance.publicTrust")).toBe(true);
    expect(order.get("governance.corruptionIndex")!).toBeLessThan(
      order.get("governance.publicTrust")!
    );
    expect(order.get("mediaInformation.newsTrust")!).toBeLessThan(
      order.get("governance.publicTrust")!
    );
  });
});

describe("P5 country indices — direction + anchors", () => {
  const P5REF = {
    current: {
      "governance.publicTrust": 50,
      "governance.devolutionSatisfaction": 50,
      "economic.unemploymentRate": 5,
      "economic.gdpGrowth": 2.5,
      "social.socialCohesion": 52,
      "population.dependencyRatio": 0.6,
      "economic.manufacturingCompetitiveness": 60,
      "economic.rdIntensity": 2.5,
      "population.migrationRate": 0.3,
    },
  };

  it("exports the 11 governance nodes (P4 core + P5 indices + P6a axis)", async () => {
    // independenceDesire is intentionally NOT a metric-engine node — it is owned
    // solely by the drift engine (src/lib/turn/independenceDesireDrift.ts).
    const { GOVERNANCE_NODES: nodes } = await import("./governance");
    expect(nodes).toHaveLength(11);
    expect(nodes.some((n) => n.id === "governance.independenceDesire")).toBe(false);
  });

  it("devolutionSatisfaction tracks publicTrust (uniform alignment)", async () => {
    const { devolutionSatisfactionNode } = await import("./governance");
    expect(devolutionSatisfactionNode.compute!(ctx(P5REF))).toBeCloseTo(50, 5);
    expect(
      devolutionSatisfactionNode.compute!(
        ctx({ current: { ...P5REF.current, "governance.publicTrust": 70 } })
      )
    ).toBeCloseTo(70, 5);
  });

  it("unityReferendumSupport: hardship feeds it, cohesion calms it", async () => {
    const { unityReferendumSupportNode } = await import("./governance");
    expect(unityReferendumSupportNode.compute!(ctx(P5REF))).toBeCloseTo(45, 5);
    const hardship = unityReferendumSupportNode.compute!(
      ctx({ current: { ...P5REF.current, "economic.unemploymentRate": 10 } })
    );
    const cohesive = unityReferendumSupportNode.compute!(
      ctx({ current: { ...P5REF.current, "social.socialCohesion": 70 } })
    );
    expect(hardship).toBeGreaterThan(45);
    expect(cohesive).toBeLessThan(45);
  });

  it("rentenStabilitaet: aging erodes it, pension funding shores it up", async () => {
    const { rentenStabilitaetNode } = await import("./governance");
    expect(rentenStabilitaetNode.compute!(ctx(P5REF))).toBeCloseTo(65, 5);
    const aged = rentenStabilitaetNode.compute!(
      ctx({ current: { ...P5REF.current, "population.dependencyRatio": 0.75 } })
    );
    const funded = rentenStabilitaetNode.compute!(ctx({ ...P5REF, spending: { social: 40 } }));
    // dependency 0.75 is 0.15 above the 0.6 center → 0.15·120 = 18 erosion.
    expect(aged).toBeCloseTo(65 - 18, 5);
    expect(funded).toBeGreaterThan(65);
  });

  it("militaryReadiness builds with defense spending; bundeswehr tracks it (P6a reconcile)", async () => {
    const { militaryReadinessNode, bundeswehrReadinessNode } = await import("./governance");
    const bare = militaryReadinessNode.compute!(ctx({ current: {} }));
    const funded = militaryReadinessNode.compute!(ctx({ current: {}, spending: { defense: 8 } }));
    const flooded = militaryReadinessNode.compute!(ctx({ current: {}, spending: { defense: 80 } }));
    expect(bare).toBeCloseTo(30, 5);
    expect(funded).toBeGreaterThan(bare);
    expect(flooded - funded).toBeLessThan(funded - bare); // diminishing returns
    expect(flooded).toBeLessThan(75.1); // saturates ≈ 30 + 45
    // The DE tracker follows the universal node identically.
    expect(
      bundeswehrReadinessNode.compute!(ctx({ current: { "governance.militaryReadiness": 62 } }))
    ).toBeCloseTo(62, 5);
  });

  it("roboticsAdoption follows factories + R&D (uniform alignment at the anchor)", async () => {
    const { roboticsAdoptionNode } = await import("./governance");
    expect(roboticsAdoptionNode.compute!(ctx(P5REF))).toBeCloseTo(60, 5);
    const industrial = roboticsAdoptionNode.compute!(
      ctx({ current: { ...P5REF.current, "economic.manufacturingCompetitiveness": 85 } })
    );
    const research = roboticsAdoptionNode.compute!(
      ctx({ current: { ...P5REF.current, "economic.rdIntensity": 4 } })
    );
    expect(industrial).toBeGreaterThan(60);
    expect(research).toBeGreaterThan(60);
  });

  it("directProvisionLoad (LOWER better): inflow strains, social capacity relieves", async () => {
    const { directProvisionLoadNode } = await import("./governance");
    expect(directProvisionLoadNode.compute!(ctx(P5REF))).toBeCloseTo(85, 5);
    const surge = directProvisionLoadNode.compute!(
      ctx({ current: { ...P5REF.current, "population.migrationRate": 1.5 } })
    );
    const capacity = directProvisionLoadNode.compute!(ctx({ ...P5REF, spending: { social: 40 } }));
    expect(surge).toBeGreaterThan(85);
    expect(capacity).toBeLessThan(85);
  });

  it("topo: publicTrust → devolutionSatisfaction; cohesion → unity", async () => {
    const { METRIC_REGISTRY_SORTED } = await import("./index");
    const order = new Map(METRIC_REGISTRY_SORTED.map((n, i) => [n.id, i]));
    expect(order.get("governance.publicTrust")!).toBeLessThan(
      order.get("governance.devolutionSatisfaction")!
    );
    // independenceDesire is owned by the drift engine, not the registry.
    expect(order.has("governance.independenceDesire")).toBe(false);
    expect(order.get("social.socialCohesion")!).toBeLessThan(
      order.get("governance.unityReferendumSupport")!
    );
  });
});

describe("P6a axis nodes — direction + anchors", () => {
  it("civilLiberties: press freedom lifts; control, incarceration, social credit erode", async () => {
    const { civilLibertiesNode } = await import("./governance");
    const REF = {
      current: {
        "mediaInformation.pressFreedom": 69,
        "mediaInformation.stateMediaControl": 30,
        "publicSafety.incarcerationRate": 450,
        "governance.socialCreditCoverage": 10,
      },
    };
    expect(civilLibertiesNode.compute!(ctx(REF))).toBeCloseTo(50, 5);
    const free = civilLibertiesNode.compute!(
      ctx({ current: { ...REF.current, "mediaInformation.pressFreedom": 90 } })
    );
    const controlled = civilLibertiesNode.compute!(
      ctx({ current: { ...REF.current, "mediaInformation.stateMediaControl": 70 } })
    );
    const carceral = civilLibertiesNode.compute!(
      ctx({ current: { ...REF.current, "publicSafety.incarcerationRate": 800 } })
    );
    const surveilled = civilLibertiesNode.compute!(
      ctx({ current: { ...REF.current, "governance.socialCreditCoverage": 60 } })
    );
    expect(free).toBeGreaterThan(50);
    expect(controlled).toBeLessThan(50);
    expect(carceral).toBeLessThan(50);
    expect(surveilled).toBeLessThan(50);
  });

  it("nationalPride: military prestige and a booming economy feed it", async () => {
    const { nationalPrideNode } = await import("./governance");
    const REF = {
      current: { "governance.militaryReadiness": 50, "economic.gdpGrowth": 2.5 },
    };
    expect(nationalPrideNode.compute!(ctx(REF))).toBeCloseTo(52, 5);
    const martial = nationalPrideNode.compute!(
      ctx({ current: { ...REF.current, "governance.militaryReadiness": 75 } })
    );
    const booming = nationalPrideNode.compute!(
      ctx({ current: { ...REF.current, "economic.gdpGrowth": 5 } })
    );
    expect(martial).toBeGreaterThan(52);
    expect(booming).toBeGreaterThan(52);
  });

  it("topo: militaryReadiness before nationalPride and bundeswehr; roots feed civilLiberties", async () => {
    const { METRIC_REGISTRY_SORTED } = await import("./index");
    const order = new Map(METRIC_REGISTRY_SORTED.map((n, i) => [n.id, i]));
    expect(order.get("governance.militaryReadiness")!).toBeLessThan(
      order.get("governance.nationalPride")!
    );
    expect(order.get("governance.militaryReadiness")!).toBeLessThan(
      order.get("governance.bundeswehrReadiness")!
    );
    expect(order.get("publicSafety.incarcerationRate")!).toBeLessThan(
      order.get("governance.civilLiberties")!
    );
    expect(order.has("economic.economicFreedom")).toBe(true);
  });
});
