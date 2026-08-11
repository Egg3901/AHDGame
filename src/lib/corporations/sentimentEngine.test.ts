import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import {
  getPulseImpact,
  pulseAppliesToCorp,
  computeSentimentMultiplier,
  getHqConfidenceSentiment,
  HQ_CONFIDENCE_BASELINE,
  HQ_CONFIDENCE_SENTIMENT_CAP,
  SENTIMENT_CAP,
  PRICE_UPDATE_INTERVAL_MS,
} from "./sentimentEngine";
import { ftaPairKey, type FtaPairSet } from "@/lib/tariffs/ftaOverrides";
import type { SentimentPulse } from "@/lib/db/types/sentimentPulse";

function makePulse(overrides: Partial<SentimentPulse> = {}): SentimentPulse {
  return {
    _id: new ObjectId(),
    scope: "all",
    initialImpact: 0.1,
    decayRate: 0.8,
    createdAt: new Date(0),
    eventType: "test",
    ...overrides,
  };
}

const NOW = new Date(0); // t=0 → 0 intervals elapsed
const keys = (...pairs: string[]) => new Set(pairs);

describe("getPulseImpact", () => {
  it("returns initialImpact at t=0 (0 intervals elapsed)", () => {
    const pulse = makePulse({ initialImpact: 0.1, decayRate: 0.8 });
    expect(getPulseImpact(pulse, NOW)).toBeCloseTo(0.1, 6);
  });

  it("decays by decayRate each interval", () => {
    const pulse = makePulse({ initialImpact: 0.1, decayRate: 0.8 });
    const after1 = new Date(PRICE_UPDATE_INTERVAL_MS);
    expect(getPulseImpact(pulse, after1)).toBeCloseTo(0.1 * 0.8, 6);
  });

  it("decays to near zero after many intervals", () => {
    const pulse = makePulse({ initialImpact: 0.2, decayRate: 0.75 });
    const after30 = new Date(30 * PRICE_UPDATE_INTERVAL_MS);
    expect(Math.abs(getPulseImpact(pulse, after30))).toBeLessThan(0.001);
  });

  it("handles negative impacts (they decay toward zero, not further negative)", () => {
    const pulse = makePulse({ initialImpact: -0.2, decayRate: 0.8 });
    const after1 = new Date(PRICE_UPDATE_INTERVAL_MS);
    expect(getPulseImpact(pulse, after1)).toBeCloseTo(-0.2 * 0.8, 6);
    // Still negative after decay
    expect(getPulseImpact(pulse, after1)).toBeLessThan(0);
  });
});

