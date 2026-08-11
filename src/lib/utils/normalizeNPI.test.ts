import { describe, it, expect } from "vitest";
import {
  normalizeNPI,
  normalizeNationalReachPresidentialPrimary,
  PRESIDENTIAL_PRIMARY_NATIONAL_REACH_TAU,
  PRESIDENTIAL_PRIMARY_TEMP_NPI_CAP,
  PRESIDENTIAL_PRIMARY_USE_DIMINISHING_RETURNS,
} from "./normalizeNPI";

describe("normalizeNPI (sqrt curve, hard-capped at 1.0)", () => {
  it("returns 0 at PI=0", () => {
    expect(normalizeNPI(0)).toBe(0);
  });

  it("returns 1.0 at PI=100", () => {
    expect(normalizeNPI(100)).toBeCloseTo(1, 10);
  });

  it("clamps above 100 to 1.0", () => {
    expect(normalizeNPI(200)).toBe(1);
    expect(normalizeNPI(1000)).toBe(1);
    expect(normalizeNPI(100000)).toBe(1);
  });

  it("clamps negative input to 0", () => {
    expect(normalizeNPI(-10)).toBe(0);
    expect(normalizeNPI(-50)).toBe(0);
  });

  it("PI=85 maps to sqrt(0.85) ≈ 0.922", () => {
    expect(normalizeNPI(85)).toBeCloseTo(Math.sqrt(0.85), 6);
  });

  it("PI=99 maps to sqrt(0.99) ≈ 0.995", () => {
    expect(normalizeNPI(99)).toBeCloseTo(Math.sqrt(0.99), 6);
  });

  it("PI=85 vs PI=99 spreads to ~1.8 pts on a 25-pt scale", () => {
    const gap25 = (normalizeNPI(99) - normalizeNPI(85)) * 25;
    expect(gap25).toBeGreaterThan(1.5);
    expect(gap25).toBeLessThan(2.0);
  });

  it("is monotonically non-decreasing across the 0..100 range", () => {
    let prev = -Infinity;
    for (let pi = 0; pi <= 100; pi += 5) {
      const v = normalizeNPI(pi);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});

describe("normalizeNationalReachPresidentialPrimary (diminishing-returns curve)", () => {
  it("returns 0 for NPI 0", () => {
    expect(normalizeNationalReachPresidentialPrimary(0)).toBeCloseTo(0, 5);
  });

  it("approaches but never reaches 1.0 (no hard cap under diminishing returns)", () => {
    // 1 − e^(−100/45) ≈ 0.892
    expect(
      normalizeNationalReachPresidentialPrimary(PRESIDENTIAL_PRIMARY_TEMP_NPI_CAP)
    ).toBeCloseTo(0.892, 2);
    // 1 − e^(−400/45) ≈ 0.99988 — still strictly < 1
    expect(normalizeNationalReachPresidentialPrimary(400)).toBeLessThan(1);
    expect(normalizeNationalReachPresidentialPrimary(400)).toBeGreaterThan(0.99);
  });

  it("is strictly increasing across the full range", () => {
    const a = normalizeNationalReachPresidentialPrimary(50);
    const b = normalizeNationalReachPresidentialPrimary(100);
    expect(b).toBeGreaterThan(a);
    // Distinct values above 100 — no longer saturates at the cap.
    const c = normalizeNationalReachPresidentialPrimary(200);
    expect(c).toBeGreaterThan(b);
  });

  it("flag is enabled — uses 1 − exp(−PI/τ) curve", () => {
    expect(PRESIDENTIAL_PRIMARY_USE_DIMINISHING_RETURNS).toBe(true);
    const x = 60;
    const expected = 1 - Math.exp(-x / PRESIDENTIAL_PRIMARY_NATIONAL_REACH_TAU);
    expect(normalizeNationalReachPresidentialPrimary(x)).toBeCloseTo(expected, 6);
  });

  it("at PI=55 the diminishing curve is closer to sqrt than to linear", () => {
    // Linear primary would give 0.55; sqrt curve gives ~0.74; diminishing gives ~0.706.
    // The diminishing curve sits between linear and sqrt — much closer to sqrt.
    const dim = normalizeNationalReachPresidentialPrimary(55);
    const sqrt = normalizeNPI(55);
    expect(Math.abs(dim - sqrt)).toBeLessThan(0.05);
    expect(dim).toBeGreaterThan(0.55);
  });

  it("documented endpoints land within tolerance", () => {
    expect(normalizeNationalReachPresidentialPrimary(25)).toBeCloseTo(0.426, 2);
    expect(normalizeNationalReachPresidentialPrimary(80)).toBeCloseTo(0.831, 2);
  });
});
