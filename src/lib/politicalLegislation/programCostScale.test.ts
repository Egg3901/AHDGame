import { describe, expect, it } from "vitest";
import { getCatalog } from "./catalog";
import { budgetKeyForLaw } from "./budgetKeys";
import { programCostScaleForLaw } from "./programCostScale";

describe("founding program cost scale per law", () => {
  const book = getCatalog("UK", 1991).filter((law) => law.kind !== "tax");
  const health = book.find((law) => budgetKeyForLaw(law) === "health")!;
  const defense = book.find((law) => budgetKeyForLaw(law) === "defense")!;

  it("prices a national law at its category's refit scale", () => {
    const budget = {
      programCostScaleBaseline: 1,
      programCostScaleByCategoryBaseline: { health: 7.5, defense: 0.38 },
    };
    expect(programCostScaleForLaw(budget, health)).toBe(7.5);
    expect(programCostScaleForLaw(budget, defense)).toBe(0.38);
  });

  it("falls back to the book-wide scale for unrefit worlds and categories", () => {
    expect(programCostScaleForLaw({ programCostScaleBaseline: 0.7 }, health)).toBe(0.7);
    expect(
      programCostScaleForLaw(
        { programCostScaleBaseline: 0.7, programCostScaleByCategoryBaseline: { other: 2 } },
        defense
      )
    ).toBe(0.7);
    expect(
      programCostScaleForLaw({ programCostScaleByCategoryBaseline: { health: Number.NaN } }, health)
    ).toBe(1);
    expect(programCostScaleForLaw(null, health)).toBe(1);
  });
});
