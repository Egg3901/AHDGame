import { describe, expect, it } from "vitest";
import { corridorVerdict, inflationTrendLabel } from "./rateCorridor";

describe("corridorVerdict", () => {
  it("reads a rate well above inflation as restrictive", () => {
    const verdict = corridorVerdict(4.25, 3.1);
    expect(verdict.stance).toBe("restrictive");
    expect(verdict.delta).toBeCloseTo(1.15);
    expect(verdict.copy).toBe(
      "The prime rate is 1.15 points above inflation, a restrictive stance."
    );
  });

  it("reads a rate below inflation as accommodative", () => {
    const verdict = corridorVerdict(2.0, 3.5);
    expect(verdict.stance).toBe("accommodative");
    expect(verdict.copy).toBe(
      "The prime rate is 1.50 points below inflation, an accommodative stance."
    );
  });

  it("reads a rate near inflation as neutral", () => {
    expect(corridorVerdict(3.2, 3.0).stance).toBe("neutral");
    expect(corridorVerdict(2.9, 3.0).stance).toBe("neutral");
    expect(corridorVerdict(3.0, 3.0).copy).toBe(
      "The prime rate matches inflation, a broadly neutral stance."
    );
  });

  it("writes the verdict as a plain sentence without dashes", () => {
    for (const [rate, inflation] of [
      [4.25, 3.1],
      [2.0, 3.5],
      [3.2, 3.0],
    ]) {
      expect(corridorVerdict(rate, inflation).copy).not.toMatch(/[\u2013\u2014]/);
    }
  });
});

describe("inflationTrendLabel", () => {
  const series = (values: number[]) => values.map((rate, turn) => ({ turn, rate }));

  it("labels falling inflation as cooling and rising as rising", () => {
    expect(inflationTrendLabel(series([3.8, 3.6, 3.4, 3.1]))).toBe("inflation cooling");
    expect(inflationTrendLabel(series([1.9, 2.2, 2.6, 3.0]))).toBe("inflation rising");
  });

  it("labels a flat or too-short series as steady", () => {
    expect(inflationTrendLabel(series([3.0, 3.02, 2.99, 3.01]))).toBe("inflation steady");
    expect(inflationTrendLabel(series([3.0]))).toBe("inflation steady");
    expect(inflationTrendLabel([])).toBe("inflation steady");
  });
});
