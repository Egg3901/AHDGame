import { describe, expect, it } from "vitest";
import { isWithinYearWindow } from "./yearWindow";

describe("isWithinYearWindow (era gating)", () => {
  it("passes unbounded definitions in any year", () => {
    expect(isWithinYearWindow({}, 1953)).toBe(true);
    expect(isWithinYearWindow({}, 2019)).toBe(true);
  });

  it("enforces minYear inclusively", () => {
    const def = { minYear: 2005 };
    expect(isWithinYearWindow(def, 2004)).toBe(false);
    expect(isWithinYearWindow(def, 2005)).toBe(true);
    expect(isWithinYearWindow(def, 2006)).toBe(true);
  });

  it("enforces maxYear inclusively", () => {
    const def = { maxYear: 1959 };
    expect(isWithinYearWindow(def, 1959)).toBe(true);
    expect(isWithinYearWindow(def, 1960)).toBe(false);
  });

  it("enforces a decade window at both bounds", () => {
    const def = { minYear: 1950, maxYear: 1959 };
    expect(isWithinYearWindow(def, 1949)).toBe(false);
    expect(isWithinYearWindow(def, 1950)).toBe(true);
    expect(isWithinYearWindow(def, 1959)).toBe(true);
    expect(isWithinYearWindow(def, 1960)).toBe(false);
  });

  it("does not enforce bounds when the in-game year is unknown (back-compat)", () => {
    expect(isWithinYearWindow({ minYear: 2005, maxYear: 2010 }, undefined)).toBe(true);
  });
});