describe("pulseAppliesToCorp", () => {
  it("scope=all applies to every corp", () => {
    const pulse = makePulse({ scope: "all" });
    expect(pulseAppliesToCorp(pulse, "corp1", "US", ["manufacturing"])).toBe(true);
  });

  it("scope=country matches on countryId", () => {
    const pulse = makePulse({ scope: "country", countryId: "US" });
    expect(pulseAppliesToCorp(pulse, "corp1", "US", ["manufacturing"])).toBe(true);
    expect(pulseAppliesToCorp(pulse, "corp2", "UK", ["manufacturing"])).toBe(false);
  });

  it("scope=sector matches on any of the corp's sector types", () => {
    const pulse = makePulse({ scope: "sector", sectorType: "energy" });
    expect(pulseAppliesToCorp(pulse, "corp1", "US", ["manufacturing", "energy"])).toBe(true);
    expect(pulseAppliesToCorp(pulse, "corp2", "US", ["retail"])).toBe(false);
  });

  it("scope=sector with countryId follows actual operating sectors, not HQ alone", () => {
    const pulse = makePulse({ scope: "sector", countryId: "US", sectorType: "energy" });
    expect(
      pulseAppliesToCorp(pulse, "corp1", "UK", ["energy"], keys("US:energy", "UK:retail"))
    ).toBe(true);
    expect(pulseAppliesToCorp(pulse, "corp2", "US", ["energy"], keys("UK:energy"))).toBe(false);
  });

  it("scope=sector honors domestic/foreign HQ filters", () => {
    const domesticPulse = makePulse({
      scope: "sector",
      countryId: "US",
      sectorType: "technology",
      hqRelation: "domestic",
    });
    const foreignPulse = makePulse({
      scope: "sector",
      countryId: "US",
      sectorType: "technology",
      hqRelation: "foreign",
    });

    expect(
      pulseAppliesToCorp(domesticPulse, "corp1", "US", ["technology"], keys("US:technology"))
    ).toBe(true);
    expect(
      pulseAppliesToCorp(domesticPulse, "corp2", "UK", ["technology"], keys("US:technology"))
    ).toBe(false);
    expect(
      pulseAppliesToCorp(foreignPulse, "corp3", "UK", ["technology"], keys("US:technology"))
    ).toBe(true);
    expect(
      pulseAppliesToCorp(foreignPulse, "corp4", "US", ["technology"], keys("US:technology"))
    ).toBe(false);
  });

  it("scope=corp matches on corpId", () => {
    const pulse = makePulse({ scope: "corp", corpId: "abc" });
    expect(pulseAppliesToCorp(pulse, "abc", "US", [])).toBe(true);
    expect(pulseAppliesToCorp(pulse, "xyz", "US", [])).toBe(false);
  });

  describe("FTA-aware foreign-side filtering", () => {
    const ukUsFta: FtaPairSet = new Set([ftaPairKey("UK", "US")]);
    const foreignSectorPulse = makePulse({
      scope: "sector",
      countryId: "UK",
      sectorType: "energy",
      hqRelation: "foreign",
    });

    it("hqRelation=foreign sector pulse is suppressed when issuer and corp HQ are FTA partners", () => {
      // US corp operating in UK:energy — penalty pulse from UK should not apply
      // because UK and US are bound by an active FTA.
      expect(
        pulseAppliesToCorp(
          foreignSectorPulse,
          "corp1",
          "US",
          ["energy"],
          keys("UK:energy"),
          ukUsFta
        )
      ).toBe(false);
    });

    it("hqRelation=foreign sector pulse still applies to non-FTA partners", () => {
      // Chinese corp operating in UK:energy — no FTA, penalty pulse applies.
      expect(
        pulseAppliesToCorp(
          foreignSectorPulse,
          "corp1",
          "CN",
          ["energy"],
          keys("UK:energy"),
          ukUsFta
        )
      ).toBe(true);
    });

    it("hqRelation=foreign sector pulse is unchanged when no FTA pair set is supplied", () => {
      // Back-compat: callers that don't thread FTA data fall back to the prior behaviour.
      expect(
        pulseAppliesToCorp(foreignSectorPulse, "corp1", "US", ["energy"], keys("UK:energy"))
      ).toBe(true);
    });

    it("hqRelation=domestic sector pulse is not affected by the FTA filter", () => {
      // Domestic-side boost from UK to UK-HQ corps in UK:energy — still applies.
      const domesticPulse = makePulse({
        scope: "sector",
        countryId: "UK",
        sectorType: "energy",
        hqRelation: "domestic",
      });
      expect(
        pulseAppliesToCorp(domesticPulse, "corp1", "UK", ["energy"], keys("UK:energy"), ukUsFta)
      ).toBe(true);
    });

    it("sector pulses with no hqRelation (subsidy/legislation) ignore the FTA filter", () => {
      // These aren't punitive against foreign trade specifically; FTAs shouldn't gate them.
      const genericPulse = makePulse({
        scope: "sector",
        countryId: "UK",
        sectorType: "energy",
      });
      expect(
        pulseAppliesToCorp(genericPulse, "corp1", "US", ["energy"], keys("UK:energy"), ukUsFta)
      ).toBe(true);
    });

    it("country-scope and corp-scope pulses are not affected by the FTA filter", () => {
      const countryPulse = makePulse({ scope: "country", countryId: "UK" });
      const corpPulse = makePulse({ scope: "corp", corpId: "abc" });
      expect(pulseAppliesToCorp(countryPulse, "corp1", "UK", [], new Set(), ukUsFta)).toBe(true);
      expect(pulseAppliesToCorp(corpPulse, "abc", "UK", [], new Set(), ukUsFta)).toBe(true);
    });
  });
});

