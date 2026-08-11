import { describe, expect, it } from "vitest";
import type { EngineNodeContext, NodeId } from "../types";
import {
  PUBLIC_SAFETY_NODES,
  policePerCapitaNode,
  crimeRateNode,
  violentCrimeRateNode,
  incarcerationRateNode,
  recidivismRateNode,
  publicSafetyConfidenceNode,
  antiSocialBehaviourRateNode,
  knifeCrimeRateNode,
} from "./publicSafety";

function ctx(over: {
  current?: Record<NodeId, number>;
  prev?: Record<NodeId, number>;
  spending?: Record<string, number>;
}): EngineNodeContext {
  return {
    current: over.current ?? {},
    prev: over.prev ?? {},
    prevSimBaseline: {},
    providers: {},
    spending: over.spending ?? {},
    policyValue: NaN,
  };
}

/** The shared reference state every node is anchored at. */
const REF = {
  current: {
    "education.highSchoolGradRate": 88,
    "publicSafety.policePerCapita": 2.5,
    "social.incomeInequality": 42,
    "publicSafety.crimeRate": 4500,
    "publicSafety.violentCrimeRate": 250,
    "publicSafety.incarcerationRate": 450,
    "economic.unemploymentRate": 5,
  },
  prev: {
    "economic.povertyRate": 13,
    "economic.unemploymentRate": 5,
    "publicSafety.crimeRate": 4500,
  },
};

