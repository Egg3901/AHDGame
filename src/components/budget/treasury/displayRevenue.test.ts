import { describe, expect, it } from "vitest";
import type { FederalRevenue } from "@/lib/db/types/budget";
import { displayRevenueEntries } from "./displayRevenue";

describe("displayRevenueEntries", () => {
  it("shows capped receipts without counting diagnostic aggregates as revenue", () => {
    const revenue: FederalRevenue = {
      incomeTax: 60,
      domesticCorporateTax: 20,
      foreignCorporateTax: 10,
      payrollTax: 10,
      tariffs: 0,
      salesTax: 0,
      healthcareIncome: 5,
      other: 15,
      taxLikeRevenue: 100,
      taxLikeRevenueAfterCap: 25,
      revenueCapReduction: 75,
      total: 45,
    };

    const entries = displayRevenueEntries(revenue);

    expect(entries.map(([key]) => key)).not.toEqual(
      expect.arrayContaining(["taxLikeRevenue", "taxLikeRevenueAfterCap", "revenueCapReduction"])
    );
    expect(Object.fromEntries(entries)).toMatchObject({
      incomeTax: 15,
      domesticCorporateTax: 5,
      foreignCorporateTax: 2.5,
      payrollTax: 2.5,
      healthcareIncome: 5,
      other: 15,
    });
    expect(entries.reduce((sum, [, value]) => sum + value, 0)).toBe(revenue.total);
  });

  it("keeps legacy revenue rows unchanged when cap diagnostics are absent", () => {
    const revenue = {
      incomeTax: 30,
      domesticCorporateTax: 5,
      foreignCorporateTax: 5,
      payrollTax: 10,
      tariffs: 0,
      salesTax: 0,
      healthcareIncome: 5,
      other: 10,
      total: 65,
    } satisfies FederalRevenue;

    expect(Object.fromEntries(displayRevenueEntries(revenue))).toMatchObject({
      incomeTax: 30,
      payrollTax: 10,
      healthcareIncome: 5,
      other: 10,
    });
  });
});
