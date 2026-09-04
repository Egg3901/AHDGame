import { describe, expect, it } from "vitest";
import {
  ASSESS_ESTIMATE_COVERAGE,
  ASSESS_EXACT_COVERAGE,
  ASSESS_EXISTENCE_COVERAGE,
  INTEL_FOG_MAX_DEVIATION,
} from "./config";
import { assessEconomic, type EconomicFacts } from "./economicAssessment";

const FACTS: EconomicFacts = {
  corporationCount: 40,
  publicCount: 31,
  aggregateLiquidCapital: 5_000_000,
};

const at = (c: number, f: EconomicFacts = FACTS) => assessEconomic(f, c, "RU", 10);

describe("assessEconomic", () => {
  it("reveals nothing below the existence tier", () => {
    const a = at(ASSESS_EXISTENCE_COVERAGE - 1);
    expect(a.hasCorporateSector).toBeNull();
    expect(a.corporationCount).toBeNull();
    expect(a.aggregateLiquidCapital).toBeNull();
  });

  it("answers only whether there is a corporate sector at the existence tier", () => {
    const a = at(ASSESS_EXISTENCE_COVERAGE);
    expect(a.hasCorporateSector).toBe(true);
    expect(a.corporationCount).toBeNull();
  });

  it("reports an absent corporate sector as absent", () => {
    const a = at(ASSESS_EXISTENCE_COVERAGE, {
      corporationCount: 0,
      publicCount: 0,
      aggregateLiquidCapital: 0,
    });
    expect(a.hasCorporateSector).toBe(false);
  });

  it("gives fogged aggregates at the estimate tier", () => {
    const a = at(ASSESS_ESTIMATE_COVERAGE);
    expect(a.figuresAreEstimate).toBe(true);
    expect(a.corporationCount).toBeGreaterThanOrEqual(40 * (1 - INTEL_FOG_MAX_DEVIATION) - 1);
    expect(a.corporationCount).toBeLessThanOrEqual(40 * (1 + INTEL_FOG_MAX_DEVIATION) + 1);
  });

  it("gives exact aggregates at the exact tier", () => {
    const a = at(ASSESS_EXACT_COVERAGE);
    expect(a.figuresAreEstimate).toBe(false);
    expect(a.corporationCount).toBe(40);
    expect(a.publicCount).toBe(31);
    expect(a.aggregateLiquidCapital).toBe(5_000_000);
  });

  it("fogs each aggregate independently", () => {
    // A shared factor publishes the exact ratio of listed to unlisted, and of
    // capital to company count.
    const a = assessEconomic(
      { corporationCount: 1000, publicCount: 1000, aggregateLiquidCapital: 1000 },
      ASSESS_ESTIMATE_COVERAGE,
      "RU",
      10
    );
    expect(new Set([a.corporationCount, a.publicCount, a.aggregateLiquidCapital]).size).toBe(3);
  });

  it("is deterministic", () => {
    expect(at(ASSESS_ESTIMATE_COVERAGE)).toEqual(at(ASSESS_ESTIMATE_COVERAGE));
  });

  it("never hands over a specific company's books, at any tier", () => {
    // financialFogOfWar exists to keep a rival out of one company's accounts.
    // Dissolving it for a whole country at once would retire that module by the
    // back door; seeing through it is the separate, deliberate leak operation.
    const a = at(ASSESS_EXACT_COVERAGE) as unknown as Record<string, unknown>;
    expect(a).not.toHaveProperty("corporations");
    expect(a).not.toHaveProperty("books");
  });
});
