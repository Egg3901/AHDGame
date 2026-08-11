import { describe, expect, it } from "vitest";
import { corridorVerdict, inflationTrendLabel } from "./rateCorridor";

describe("corridorVerdict", () => {
  it("reads a rate well above inflation as restrictive", () => {
    const verdict = corridorVerdict(4.25, 3.1);
    expect(verdict.stance).toBe("restrictive");
    expect(verdict.delta).toBeCloseTo(1.15);
    expect(verdict.copy).toContain("+1.15");
    expect(verdict.copy).toContain("restrictive");
  });

  it("reads a rate below inflation as accommodative", () => {
    const verdict = corridorVerdict(2.0, 3.5);
    expect(verdict.stance).toBe("accommodative");
    expect(verdict.copy).toContain("-1.50");
  });

  it("reads a rate near inflation as neutral", () => {
    expect(corridorVerdict(3.2, 3.0).stance).toBe("neutral");
    expect(corridorVerdict(2.9, 3.0).stance).toBe("neutral");
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