describe("publicSafety registry nodes (P3b)", () => {
  it("exports all 8 nodes with publicSafety storage paths", () => {
    expect(PUBLIC_SAFETY_NODES).toHaveLength(8);
    for (const n of PUBLIC_SAFETY_NODES) {
      expect(n.id).toBe(`publicSafety.${n.metricId}`);
      expect(n.categoryId).toBe("publicSafety");
      expect(n.bounds[0]).toBeLessThan(n.bounds[1]);
    }
  });

  describe("policePerCapita (spend capacity)", () => {
    // Real achievable per-capita range for the publicSafety channel (sum of
    // every US publicSafety-tagged bill's federal+state policyOption costs):
    // $418 (cheapest option on all four bills) .. $1935 (priciest on all
    // four), center ~$829 — see PS_SPEND_HALF_SAT's doc comment in
    // ./publicSafety.ts. Under HALF_SAT=900 this range now has real slope
    // instead of sitting >99.7% saturated at every point in it.
    it("is ~1/1k unfunded and shows real mid-range slope, not saturation, across the real spend range", () => {
      expect(policePerCapitaNode.compute!(ctx({ spending: {} }))).toBeCloseTo(1, 5);
      const atCenter = policePerCapitaNode.compute!(ctx({ spending: { publicSafety: 829 } }));
      const atMax = policePerCapitaNode.compute!(ctx({ spending: { publicSafety: 1935 } }));
      // Center (~48% response) should land well short of the max response.
      expect(atCenter).toBeGreaterThan(2.4);
      expect(atCenter).toBeLessThan(2.9);
      // Max real spend (~68% response) should still be meaningfully below the
      // asymptote (4.5), proving the channel isn't pinned near saturation.
      expect(atMax).toBeGreaterThan(3.2);
      expect(atMax).toBeLessThan(3.6);
    });

    it("responds with diminishing returns", () => {
      // Equally-spaced points across the real min..max range ($418, $1176.5,
      // $1935): concavity guarantees the second equal-sized step gains less
      // than the first (a doubling-spaced sequence isn't a valid concavity
      // probe here — the wider second interval can out-gain a narrower first
      // one despite a strictly decreasing marginal rate).
      const at1 = policePerCapitaNode.compute!(ctx({ spending: { publicSafety: 418 } }));
      const at2 = policePerCapitaNode.compute!(ctx({ spending: { publicSafety: 1176.5 } }));
      const at3 = policePerCapitaNode.compute!(ctx({ spending: { publicSafety: 1935 } }));
      expect(at2).toBeGreaterThan(at1);
      expect(at3 - at2).toBeLessThan(at2 - at1);
    });
  });

  describe("crimeRate (per 100k hub)", () => {
    it("anchors at 4500 at the reference state", () => {
      expect(crimeRateNode.compute!(ctx(REF))).toBeCloseTo(4500, 5);
    });

    it("each driver moves it the right way", () => {
      const base = crimeRateNode.compute!(ctx(REF));
      const poorer = crimeRateNode.compute!(
        ctx({ ...REF, prev: { ...REF.prev, "economic.povertyRate": 20 } })
      );
      const jobless = crimeRateNode.compute!(
        ctx({ ...REF, prev: { ...REF.prev, "economic.unemploymentRate": 9 } })
      );
      const educated = crimeRateNode.compute!(
        ctx({ ...REF, current: { ...REF.current, "education.highSchoolGradRate": 95 } })
      );
      const policed = crimeRateNode.compute!(
        ctx({ ...REF, current: { ...REF.current, "publicSafety.policePerCapita": 4 } })
      );
      const unequal = crimeRateNode.compute!(
        ctx({ ...REF, current: { ...REF.current, "social.incomeInequality": 52 } })
      );
      expect(poorer).toBeGreaterThan(base);
      expect(jobless).toBeGreaterThan(base);
      expect(educated).toBeLessThan(base);
      expect(policed).toBeLessThan(base);
      expect(unequal).toBeGreaterThan(base);
    });

    it("spans the THRESHOLDS band [1500, 11000] across best/worst-case inputs", () => {
      const best = crimeRateNode.compute!(
        ctx({
          current: {
            "education.highSchoolGradRate": 95,
            "publicSafety.policePerCapita": 4.5,
            "social.incomeInequality": 30,
          },
          prev: { "economic.povertyRate": 5, "economic.unemploymentRate": 3 },
        })
      );
      const worst = crimeRateNode.compute!(
        ctx({
          current: {
            "education.highSchoolGradRate": 70,
            "publicSafety.policePerCapita": 1,
            "social.incomeInequality": 55,
          },
          prev: { "economic.povertyRate": 30, "economic.unemploymentRate": 12 },
        })
      );
      expect(best).toBeGreaterThan(800);
      expect(best).toBeLessThan(2000);
      expect(worst).toBeGreaterThan(9000);
      expect(worst).toBeLessThan(11500);
    });

    it("the poverty edge is LAGGED (reads prev, not current)", () => {
      const inputs = crimeRateNode.inputs.filter(
        (i) => typeof i !== "string" && "lagged" in i
      ) as Array<{ lagged: string }>;
      expect(inputs.map((i) => i.lagged)).toEqual(
        expect.arrayContaining(["economic.povertyRate", "economic.unemploymentRate"])
      );
    });
  });

  describe("violentCrimeRate", () => {
    it("tracks crime into the THRESHOLDS band [80, 700]", () => {
      const safe = violentCrimeRateNode.compute!(
        ctx({ current: { "publicSafety.crimeRate": 1500 } })
      );
      const ref = violentCrimeRateNode.compute!(ctx(REF));
      const bad = violentCrimeRateNode.compute!(
        ctx({ current: { "publicSafety.crimeRate": 11000 } })
      );
      expect(safe).toBeGreaterThan(30);
      expect(safe).toBeLessThan(110);
      expect(ref).toBeCloseTo(250, 5);
      expect(bad).toBeGreaterThan(600);
      expect(bad).toBeLessThan(750);
    });
  });

  describe("incarcerationRate", () => {
    it("anchors at 450 and follows LAGGED crime", () => {
      expect(incarcerationRateNode.compute!(ctx(REF))).toBeCloseTo(450, 5);
      const after = incarcerationRateNode.compute!(
        ctx({ prev: { "publicSafety.crimeRate": 9000 } })
      );
      expect(after).toBeGreaterThan(450);
      const laggedInputs = incarcerationRateNode.inputs.filter(
        (i) => typeof i !== "string" && "lagged" in i
      );
      expect(laggedInputs).toHaveLength(1);
    });
  });

  describe("recidivismRate", () => {
    it("anchors at 43; prison churn and joblessness raise it, social programs cut it", () => {
      expect(recidivismRateNode.compute!(ctx(REF))).toBeCloseTo(43, 5);
      const churn = recidivismRateNode.compute!(
        ctx({ ...REF, current: { ...REF.current, "publicSafety.incarcerationRate": 800 } })
      );
      const jobless = recidivismRateNode.compute!(
        ctx({ ...REF, current: { ...REF.current, "economic.unemploymentRate": 10 } })
      );
      const supported = recidivismRateNode.compute!(ctx({ ...REF, spending: { social: 40 } }));
      expect(churn).toBeGreaterThan(43);
      expect(jobless).toBeGreaterThan(43);
      expect(supported).toBeLessThan(43);
    });
  });

  describe("publicSafetyConfidence", () => {
    it("anchors at 58 and spans ~[26, 78] across the crime/police range", () => {
      expect(publicSafetyConfidenceNode.compute!(ctx(REF))).toBeCloseTo(58, 5);
      const good = publicSafetyConfidenceNode.compute!(
        ctx({
          current: { "publicSafety.crimeRate": 1500, "publicSafety.policePerCapita": 4.5 },
        })
      );
      const bad = publicSafetyConfidenceNode.compute!(
        ctx({ current: { "publicSafety.crimeRate": 11000, "publicSafety.policePerCapita": 1 } })
      );
      expect(good).toBeGreaterThan(70);
      expect(good).toBeLessThan(85);
      expect(bad).toBeGreaterThan(20);
      expect(bad).toBeLessThan(35);
    });
  });

  describe("registration + topo (Task 2)", () => {
    it("all 8 nodes are registered and the registry still topo-sorts (no same-turn cycle)", async () => {
      // Import throws at module load if the poverty↔crime closure created a
      // same-turn cycle (both edges are lagged, so it must not).
      const { METRIC_REGISTRY, METRIC_REGISTRY_SORTED } = await import("./index");
      const ids = new Set(METRIC_REGISTRY.map((n) => n.id));
      for (const n of PUBLIC_SAFETY_NODES) expect(ids.has(n.id), n.id).toBe(true);

      const order = new Map(METRIC_REGISTRY_SORTED.map((n, i) => [n.id, i]));
      const before = (a: string, b: string) => expect(order.get(a)!).toBeLessThan(order.get(b)!);
      before("publicSafety.policePerCapita", "publicSafety.crimeRate");
      before("social.incomeInequality", "publicSafety.crimeRate");
      before("education.highSchoolGradRate", "publicSafety.crimeRate");
      before("publicSafety.crimeRate", "publicSafety.violentCrimeRate");
      before("publicSafety.crimeRate", "publicSafety.publicSafetyConfidence");
      before("publicSafety.incarcerationRate", "publicSafety.recidivismRate");
      before("publicSafety.violentCrimeRate", "publicSafety.knifeCrimeRate");
    });

    it("povertyRate's lagged crimeRate edge resolves against the now-registered node", async () => {
      const { povertyRateNode } = await import("./economic");
      const { METRIC_REGISTRY } = await import("./index");
      const lagged = povertyRateNode.inputs.find(
        (i) => typeof i !== "string" && "lagged" in i && i.lagged === "publicSafety.crimeRate"
      );
      expect(lagged).toBeDefined();
      expect(METRIC_REGISTRY.some((n) => n.id === "publicSafety.crimeRate")).toBe(true);
    });
  });

  describe("UK specials", () => {
    it("antiSocialBehaviourRate aligns with the uniform-seed derivation (crime/800) + poverty", () => {
      expect(antiSocialBehaviourRateNode.compute!(ctx(REF))).toBeCloseTo(4500 / 800, 5);
      const poorer = antiSocialBehaviourRateNode.compute!(
        ctx({ ...REF, prev: { ...REF.prev, "economic.povertyRate": 20 } })
      );
      expect(poorer).toBeGreaterThan(4500 / 800);
    });

    it("knifeCrimeRate tracks violent crime (violent/100)", () => {
      expect(knifeCrimeRateNode.compute!(ctx(REF))).toBeCloseTo(2.5, 5);
      const worse = knifeCrimeRateNode.compute!(
        ctx({ current: { "publicSafety.violentCrimeRate": 600 } })
      );
      expect(worse).toBeCloseTo(6, 5);
    });
  });
});
