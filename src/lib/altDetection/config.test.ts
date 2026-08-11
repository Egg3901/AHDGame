import { describe, it, expect } from "vitest";
import {
  DEFAULT_ALT_SCORING_THRESHOLDS,
  DEFAULT_ALT_SCORING_WEIGHTS,
  resolveAltScoringConfig,
} from "./config";

describe("resolveAltScoringConfig", () => {
  it("returns conservative defaults when no override is given", () => {
    const config = resolveAltScoringConfig();
    expect(config.weights).toEqual(DEFAULT_ALT_SCORING_WEIGHTS);
    expect(config.thresholds).toEqual(DEFAULT_ALT_SCORING_THRESHOLDS);
    expect(config.weights.oauth_shared).toBe(0.97);
    expect(config.weights.device_fingerprint_exact).toBe(0.95);
    expect(config.weights.deviceKey_exact).toBe(0.93);
    expect(config.weights.trackingId_exact).toBe(0.9);
    expect(config.weights.device_fingerprint_fuzzy).toBe(0.2);
    expect(config.weights.coordinated_funding).toBe(0.6);
    expect(config.weights.wire_graph_link).toBe(0.35);
    expect(config.weights.ip_exact_nonCF).toBe(0.35);
    expect(config.weights.coordinated_login_timing).toBe(0.35);
    expect(config.weights.login_time_cluster).toBe(0.3);
    expect(config.weights.behavioral_similarity).toBe(0.3);
    expect(config.weights.email_pattern_family).toBe(0.3);
    expect(config.weights.referral_link).toBe(0.15);
    expect(config.weights["subnet_/24_share"]).toBe(0.15);
    // forensics-v2 Wave 1 additions
    expect(config.weights.payment_correlation).toBe(0.92);
    expect(config.weights.email_alias_match).toBe(0.85);
    expect(config.weights.impossible_travel).toBe(0.5);
    expect(config.weights.ip_intelligence).toBe(0.2);
    // forensics-v2 Part A addition (server-side Cloudflare fingerprint)
    expect(config.weights.cf_tls_fingerprint).toBe(0.25);
    expect(config.thresholds.cluster).toBe(0.75);
    expect(config.weights.device_fingerprint_fuzzy).toBeLessThan(config.thresholds.link);
    expect(config.weights.cf_tls_fingerprint).toBeLessThan(config.thresholds.link);
    for (const value of Object.values(config.weights)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it("also returns defaults with an explicit null override (fail-closed)", () => {
    expect(resolveAltScoringConfig(null)).toEqual(resolveAltScoringConfig());
  });

  it("applies a partial weight override without disturbing other signals", () => {
    const config = resolveAltScoringConfig({ weights: { oauth_shared: 0.99 } });
    expect(config.weights.oauth_shared).toBe(0.99);
    expect(config.weights.device_fingerprint_exact).toBe(
      DEFAULT_ALT_SCORING_WEIGHTS.device_fingerprint_exact
    );
  });

  it("applies a partial threshold override", () => {
    const config = resolveAltScoringConfig({ thresholds: { cluster: 0.75 } });
    expect(config.thresholds.cluster).toBe(0.75);
    expect(config.thresholds.link).toBe(DEFAULT_ALT_SCORING_THRESHOLDS.link);
  });

  it("drops out-of-range or malformed override values (fail-closed)", () => {
    const config = resolveAltScoringConfig({
      weights: {
        oauth_shared: 1.5,
        referral_link: -1,
        deviceKey_exact: "nope" as unknown as number,
      },
      thresholds: { link: Number.NaN },
    });
    expect(config.weights.oauth_shared).toBe(DEFAULT_ALT_SCORING_WEIGHTS.oauth_shared);
    expect(config.weights.referral_link).toBe(DEFAULT_ALT_SCORING_WEIGHTS.referral_link);
    expect(config.weights.deviceKey_exact).toBe(DEFAULT_ALT_SCORING_WEIGHTS.deviceKey_exact);
    expect(config.thresholds.link).toBe(DEFAULT_ALT_SCORING_THRESHOLDS.link);
  });

  it("ignores unknown keys in the override", () => {
    const config = resolveAltScoringConfig({
      weights: { not_a_real_signal: 0.5 } as unknown as Record<string, number>,
    });
    expect(config.weights).toEqual(DEFAULT_ALT_SCORING_WEIGHTS);
  });
});
