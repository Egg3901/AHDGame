import { describe, it, expect } from "vitest";
import {
  GOVT_HEALTHCARE_BUDGET_CATEGORIES,
  GOVT_SPEND_CATEGORY_ALIASES,
  govtSpendForCategory,
} from "./commodities";

describe("govtSpendForCategory", () => {
  it("reads the canonical `healthcare` spelling", () => {
    expect(
      govtSpendForCategory({ healthcare: 2_249_250_292 }, GOVT_HEALTHCARE_BUDGET_CATEGORIES)
    ).toBe(2_249_250_292);
  });

  it("reads the `health` spelling UK, CN and IE are seeded with", () => {
    // The 1953 UK budget authors `health: 570_000_000` ("NHS - new (1948) but
    // growing fast"). Reading only `healthcare` booked it as zero demand.
    expect(govtSpendForCategory({ health: 570_000_000 }, GOVT_HEALTHCARE_BUDGET_CATEGORIES)).toBe(
      570_000_000
    );
  });

  it("prefers the canonical spelling and never sums the two", () => {
    // A document should carry one spelling. If it somehow carries both,
    // summing would double-count the same appropriation.
    expect(
      govtSpendForCategory({ healthcare: 100, health: 900 }, GOVT_HEALTHCARE_BUDGET_CATEGORIES)
    ).toBe(100);
  });

  it("returns 0 for absent, zero, negative and non-finite amounts", () => {
    expect(govtSpendForCategory(undefined, GOVT_HEALTHCARE_BUDGET_CATEGORIES)).toBe(0);
    expect(govtSpendForCategory({}, GOVT_HEALTHCARE_BUDGET_CATEGORIES)).toBe(0);
    expect(govtSpendForCategory({ healthcare: 0 }, GOVT_HEALTHCARE_BUDGET_CATEGORIES)).toBe(0);
    expect(govtSpendForCategory({ healthcare: -5 }, GOVT_HEALTHCARE_BUDGET_CATEGORIES)).toBe(0);
    expect(govtSpendForCategory({ healthcare: NaN }, GOVT_HEALTHCARE_BUDGET_CATEGORIES)).toBe(0);
  });

  it("falls through to the next alias when the first is unusable", () => {
    expect(
      govtSpendForCategory({ healthcare: 0, health: 42 }, GOVT_HEALTHCARE_BUDGET_CATEGORIES)
    ).toBe(42);
  });

  it("keeps defense on a single spelling", () => {
    expect(GOVT_SPEND_CATEGORY_ALIASES.defense).toEqual(["defense"]);
    expect(govtSpendForCategory({ defense: 59_529_435_321 }, ["defense"])).toBe(59_529_435_321);
  });
});
