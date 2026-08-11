import { describe, expect, it } from "vitest";
import type { EngineNodeContext, NodeId } from "../types";
import {
  MEDIA_INFORMATION_NODES,
  socialMediaSentimentNode,
  mediaPolarizationNode,
  newsTrustNode,
  disinformationRiskNode,
  bbcTrustNode,
} from "./mediaInformation";

function ctx(over: {
  current?: Record<NodeId, number>;
  prev?: Record<NodeId, number>;
  approval?: number;
}): EngineNodeContext {
  return {
    current: over.current ?? {},
    prev: over.prev ?? {},
    prevSimBaseline: {},
    providers: over.approval === undefined ? {} : { governmentApproval: over.approval },
    spending: {},
    policyValue: NaN,
  };
}

/** Reference: approval 45, gini 42, unemp 5, gdpGrowth 2.5, press 69, polarization 45, news 50, sentiment 0. */
const REF = {
  current: {
    "social.incomeInequality": 42,
    "economic.unemploymentRate": 5,
    "economic.gdpGrowth": 2.5,
    "mediaInformation.pressFreedom": 69,
    "mediaInformation.mediaPolarization": 45,
    "mediaInformation.newsTrust": 50,
    "mediaInformation.socialMediaSentiment": 0,
  },
  approval: 45,
};

describe("media/information registry nodes (P4)", () => {
  it("exports all 5 nodes with mediaInformation storage paths", () => {
    expect(MEDIA_INFORMATION_NODES).toHaveLength(5);
    for (const n of MEDIA_INFORMATION_NODES) {
      expect(n.id).toBe(`mediaInformation.${n.metricId}`);
      expect(n.bounds[0]).toBeLessThan(n.bounds[1]);
    }
  });

  it("socialMediaSentiment (bipolar): popularity and growth lift the mood, joblessness sours it", () => {
    expect(socialMediaSentimentNode.compute!(ctx(REF))).toBeCloseTo(0, 5);
    const popular = socialMediaSentimentNode.compute!(ctx({ ...REF, approval: 65 }));
    const boom = socialMediaSentimentNode.compute!(
      ctx({ ...REF, current: { ...REF.current, "economic.gdpGrowth": 4.5 } })
    );
    const jobless = socialMediaSentimentNode.compute!(
      ctx({ ...REF, current: { ...REF.current, "economic.unemploymentRate": 9 } })
    );
    expect(popular).toBeGreaterThan(0);
    expect(boom).toBeGreaterThan(0);
    expect(jobless).toBeLessThan(0);
    // missing provider → neutral anchor
    expect(socialMediaSentimentNode.compute!(ctx({ current: REF.current }))).toBeCloseTo(0, 5);
  });

  it("mediaPolarization: inequality feeds it, positive mood calms it", () => {
    expect(mediaPolarizationNode.compute!(ctx(REF))).toBeCloseTo(45, 5);
    const unequal = mediaPolarizationNode.compute!(
      ctx({ ...REF, current: { ...REF.current, "social.incomeInequality": 52 } })
    );
    const sunny = mediaPolarizationNode.compute!(
      ctx({ ...REF, current: { ...REF.current, "mediaInformation.socialMediaSentiment": 30 } })
    );
    expect(unequal).toBeGreaterThan(45);
    expect(sunny).toBeLessThan(45);
  });

  it("newsTrust: press freedom builds it, polarization corrodes it", () => {
    expect(newsTrustNode.compute!(ctx(REF))).toBeCloseTo(50, 5);
    const free = newsTrustNode.compute!(
      ctx({ ...REF, current: { ...REF.current, "mediaInformation.pressFreedom": 90 } })
    );
    const polarized = newsTrustNode.compute!(
      ctx({ ...REF, current: { ...REF.current, "mediaInformation.mediaPolarization": 70 } })
    );
    expect(free).toBeGreaterThan(50);
    expect(polarized).toBeLessThan(50);
  });

  it("disinformationRisk: press freedom and news trust suppress it, dark moods feed it", () => {
    expect(disinformationRiskNode.compute!(ctx(REF))).toBeCloseTo(42, 5);
    const free = disinformationRiskNode.compute!(
      ctx({ ...REF, current: { ...REF.current, "mediaInformation.pressFreedom": 90 } })
    );
    const gloomy = disinformationRiskNode.compute!(
      ctx({ ...REF, current: { ...REF.current, "mediaInformation.socialMediaSentiment": -40 } })
    );
    expect(free).toBeLessThan(42);
    expect(gloomy).toBeGreaterThan(42);
  });

  it("bbcTrust (UK-origin) tracks newsTrust (uniform alignment)", () => {
    expect(bbcTrustNode.compute!(ctx(REF))).toBeCloseTo(50, 5);
    const trusted = bbcTrustNode.compute!(
      ctx({ ...REF, current: { ...REF.current, "mediaInformation.newsTrust": 70 } })
    );
    expect(trusted).toBeCloseTo(70, 5);
  });

  it("registration + topo: gini → polarization → socialCohesion (hand-back #2)", async () => {
    const { METRIC_REGISTRY_SORTED } = await import("./index");
    const order = new Map(METRIC_REGISTRY_SORTED.map((n, i) => [n.id, i]));
    expect(order.has("mediaInformation.mediaPolarization")).toBe(true);
    expect(order.get("social.incomeInequality")!).toBeLessThan(
      order.get("mediaInformation.mediaPolarization")!
    );
    expect(order.get("mediaInformation.mediaPolarization")!).toBeLessThan(
      order.get("social.socialCohesion")!
    );
    expect(order.get("mediaInformation.socialMediaSentiment")!).toBeLessThan(
      order.get("mediaInformation.mediaPolarization")!
    );
  });
});
