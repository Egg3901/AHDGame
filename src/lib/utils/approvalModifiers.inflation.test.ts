import { describe, expect, it } from "vitest";
import {
  applyModifiers,
  evaluateModifiers,
  POSITIVE_MODIFIER_NET_CAP,
  type ActiveModifier,
} from "@/lib/utils/approvalModifiers";
import {
  buildFlatMetrics,
  calculateStateApproval,
  computeNationalAveragesFromMetrics,
  computeStateApprovalBase,
} from "@/lib/utils/governmentApproval";
import { loadSeededStateMetrics } from "@/lib/states/conditions/seedMetricsLoader";

/**
 * Seed-day approval inflation guards (1953 freefire + positive stack cap).
 *
 * Seams: evaluateModifiers thresholds, applyModifiers net-positive cap,
 * usMetricPresets1953 overlays via loadSeededStateMetrics("US","1953-default").
 */

const FREEFIRE_BADGES = [
  "affordable_housing",
  "economic_freedom",
  "strong_defense",
  "national_confidence",
  "secure_border",
  "broad_firearm_rights",
] as const;

describe("approval inflation — positive modifier net cap", () => {
  it("exports a positive net cap of 8", () => {
    expect(POSITIVE_MODIFIER_NET_CAP).toBe(8);
  });

  it("caps stacked positive effects at POSITIVE_MODIFIER_NET_CAP", () => {
    const modifiers: ActiveModifier[] = Array.from({ length: 12 }, (_, i) => ({
      id: `pos_${i}`,
      label: `Pos ${i}`,
      effect: 1,
    }));
    expect(applyModifiers(50, modifiers)).toBe(50 + POSITIVE_MODIFIER_NET_CAP);
  });

  it("does not cap negative stacks (crises still stack)", () => {
    const modifiers: ActiveModifier[] = Array.from({ length: 10 }, (_, i) => ({
      id: `neg_${i}`,
      label: `Neg ${i}`,
      effect: -2,
    }));
    expect(applyModifiers(50, modifiers)).toBe(30); // 50 - 20, uncapped
  });

  it("caps only the positive side of a mixed stack", () => {
    const modifiers: ActiveModifier[] = [
      ...Array.from({ length: 10 }, (_, i) => ({
        id: `pos_${i}`,
        label: `Pos ${i}`,
        effect: 1,
      })),
      { id: "crisis", label: "Crisis", effect: -3 },
    ];
    // +10 capped to +8, then -3 → net +5
    expect(applyModifiers(50, modifiers)).toBe(55);
  });
});

describe("approval inflation — 1953 US seed freefire", () => {
  const sample = ["CA", "TX", "NY", "MS", "WY"];

  it("does not mass-fire the six historically-free badges on 1953 US seeds", () => {
    const metrics = loadSeededStateMetrics("US", "1953-default");
    for (const badge of FREEFIRE_BADGES) {
      let fired = 0;
      for (const stateId of sample) {
        const doc = metrics.find((m) => String(m._id) === stateId);
        expect(doc, stateId).toBeTruthy();
        const active = evaluateModifiers(buildFlatMetrics(doc!), {
          preset: "1953-default",
          countryId: "US",
          year: 1953,
        });
        if (active.some((m) => m.id === badge)) fired++;
      }
      expect(fired, `${badge} freefire count`).toBe(0);
    }
  });

  // Floor lowered 50 → 48 by the P5 era-band pass. The bands the US used to
  // score against were the modern ones, and it sat near the ceiling of several
  // that the 1953 world led elsewhere: productivity growth 3.5% scored 92 in an
  // era when Japan ran 8% and Germany 7.5%, and postwar debt of 68% of GDP
  // scored 66. Re-banding moved seed-day US mean ~1.5 points, to 49.5. The
  // inflation guards below — the 56 ceiling, no state ≥65, max <62 — are the
  // point of this test and are unchanged.
  it("keeps seed-day US mean final approval in the 48–56 band", () => {
    const metrics = loadSeededStateMetrics("US", "1953-default");
    // Pass the real docs: `population` is a metric category, not a count, and
    // national averages are unweighted — a scalar spread only clobbered it.
    const nationalAvgs = computeNationalAveragesFromMetrics(metrics);
    const finals: number[] = [];
    for (const m of metrics) {
      finals.push(calculateStateApproval(m, nationalAvgs, [], undefined, "1953-default", 1953));
    }
    const mean = finals.reduce((a, b) => a + b, 0) / finals.length;
    expect(mean).toBeGreaterThanOrEqual(48);
    expect(mean).toBeLessThanOrEqual(56);
    // Cap + strong seed metrics can still put a best-in-class state at ~60;
    // "high" approval (≥65) must not appear on an untouched seed day.
    expect(finals.filter((x) => x >= 65).length).toBe(0);
    expect(Math.max(...finals)).toBeLessThan(62);
  });

  it("metric base alone still centers near 50 (modifiers are the only inflation risk)", () => {
    const metrics = loadSeededStateMetrics("US", "1953-default");
    // Pass the real docs: `population` is a metric category, not a count, and
    // national averages are unweighted — a scalar spread only clobbered it.
    const nationalAvgs = computeNationalAveragesFromMetrics(metrics);
    const bases = metrics.map((m) =>
      computeStateApprovalBase(m, nationalAvgs, undefined, "1953-default", 1953)
    );
    const mean = bases.reduce((a, b) => a + b, 0) / bases.length;
    expect(mean).toBeGreaterThan(48);
    expect(mean).toBeLessThan(52);
  });
});

describe("approval inflation — right-lane badges still reachable", () => {
  it("fire after a full-strength swing above the retargeted thresholds", () => {
    // broad_firearm_rights ≥ 88; secure_border ≥ 62 (unchanged).
    // 2019 SOUTH seed ~82 + state gun law swing (~+12) ⇒ ~94.
    const active = evaluateModifiers({
      publicSafety: { firearmRights: 88 },
      governance: { borderSecurity: 62.8 },
    });
    const ids = new Set(active.map((m) => m.id));
    expect(ids.has("broad_firearm_rights")).toBe(true);
    expect(ids.has("secure_border")).toBe(true);
  });

  it("do not fire at untouched 2019 national averages", () => {
    const active = evaluateModifiers({
      publicSafety: { firearmRights: 68 },
      governance: { borderSecurity: 52 },
    });
    const ids = new Set(active.map((m) => m.id));
    expect(ids.has("broad_firearm_rights")).toBe(false);
    expect(ids.has("secure_border")).toBe(false);
  });
});
