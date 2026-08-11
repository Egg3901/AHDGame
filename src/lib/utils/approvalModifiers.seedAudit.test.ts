import { describe, expect, it } from "vitest";
import { evaluateModifiers } from "@/lib/utils/approvalModifiers";
import { buildFlatMetrics } from "@/lib/utils/governmentApproval";
import { loadSeededStateMetrics } from "@/lib/states/conditions/seedMetricsLoader";

function metricsForPreset(stateId: string, preset: "2019-default" | "1991-default") {
  const countryId = "US" as const;
  const metrics = loadSeededStateMetrics(countryId, preset).find((m) => String(m._id) === stateId);
  if (!metrics) throw new Error(`missing seed metrics for ${stateId}`);
  return metrics;
}

describe("approvalModifiers — US preset calibration", () => {
  it("uses Gini index scale for inequality_crisis (>= 46, not 0.46)", () => {
    const active = evaluateModifiers({
      social: { incomeInequality: 45.9, homelessnessRate: 25 },
    });
    expect(active.some((m) => m.id === "inequality_crisis")).toBe(false);

    const crisis = evaluateModifiers({
      social: { incomeInequality: 46, homelessnessRate: 22 },
    });
    expect(crisis.some((m) => m.id === "inequality_crisis")).toBe(true);
  });

  it("tightens corruption_concerns so typical US seeds do not all qualify", () => {
    const borderline = evaluateModifiers({
      governance: { corruptionIndex: 52 },
    });
    expect(borderline.some((m) => m.id === "corruption_concerns")).toBe(false);
    const high = evaluateModifiers({
      governance: { corruptionIndex: 55 },
    });
    expect(high.some((m) => m.id === "corruption_concerns")).toBe(true);
  });

  it("fires longevity when preventableMortality is within realistic seed range", () => {
    const active = evaluateModifiers({
      healthcare: { lifeExpectancy: 82.5, preventableMortality: 275 },
    });
    expect(active.some((m) => m.id === "longevity")).toBe(true);
  });

  it("suppresses broadband-era modifiers in 1991-default", () => {
    const ca1991 = buildFlatMetrics(metricsForPreset("CA", "1991-default"));
    const active = evaluateModifiers(ca1991, { preset: "1991-default" });
    const ids = active.map((m) => m.id);
    expect(ids).not.toContain("high_broadband");
    expect(ids).not.toContain("low_broadband");
    expect(ids).not.toContain("infrastructure_boom");
    expect(ca1991.infrastructure?.broadbandAccess).toBe(0);
  });

  it("uses era1991 COL thresholds for affordable_living", () => {
    expect(
      evaluateModifiers({ economic: { costOfLiving: 85 } }, { preset: "2019-default" }).some(
        (m) => m.id === "affordable_living"
      )
    ).toBe(true);
    expect(
      evaluateModifiers({ economic: { costOfLiving: 48 } }, { preset: "1991-default" }).some(
        (m) => m.id === "affordable_living"
      )
    ).toBe(true);
    expect(
      evaluateModifiers({ economic: { costOfLiving: 55 } }, { preset: "1991-default" }).some(
        (m) => m.id === "affordable_living"
      )
    ).toBe(false);
    expect(
      evaluateModifiers(
        { economic: { costOfLiving: 72, povertyRate: 18 } },
        { preset: "1991-default" }
      ).some((m) => m.id === "cost_of_living_crisis")
    ).toBe(true);
  });

  it("attaches marginEffect to active metric modifiers", () => {
    const active = evaluateModifiers(
      { economic: { unemploymentRate: 3.0 } },
      { preset: "2019-default" }
    );
    const lowUnemployment = active.find((m) => m.id === "low_unemployment");
    expect(lowUnemployment?.marginEffect).toBe(0.8);
    expect(lowUnemployment?.source).toBe("metric");
  });
});

describe("approvalModifiers — US seed audit", () => {
  const sampleStates = ["CA", "TX", "NY", "MS", "DC"];

  it("does not mass-fire corruption_concerns on 2019 US seeds", () => {
    let fired = 0;
    for (const stateId of sampleStates) {
      const flat = buildFlatMetrics(metricsForPreset(stateId, "2019-default"));
      if (
        evaluateModifiers(flat, { preset: "2019-default" }).some(
          (m) => m.id === "corruption_concerns"
        )
      ) {
        fired++;
      }
    }
    expect(fired).toBeLessThan(sampleStates.length);
  });

  it("clamps 1991 media metrics and uses lowered polarization thresholds", () => {
    for (const stateId of sampleStates) {
      const flat = buildFlatMetrics(metricsForPreset(stateId, "1991-default"));
      expect(flat.mediaInformation?.mediaPolarization ?? 0).toBeLessThanOrEqual(35);
      expect(flat.mediaInformation?.disinformationRisk ?? 0).toBeLessThanOrEqual(20);
      const active = evaluateModifiers(flat, { preset: "1991-default" });
      const polarization = flat.mediaInformation?.mediaPolarization ?? 0;
      if (polarization < 28) {
        expect(active.some((m) => m.id === "media_polarization")).toBe(false);
        expect(active.some((m) => m.id === "information_disorder")).toBe(false);
      }
    }
  });

  it("avoids inequality_crisis on typical seeded states unless both thresholds met", () => {
    for (const stateId of sampleStates) {
      for (const preset of ["2019-default", "1991-default"] as const) {
        const metrics = metricsForPreset(stateId, preset);
        const flat = buildFlatMetrics(metrics);
        const gini = flat.social?.incomeInequality;
        const homeless = flat.social?.homelessnessRate;
        const active = evaluateModifiers(flat, { preset });
        if (gini == null || gini < 46 || homeless == null || homeless < 22) {
          expect(active.some((m) => m.id === "inequality_crisis")).toBe(false);
        }
      }
    }
  });
});