describe("computeSentimentMultiplier", () => {
  it("returns 1.0 when there are no pulses", () => {
    expect(computeSentimentMultiplier([], NOW, "corp1", "US", [])).toBe(1.0);
  });

  it("sums applicable pulse impacts", () => {
    const pulses = [
      makePulse({ scope: "all", initialImpact: 0.1 }),
      makePulse({ scope: "all", initialImpact: 0.08 }),
    ];
    // total = 0.18 → sentimentMultiplier = 1.18
    expect(computeSentimentMultiplier(pulses, NOW, "corp1", "US", [])).toBeCloseTo(1.18, 4);
  });

  it("clamps total impact to SENTIMENT_CAP (positive)", () => {
    const pulses = [
      makePulse({ scope: "all", initialImpact: 0.2 }),
      makePulse({ scope: "all", initialImpact: 0.2 }),
    ];
    // 0.40 > SENTIMENT_CAP → clamped to SENTIMENT_CAP
    const result = computeSentimentMultiplier(pulses, NOW, "corp1", "US", []);
    expect(result).toBeCloseTo(1 + SENTIMENT_CAP, 4);
  });

  it("clamps total impact to -SENTIMENT_CAP (negative)", () => {
    const pulses = [
      makePulse({ scope: "all", initialImpact: -0.2 }),
      makePulse({ scope: "all", initialImpact: -0.2 }),
    ];
    const result = computeSentimentMultiplier(pulses, NOW, "corp1", "US", []);
    expect(result).toBeCloseTo(1 - SENTIMENT_CAP, 4);
  });

  it("excludes pulses that do not apply to this corp", () => {
    const pulses = [makePulse({ scope: "country", countryId: "UK", initialImpact: 0.15 })];
    // US corp — UK pulse does not apply
    expect(computeSentimentMultiplier(pulses, NOW, "corp1", "US", [])).toBe(1.0);
  });

  it("uses operating-sector geography for country-specific sector pulses", () => {
    const pulses = [
      makePulse({
        scope: "sector",
        countryId: "US",
        sectorType: "technology",
        initialImpact: 0.1,
      }),
    ];
    expect(
      computeSentimentMultiplier(pulses, NOW, "corp1", "UK", ["technology"], keys("US:technology"))
    ).toBeCloseTo(1.1, 4);
    expect(
      computeSentimentMultiplier(pulses, NOW, "corp2", "UK", ["technology"], keys("UK:technology"))
    ).toBe(1.0);
  });

  it("ignores negligible pulses (|impact| < 0.001)", () => {
    // After 30 intervals at 0.75 decay, the pulse is negligible
    const pulse = makePulse({ initialImpact: 0.2, decayRate: 0.75 });
    const afterManyIntervals = new Date(30 * PRICE_UPDATE_INTERVAL_MS);
    // Just verifies no crash and result ≈ 1.0
    const result = computeSentimentMultiplier([pulse], afterManyIntervals, "corp1", "US", []);
    expect(result).toBeCloseTo(1.0, 2);
  });

  it("excludes hqRelation=foreign sector pulses when the corp HQ is an FTA partner of the issuer", () => {
    // 4 negative pulses summing to -0.28 raw → would hit -SENTIMENT_CAP for non-FTA corps,
    // but for FTA partners the multiplier should be exactly 1.0 (no impact).
    const pulses = Array.from({ length: 4 }, () =>
      makePulse({
        scope: "sector",
        countryId: "UK",
        sectorType: "energy",
        hqRelation: "foreign",
        initialImpact: -0.07,
        decayRate: 1.0,
      })
    );
    const ftaPairs = new Set([ftaPairKey("UK", "US")]);

    // US corp operating in UK:energy — protected by FTA
    expect(
      computeSentimentMultiplier(
        pulses,
        NOW,
        "corp1",
        "US",
        ["energy"],
        keys("UK:energy"),
        ftaPairs
      )
    ).toBe(1.0);

    // CN corp operating in UK:energy — no FTA, hits the negative cap
    expect(
      computeSentimentMultiplier(
        pulses,
        NOW,
        "corp2",
        "CN",
        ["energy"],
        keys("UK:energy"),
        ftaPairs
      )
    ).toBeCloseTo(1 - SENTIMENT_CAP, 4);
  });
});

describe("getHqConfidenceSentiment", () => {
  it("is neutral (1.0) at the baseline", () => {
    expect(getHqConfidenceSentiment(HQ_CONFIDENCE_BASELINE)).toBe(1);
  });

  it("is neutral when confidence is unknown", () => {
    expect(getHqConfidenceSentiment(undefined)).toBe(1);
    expect(getHqConfidenceSentiment(null)).toBe(1);
    expect(getHqConfidenceSentiment(NaN)).toBe(1);
  });

  it("lifts price above baseline and depresses it below", () => {
    expect(getHqConfidenceSentiment(80)).toBeCloseTo(1 + (80 - 60) * 0.003, 6); // +0.06
    expect(getHqConfidenceSentiment(40)).toBeCloseTo(1 - (60 - 40) * 0.003, 6); // -0.06
  });

  it("clamps the extremes to ±HQ_CONFIDENCE_SENTIMENT_CAP", () => {
    expect(getHqConfidenceSentiment(100)).toBe(1 + HQ_CONFIDENCE_SENTIMENT_CAP);
    expect(getHqConfidenceSentiment(0)).toBe(1 - HQ_CONFIDENCE_SENTIMENT_CAP);
  });
});
