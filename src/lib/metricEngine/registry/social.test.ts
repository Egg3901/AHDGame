import { describe, expect, it } from "vitest";
import type { EngineNodeContext } from "../types";
import {
  incomeInequalityNode,
  childPovertyNode,
  foodInsecurityNode,
  housingAffordabilityNode,
  homelessnessRateNode,
  socialMobilityNode,
  socialCohesionNode,
  civicParticipationNode,
  roughSleepingNode,
  vacantPropertyRateNode,
  rentalPressureIndexNode,
  SOCIAL_NODES,
} from "./social";
import { medianIncomeNode, costOfLivingNode } from "./economic";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";

function ctx(partial: {
  spending?: Record<string, number>;
  current?: Record<string, number>;
  prev?: Record<string, number>;
  prevSimBaseline?: Record<string, number>;
}): EngineNodeContext {
  return {
    current: partial.current ?? {},
    prev: partial.prev ?? {},
    prevSimBaseline: partial.prevSimBaseline ?? {},
    providers: {},
    spending: partial.spending ?? {},
    policyValue: NaN,
  };
}

describe("P3a income/poverty cluster — direction", () => {
  it("incomeInequality (Gini-100) rises with slack labor + boom growth; transfers compress", () => {
    const base = incomeInequalityNode.compute!(
      ctx({
        current: { "economic.unemploymentRate": 5, "economic.gdpGrowth": 2.5 },
        spending: { social: 2 },
      })
    );
    const slack = incomeInequalityNode.compute!(
      ctx({
        current: { "economic.unemploymentRate": 11, "economic.gdpGrowth": 2.5 },
        spending: { social: 2 },
      })
    );
    const transfers = incomeInequalityNode.compute!(
      ctx({
        current: { "economic.unemploymentRate": 5, "economic.gdpGrowth": 2.5 },
        spending: { social: 50 },
      })
    );
    expect(slack).toBeGreaterThan(base);
    expect(transfers).toBeLessThan(base);
  });

  it("childPoverty amplifies overall poverty and is relieved by social spending", () => {
    const low = childPovertyNode.compute!(
      ctx({ current: { "economic.povertyRate": 8 }, spending: { social: 2 } })
    );
    const high = childPovertyNode.compute!(
      ctx({ current: { "economic.povertyRate": 25 }, spending: { social: 2 } })
    );
    expect(high).toBeGreaterThan(low);
    // amplification: a +17pp poverty swing moves child poverty by MORE than 17pp
    expect(high - low).toBeGreaterThan(17);
  });

  it("foodInsecurity tracks poverty and is relieved by food security", () => {
    const insecure = foodInsecurityNode.compute!(
      ctx({ current: { "economic.povertyRate": 25, "economic.foodSecurity": 30 } })
    );
    const secure = foodInsecurityNode.compute!(
      ctx({ current: { "economic.povertyRate": 8, "economic.foodSecurity": 80 } })
    );
    expect(insecure).toBeGreaterThan(secure);
  });

  it("medianIncome grows RELATIVELY at productivity + tightness (currency-safe)", () => {
    // A yen-scale median grows by the same RATE as a dollar-scale one.
    const usd = medianIncomeNode.compute!(
      ctx({
        prevSimBaseline: { "economic.medianIncome": 50_000 },
        current: { "economic.productivityGrowth": 2.4, "economic.unemploymentRate": 4 },
      })
    );
    const yen = medianIncomeNode.compute!(
      ctx({
        prevSimBaseline: { "economic.medianIncome": 5_000_000 },
        current: { "economic.productivityGrowth": 2.4, "economic.unemploymentRate": 4 },
      })
    );
    const expectedRate = 1 + (2.4 + 0.3) / 100 / TURNS_PER_YEAR;
    expect(usd / 50_000).toBeCloseTo(expectedRate, 10);
    expect(yen / 5_000_000).toBeCloseTo(expectedRate, 10);
    // Slack labor markets drag wage growth below productivity.
    const slack = medianIncomeNode.compute!(
      ctx({
        prevSimBaseline: { "economic.medianIncome": 50_000 },
        current: { "economic.productivityGrowth": 2.4, "economic.unemploymentRate": 11 },
      })
    );
    expect(slack).toBeLessThan(usd);
  });

  it("costOfLiving drifts toward an urbanization-set structural level", () => {
    const rural = costOfLivingNode.compute!(
      ctx({ current: { "population.urbanizationRate": 30 } })
    );
    const urban = costOfLivingNode.compute!(
      ctx({ current: { "population.urbanizationRate": 90 } })
    );
    expect(urban).toBeGreaterThan(rural);
  });
});

describe("P3a cluster — well-formed", () => {
  it("finite at neutral inputs; metadata sane; zero spend safe", () => {
    for (const node of [...SOCIAL_NODES, medianIncomeNode, costOfLivingNode]) {
      expect(Number.isFinite(node.compute!(ctx({}))), `${node.id} neutral`).toBe(true);
      expect(node.bounds[0]).toBeLessThan(node.bounds[1]);
      expect(node.kind).toBe("derived");
    }
  });
});

