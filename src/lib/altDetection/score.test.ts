import { describe, it, expect } from "vitest";
import { scoreLink, type ScorableSignal } from "./score";

const NOW = new Date("2026-07-20T12:00:00Z");

function signal(type: ScorableSignal["type"], weight: number): ScorableSignal {
  return { type, weight, evidence: `${type} evidence`, detectedAt: NOW };
}

describe("scoreLink (noisy-OR)", () => {
  it("returns 0 confidence and no contributions for an empty signal set", () => {
    const result = scoreLink([]);
    expect(result.confidence).toBe(0);
    expect(result.contributions).toEqual([]);
  });

  it("a single signal's confidence equals its weight", () => {
    const result = scoreLink([signal("ip_exact_nonCF", 0.35)]);
    expect(result.confidence).toBeCloseTo(0.35, 10);
    expect(result.contributions[0].contribution).toBeCloseTo(0.35, 10);
  });

  it("one definitive signal alone saturates confidence near its own weight (~0.97)", () => {
    const result = scoreLink([signal("oauth_shared", 0.97)]);
    expect(result.confidence).toBeCloseTo(0.97, 10);
  });

  it("a definitive signal plus weak signals barely moves past the definitive weight", () => {
    const withExtras = scoreLink([
      signal("oauth_shared", 0.97),
      signal("referral_link", 0.15),
      signal("subnet_/24_share", 0.15),
    ]);
    const alone = scoreLink([signal("oauth_shared", 0.97)]);
    expect(withExtras.confidence).toBeGreaterThan(alone.confidence);
    expect(withExtras.confidence).toBeLessThan(0.99);
  });

  it("three weak signals accumulate but stay below 1", () => {
    const result = scoreLink([
      signal("ip_exact_nonCF", 0.35),
      signal("login_time_cluster", 0.3),
      signal("behavioral_similarity", 0.3),
    ]);
    // P = 1 - (0.65 * 0.7 * 0.7) = 1 - 0.3185 = 0.6815
    expect(result.confidence).toBeCloseTo(0.6815, 10);
    expect(result.confidence).toBeLessThan(1);
    // Each weak signal alone is well below the aggregate — they're accumulating.
    for (const c of result.contributions) {
      expect(c.contribution).toBeGreaterThan(0);
      expect(c.contribution).toBeLessThan(result.confidence);
    }
  });

  it("contributions are the exact marginal P - P_without_i (sum-checkable by recomputation)", () => {
    const weights = [0.35, 0.3, 0.3];
    const signals = [
      signal("ip_exact_nonCF", weights[0]),
      signal("login_time_cluster", weights[1]),
      signal("behavioral_similarity", weights[2]),
    ];
    const result = scoreLink(signals);

    for (let i = 0; i < signals.length; i++) {
      const without = weights.filter((_, j) => j !== i);
      const pWithout = 1 - without.reduce((p, w) => p * (1 - w), 1);
      expect(result.contributions[i].contribution).toBeCloseTo(result.confidence - pWithout, 10);
    }
  });

  it("a zero-weight (guarded) signal contributes exactly 0 and does not move confidence", () => {
    const withGuard = scoreLink([
      signal("ip_exact_nonCF", 0.35),
      signal("device_fingerprint_exact", 0),
    ]);
    const withoutGuard = scoreLink([signal("ip_exact_nonCF", 0.35)]);
    expect(withGuard.confidence).toBeCloseTo(withoutGuard.confidence, 10);
    const guardedContribution = withGuard.contributions.find(
      (c) => c.type === "device_fingerprint_exact"
    );
    expect(guardedContribution?.contribution).toBeCloseTo(0, 10);
  });

  it("clamps out-of-range weights defensively", () => {
    const result = scoreLink([signal("oauth_shared", 1.5), signal("referral_link", -0.2)]);
    expect(result.confidence).toBeCloseTo(1, 10);
    expect(result.contributions[1].weight).toBe(0);
  });
});
