import { describe, expect, it } from "vitest";
import { periodLifeExpectancy } from "./periodLifeExpectancy";

describe("period life expectancy from cohort mortality", () => {
  it("recomputes a realistic neutral period value from the actual age schedule", () => {
    const years = periodLifeExpectancy({ lifeExpectancy: 77.5, preventableMortality: 310 });
    expect(years).toBeGreaterThan(79);
    expect(years).toBeLessThan(82);
  });

  it("moves in the direction of the mortality inputs without copying them", () => {
    const poor = periodLifeExpectancy({ lifeExpectancy: 70, preventableMortality: 500 });
    const healthy = periodLifeExpectancy({ lifeExpectancy: 85, preventableMortality: 120 });
    expect(poor).toBeLessThan(healthy);
    expect(poor).toBeGreaterThan(70);
    expect(healthy).toBeLessThan(90);
  });
});