describe("P3d social outcomes — direction + anchors", () => {
  const REF = {
    current: {
      "economic.costOfLiving": 104,
      "social.housingSupplyGrowth": 1,
      "social.housingAffordability": 30,
      "economic.povertyRate": 13,
      "healthcare.mentalHealthAccess": 50,
      "education.highSchoolGradRate": 88,
      "education.universityEnrollment": 40,
      "social.incomeInequality": 42,
      "economic.unemploymentRate": 5,
      "mediaInformation.mediaPolarization": 45,
      "social.socialCohesion": 52,
      "governance.publicTrust": 50,
      "social.homelessnessRate": 13,
    },
    prev: { "economic.povertyRate": 13 },
  };

  it("exports all 11 social nodes (P3a trio + P3d eight)", () => {
    expect(SOCIAL_NODES).toHaveLength(11);
    for (const n of SOCIAL_NODES) {
      expect(n.id).toBe(`social.${n.metricId}`);
      expect(n.bounds[0]).toBeLessThan(n.bounds[1]);
    }
  });

  it("housingAffordability (pressure, LOWER better): cost of living squeezes, supply relieves", () => {
    expect(housingAffordabilityNode.compute!(ctx(REF))).toBeCloseTo(33.6, 5);
    const cheap = housingAffordabilityNode.compute!(
      ctx({ current: { ...REF.current, "economic.costOfLiving": 90 } })
    );
    const building = housingAffordabilityNode.compute!(
      ctx({ current: { ...REF.current, "social.housingSupplyGrowth": 4 } })
    );
    expect(cheap).toBeLessThan(33.6);
    expect(building).toBeLessThan(33.6);
  });

  it("homelessnessRate (per 10k): pressure + poverty raise it, mental-health access cuts it", () => {
    expect(homelessnessRateNode.compute!(ctx(REF))).toBeCloseTo(13, 5);
    const squeezed = homelessnessRateNode.compute!(
      ctx({ ...REF, current: { ...REF.current, "social.housingAffordability": 60 } })
    );
    const poorer = homelessnessRateNode.compute!(
      ctx({ ...REF, current: { ...REF.current, "economic.povertyRate": 22 } })
    );
    const treated = homelessnessRateNode.compute!(
      ctx({ ...REF, current: { ...REF.current, "healthcare.mentalHealthAccess": 80 } })
    );
    expect(squeezed).toBeGreaterThan(13);
    expect(poorer).toBeGreaterThan(13);
    expect(treated).toBeLessThan(13);
  });

  it("socialMobility: schooling lifts it; inequality and lagged poverty drag it", () => {
    expect(socialMobilityNode.compute!(ctx(REF))).toBeCloseTo(55, 5);
    const schooled = socialMobilityNode.compute!(
      ctx({ ...REF, current: { ...REF.current, "education.highSchoolGradRate": 95 } })
    );
    const unequal = socialMobilityNode.compute!(
      ctx({ ...REF, current: { ...REF.current, "social.incomeInequality": 52 } })
    );
    const poorer = socialMobilityNode.compute!(
      ctx({ ...REF, prev: { "economic.povertyRate": 22 } })
    );
    expect(schooled).toBeGreaterThan(55);
    expect(unequal).toBeLessThan(55);
    expect(poorer).toBeLessThan(55);
  });

  it("socialCohesion: inequality, joblessness, and polarization all erode it", () => {
    expect(socialCohesionNode.compute!(ctx(REF))).toBeCloseTo(52, 5);
    const unequal = socialCohesionNode.compute!(
      ctx({ ...REF, current: { ...REF.current, "social.incomeInequality": 52 } })
    );
    const jobless = socialCohesionNode.compute!(
      ctx({ ...REF, current: { ...REF.current, "economic.unemploymentRate": 9 } })
    );
    const polarized = socialCohesionNode.compute!(
      ctx({ ...REF, current: { ...REF.current, "mediaInformation.mediaPolarization": 70 } })
    );
    expect(unequal).toBeLessThan(52);
    expect(jobless).toBeLessThan(52);
    expect(polarized).toBeLessThan(52);
  });

  it("civicParticipation: schooling, cohesion, and trust lift it", () => {
    expect(civicParticipationNode.compute!(ctx(REF))).toBeCloseTo(55, 5);
    const cohesive = civicParticipationNode.compute!(
      ctx({ ...REF, current: { ...REF.current, "social.socialCohesion": 70 } })
    );
    const trusting = civicParticipationNode.compute!(
      ctx({ ...REF, current: { ...REF.current, "governance.publicTrust": 75 } })
    );
    expect(cohesive).toBeGreaterThan(55);
    expect(trusting).toBeGreaterThan(55);
  });

  it("registration + topo: cohesion orders BEFORE education (the hand-back edge)", async () => {
    const { METRIC_REGISTRY_SORTED } = await import("./index");
    const order = new Map(METRIC_REGISTRY_SORTED.map((n, i) => [n.id, i]));
    expect(order.has("social.socialCohesion")).toBe(true);
    expect(order.get("social.socialCohesion")!).toBeLessThan(
      order.get("education.highSchoolGradRate")!
    );
    expect(order.get("social.housingAffordability")!).toBeLessThan(
      order.get("social.homelessnessRate")!
    );
    expect(order.get("social.homelessnessRate")!).toBeLessThan(order.get("social.roughSleeping")!);
    expect(order.get("education.highSchoolGradRate")!).toBeLessThan(
      order.get("social.civicParticipation")!
    );
  });

  it("UK roughSleeping tracks homelessness (uniform derivation: /5)", () => {
    expect(roughSleepingNode.compute!(ctx(REF))).toBeCloseTo(13 / 5, 5);
  });

  it("IE vacancy falls and rental pressure rises as housing pressure climbs", () => {
    expect(vacantPropertyRateNode.compute!(ctx(REF))).toBeCloseTo(12 - 3, 5);
    expect(rentalPressureIndexNode.compute!(ctx(REF))).toBeCloseTo(10 + 60, 5);
    const squeezed = ctx({
      ...REF,
      current: { ...REF.current, "social.housingAffordability": 50 },
    });
    expect(vacantPropertyRateNode.compute!(squeezed)).toBeLessThan(9);
    expect(rentalPressureIndexNode.compute!(squeezed)).toBeGreaterThan(70);
  });
});
