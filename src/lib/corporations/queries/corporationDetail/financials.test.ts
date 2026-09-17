import { describe, it, expect } from "vitest";
import type { Corporation } from "@/lib/db/types";
import { MAX_DIVIDEND_RATE } from "@/lib/constants/corporations";
import { getLegalStructureForCorp } from "@/lib/corporations/legalStructure";
import { computeDividendDistribution } from "./financials";

function corp(over: Partial<Corporation> = {}): Corporation {
  return { countryId: "US", dividendRate: 10, ...over } as Corporation;
}

describe("computeDividendDistribution (#587)", () => {
  const legal = getLegalStructureForCorp(corp());

  it("pays the corp rate when it beats every floor", () => {
    const d = computeDividendDistribution(corp({ dividendRate: 10 }), legal, 0, 1000);
    expect(d.effectiveDividendRate).toBe(10);
    expect(d.dividendDistribution).toBeCloseTo(100, 6);
  });

  it("takes the max of corp rate, legal floor, and parent floor", () => {
    const d = computeDividendDistribution(corp({ dividendRate: 1 }), legal, 25, 1000);
    expect(d.effectiveDividendRate).toBe(Math.max(1, (legal.minimumDividendRate ?? 0) * 100, 25));
  });

  it("clamps the corp rate to the max before comparing", () => {
    const d = computeDividendDistribution(
      corp({ dividendRate: MAX_DIVIDEND_RATE + 50 }),
      legal,
      0,
      1000
    );
    expect(d.corpDividendRateClamped).toBe(MAX_DIVIDEND_RATE);
    expect(d.effectiveDividendRate).toBeLessThanOrEqual(
      Math.max(MAX_DIVIDEND_RATE, (legal.minimumDividendRate ?? 0) * 100)
    );
  });

  it("pays nothing on non-positive income, however high the rate", () => {
    const d = computeDividendDistribution(corp({ dividendRate: 50 }), legal, 50, 0);
    expect(d.effectiveDividendRate).toBe(0);
    expect(d.dividendDistribution).toBe(0);
  });

  it("caps the pool at income so the payout never exceeds earnings", () => {
    const d = computeDividendDistribution(corp({ dividendRate: 100 }), legal, 0, 400);
    expect(d.dividendDistribution).toBeLessThanOrEqual(400);
  });
});
