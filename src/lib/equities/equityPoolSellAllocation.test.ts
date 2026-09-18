import { describe, expect, it } from "vitest";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { allocateEquityPoolSellBudgets } from "./equityPoolSellAllocation";

describe("allocateEquityPoolSellBudgets", () => {
  it("shares a short pool budget pro-rata instead of starving later corporations", () => {
    const budgets = allocateEquityPoolSellBudgets({
      cashByCurrency: new Map<CurrencyCode, number>([["USD", 245]]),
      demands: [
        { currency: "USD", corporationId: "first", notionalLocal: 980 },
        { currency: "USD", corporationId: "second", notionalLocal: 980 },
      ],
    });

    expect(budgets.get("USD")?.get("first")).toBeCloseTo(122.5);
    expect(budgets.get("USD")?.get("second")).toBeCloseTo(122.5);
    expect(
      [...(budgets.get("USD")?.values() ?? [])].reduce((total, value) => total + value, 0)
    ).toBeCloseTo(245);
  });
});
