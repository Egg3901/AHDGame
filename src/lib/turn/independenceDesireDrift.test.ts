import { describe, it, expect } from "vitest";
import { computeIndependenceDesireDriftSnapshot } from "@/lib/turn/independenceDesireDrift";

describe("computeIndependenceDesireDriftSnapshot", () => {
  // The shared `neutral` fixture sits at every driver's zero-contribution
  // point: previous === MEAN_REVERSION_TARGET (25), approvals at the 50%
  // mid-band, mid-band inflation, and pro-devolution policy.
  const neutral = {
    previous: 25,
    policy: "pro" as const,
    regionalApproval: 50, // distance 0 → 0
    nationalApproval: 50, // distance 0 → 0
    inflationPercent: 2.5, // mid-band → 0
  };

  it("zero drift at all-neutral inputs", () => {
    const r = computeIndependenceDesireDriftSnapshot(neutral);
    expect(r.delta).toBe(0);
    expect(r.next).toBe(25);
    expect(r.drivers.policy).toBe(0);
    expect(r.drivers.regionalApproval).toBe(0);
    expect(r.drivers.nationalApproval).toBe(0);
    expect(r.drivers.inflation).toBe(0);
    expect(r.drivers.meanReversion).toBe(0);
  });

  it("pro-indy FM pushes positive", () => {
    const r = computeIndependenceDesireDriftSnapshot({ ...neutral, policy: "independence" });
    expect(r.drivers.policy).toBeCloseTo(0.05, 5);
    expect(r.delta).toBeCloseTo(0.05, 5);
  });

  it("anti-devolution FM pushes negative", () => {
    const r = computeIndependenceDesireDriftSnapshot({ ...neutral, policy: "anti" });
    expect(r.drivers.policy).toBeCloseTo(-0.04, 5);
    expect(r.delta).toBeCloseTo(-0.04, 5);
  });

  it("regional approval is directional: a popular separatist FM raises desire", () => {
    const r = computeIndependenceDesireDriftSnapshot({
      ...neutral,
      policy: "independence",
      regionalApproval: 60,
    });
    expect(r.drivers.regionalApproval).toBeCloseTo(0.01, 5); // +10pts mandate × +1
  });

  it("regional approval is directional: a popular unionist FM lowers desire", () => {
    const r = computeIndependenceDesireDriftSnapshot({
      ...neutral,
      policy: "anti",
      regionalApproval: 60,
    });
    expect(r.drivers.regionalApproval).toBeCloseTo(-0.01, 5); // +10pts mandate × −1
  });

  it("regional approval inverts when the govt is rejected (unpopular separatist FM)", () => {
    const r = computeIndependenceDesireDriftSnapshot({
      ...neutral,
      policy: "independence",
      regionalApproval: 40,
    });
    expect(r.drivers.regionalApproval).toBeCloseTo(-0.01, 5); // −10pts rejection × +1
  });

  it("regional approval inverts: an unpopular unionist FM stokes backlash", () => {
    const r = computeIndependenceDesireDriftSnapshot({
      ...neutral,
      policy: "anti",
      regionalApproval: 40,
    });
    expect(r.drivers.regionalApproval).toBeCloseTo(0.01, 5); // −10pts rejection × −1
  });

  it("Pro-Devolution is neutral: regional approval never moves desire", () => {
    for (const regionalApproval of [0, 30, 70, 100]) {
      const r = computeIndependenceDesireDriftSnapshot({
        ...neutral,
        policy: "pro",
        regionalApproval,
      });
      expect(r.drivers.regionalApproval).toBe(0);
    }
  });

  it("regional approval truncates fractional points (51.9 acts as 51)", () => {
    const r = computeIndependenceDesireDriftSnapshot({
      ...neutral,
      policy: "independence",
      regionalApproval: 51.9,
    });
    expect(r.drivers.regionalApproval).toBeCloseTo(0.001, 5);
  });

  it("Westminster approval above 50 suppresses drift", () => {
    const r = computeIndependenceDesireDriftSnapshot({ ...neutral, nationalApproval: 70 });
    expect(r.drivers.nationalApproval).toBeCloseTo(-0.02, 5);
  });

  it("Westminster approval at 100% gives -0.050/turn", () => {
    const r = computeIndependenceDesireDriftSnapshot({ ...neutral, nationalApproval: 100 });
    expect(r.drivers.nationalApproval).toBeCloseTo(-0.05, 5);
  });

  it("approval exactly at 50 contributes zero", () => {
    const r = computeIndependenceDesireDriftSnapshot({
      ...neutral,
      regionalApproval: 50,
      nationalApproval: 50,
    });
    expect(r.drivers.regionalApproval).toBe(0);
    expect(r.drivers.nationalApproval).toBe(0);
  });

  it("high inflation boosts drift positive", () => {
    const r = computeIndependenceDesireDriftSnapshot({ ...neutral, inflationPercent: 6 });
    expect(r.drivers.inflation).toBeCloseTo(0.02, 5);
  });

  it("mean reversion pulls values above 25 down toward the baseline", () => {
    const r = computeIndependenceDesireDriftSnapshot({ ...neutral, previous: 80 });
    expect(r.drivers.meanReversion).toBeCloseTo(-0.003, 5);
  });

  it("mean reversion pulls values below 25 up toward the baseline", () => {
    const r = computeIndependenceDesireDriftSnapshot({ ...neutral, previous: 10 });
    expect(r.drivers.meanReversion).toBeCloseTo(0.003, 5);
  });

  it("mean reversion is zero exactly at the baseline (25)", () => {
    const r = computeIndependenceDesireDriftSnapshot({ ...neutral, previous: 25 });
    expect(r.drivers.meanReversion).toBe(0);
  });

  it("clamps next value to [0, 100]", () => {
    const r = computeIndependenceDesireDriftSnapshot({
      previous: 99.9,
      policy: "independence",
      regionalApproval: 100, // popular separatist FM → +0.05 mandate
      nationalApproval: 0, // grievance against Westminster → +0.05
      inflationPercent: 6,
    });
    expect(r.next).toBe(100);
  });

  it("max-positive run saturates near +0.17/turn", () => {
    // Anchored at the baseline (25) so mean reversion contributes zero. Max
    // positive = a hugely popular separatist FM (regional mandate) + grievance
    // against Westminster + high inflation.
    const r = computeIndependenceDesireDriftSnapshot({
      previous: 25,
      policy: "independence",
      regionalApproval: 100, // mandate × +1 → +0.05
      nationalApproval: 0, // Westminster grievance → +0.05
      inflationPercent: 6,
    });
    // 0.05 (policy) + 0.05 (regional) + 0.05 (national) + 0.02 (inflation) + 0 (mean) = 0.17
    expect(r.delta).toBeCloseTo(0.17, 5);
  });

  it("max-negative run (both approvals at 100%) floors near -0.15/turn", () => {
    // Anchored at the baseline so mean reversion is zero and the four
    // negative drivers stack cleanly.
    const r = computeIndependenceDesireDriftSnapshot({
      previous: 25,
      policy: "anti",
      regionalApproval: 100,
      nationalApproval: 100,
      inflationPercent: 1,
    });
    // -0.04 (policy) + -0.05 (regional) + -0.05 (national) + -0.01 (inflation) + 0 (mean) = -0.15
    expect(r.delta).toBeCloseTo(-0.15, 5);
  });
});
