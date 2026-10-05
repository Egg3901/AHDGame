import { describe, expect, it, vi } from "vitest";
import { openingFiscalBooks1991 } from "./opening1991";
import * as budgetSeeds from "@/lib/seeds/reference/budgets";

describe("v2 1991 opening books against current seed signatures", () => {
  it("reconciles US, UK and JP without silently freeing period pension or grant money", () => {
    const books = openingFiscalBooks1991();
    expect(books.US).toMatchObject({
      revenue: 939_213_600_000,
      operating: 695_338_599_991,
      grants: 64_962_000_000,
      annualBalance: -30_999_999_991,
      debt: 3_665_000_000_000,
    });
    expect(books.UK).toMatchObject({
      revenue: 229_306_050_000,
      operating: 211_923_659_989,
      grants: 16_399_000_000,
      annualBalance: -2_999_999_989,
      debt: 194_118_000_000,
    });
    expect(books.UK.corrections).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "uk_state_pensions_continuity" })])
    );
    expect(books.JP).toMatchObject({
      revenue: 123_714_000_000_000,
      operating: 110_864_060_000_000,
      grants: 15_872_000_000_000,
      annualBalance: 2_873_940_000_000,
      debt: 172_000_000_000_000,
    });
    for (const country of ["US", "UK", "JP"] as const) {
      const book = books[country];
      const source = budgetSeeds
        .getInitialNationalBudgetsForPreset("1991-default")
        .find((row) => row.countryId === country)!;
      expect(book.revenue).toBe(source.revenue.total);
      expect(book.interest).toBe(source.spending.debtInterest);
      expect(-book.annualBalance / book.gdp).toBeLessThanOrEqual(0.005);
      expect(book.corrections.every((correction) => correction.revenueDelta === 0)).toBe(true);
    }
  });

  it("still fails closed when a reviewed source fiscal book changes", () => {
    const seeded = budgetSeeds.getInitialNationalBudgetsForPreset("1991-default");
    const reader = vi
      .spyOn(budgetSeeds, "getInitialNationalBudgetsForPreset")
      .mockReturnValue(
        seeded.map((budget) =>
          budget.countryId === "US"
            ? { ...budget, spending: { ...budget.spending, total: budget.spending.total + 1 } }
            : budget
        )
      );
    try {
      expect(() => openingFiscalBooks1991()).toThrow("seed book changed");
    } finally {
      reader.mockRestore();
    }
  });
});
