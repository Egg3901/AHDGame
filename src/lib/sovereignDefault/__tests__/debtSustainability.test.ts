import { describe, it, expect } from "vitest";
import { computeDsa, type DsaInputs } from "../debtSustainability";

const healthyBaseline: DsaInputs = {
  debtToGdp: 0.5, // below floor
  primarySurplusToGdp: 0,
  fxDepreciation10t: 0,
  annualGdpGrowth: 0,
};

describe("computeDsa", () => {
  it("baseline healthy economy → 80 (the baseline)", () => {
    const r = computeDsa(healthyBaseline);
    expect(r.score).toBe(80);
    expect(r.band).toBe("healthy");
  });

  it("D/GDP at the ceiling (200%) bottoms the dgdp component at -50", () => {
    const r = computeDsa({ ...healthyBaseline, debtToGdp: 2.0 });
    const dgdp = r.components.find((c) => c.id === "dgdp")!;
    expect(dgdp.contribution).toBe(-50);
  });

  it("D/GDP above ceiling clamps at -50 (no overflow)", () => {
    const r = computeDsa({ ...healthyBaseline, debtToGdp: 5.0 });
    const dgdp = r.components.find((c) => c.id === "dgdp")!;
    expect(dgdp.contribution).toBe(-50);
  });

  it("primary surplus boosts score, deficit penalizes", () => {
    const surplus = computeDsa({ ...healthyBaseline, primarySurplusToGdp: 0.02 });
    const deficit = computeDsa({ ...healthyBaseline, primarySurplusToGdp: -0.02 });
    expect(surplus.score).toBeGreaterThan(80);
    expect(deficit.score).toBeLessThan(80);
  });

  it("primary balance contributions cap at +15 / -25", () => {
    const bigSurplus = computeDsa({ ...healthyBaseline, primarySurplusToGdp: 0.1 });
    expect(bigSurplus.components.find((c) => c.id === "primary-balance")!.contribution).toBe(15);
    const bigDeficit = computeDsa({ ...healthyBaseline, primarySurplusToGdp: -0.1 });
    expect(bigDeficit.components.find((c) => c.id === "primary-balance")!.contribution).toBe(-25);
  });

  it("FX depreciation below 5% threshold has no effect", () => {
    const r = computeDsa({ ...healthyBaseline, fxDepreciation10t: 0.03 });
    const fx = r.components.find((c) => c.id === "fx")!;
    expect(fx.contribution).toBe(0);
  });

  it("FX depreciation at ceiling (25%) bottoms at -25", () => {
    const r = computeDsa({ ...healthyBaseline, fxDepreciation10t: 0.25 });
    const fx = r.components.find((c) => c.id === "fx")!;
    expect(fx.contribution).toBe(-25);
  });

  it("strong negative growth overwhelms even a healthy fiscal posture", () => {
    const r = computeDsa({
      ...healthyBaseline,
      annualGdpGrowth: -0.05, // -5% recession
      primarySurplusToGdp: 0.03,
    });
    expect(r.score).toBeLessThan(80);
  });

  it("strong growth boosts score above baseline", () => {
    const r = computeDsa({ ...healthyBaseline, annualGdpGrowth: 0.05 });
    expect(r.score).toBeGreaterThan(80);
  });

  it("band thresholds: healthy ≥ 80, warning [50,80), at-risk [30,50), crisis < 30", () => {
    // baseline: 80 (healthy)
    expect(computeDsa({ ...healthyBaseline }).band).toBe("healthy");
    // D/GDP=1.0 → 80 - 14.3 = 65.7 (warning)
    expect(computeDsa({ ...healthyBaseline, debtToGdp: 1.0 }).band).toBe("warning");
    // D/GDP=1.5 → 80 - 32.1 = 47.9 (at-risk)
    expect(computeDsa({ ...healthyBaseline, debtToGdp: 1.5 }).band).toBe("at-risk");
    // Multi-factor disaster → crisis
    expect(
      computeDsa({
        debtToGdp: 2.5,
        primarySurplusToGdp: -0.1,
        fxDepreciation10t: 0.3,
        annualGdpGrowth: -0.05,
      }).band
    ).toBe("crisis");
  });

  it("Argentina-2001-like collapse: high D/GDP + huge deficit + FX collapse + recession → crisis band", () => {
    const r = computeDsa({
      debtToGdp: 1.6,
      primarySurplusToGdp: -0.06,
      fxDepreciation10t: 0.4,
      annualGdpGrowth: -0.1,
    });
    expect(r.band).toBe("crisis");
    expect(r.score).toBeLessThan(30);
  });

  it("Japan-like: high D/GDP but stable currency + balanced budget → still warning, not crisis", () => {
    const r = computeDsa({
      debtToGdp: 2.5, // very high
      primarySurplusToGdp: 0.0,
      fxDepreciation10t: 0,
      annualGdpGrowth: 0.005, // 0.5% growth
    });
    // Score = 80 - 50 (D/GDP capped) + 0 + 0 + ~1.7 (growth) = ~31.7 → at-risk band
    expect(r.score).toBeGreaterThan(30);
    expect(r.score).toBeLessThan(50);
    expect(r.band).toBe("at-risk");
  });

  it("deterministic: same inputs → same output", () => {
    const a = computeDsa({ ...healthyBaseline, debtToGdp: 1.2 });
    const b = computeDsa({ ...healthyBaseline, debtToGdp: 1.2 });
    expect(a).toEqual(b);
  });
});
