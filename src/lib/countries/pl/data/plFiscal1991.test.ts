import { describe, expect, it } from "vitest";
import {
  PL_1991_BUDGET_LAW_MILLION_PLZ,
  PL_1991_GENERAL_GOVERNMENT_GDP_PERCENT,
} from "./plFiscal1991";

describe("Poland 1991 fiscal records", () => {
  it("reconciles the budget law's revenue, spending and deficit", () => {
    const budget = PL_1991_BUDGET_LAW_MILLION_PLZ;
    expect(Object.values(budget.revenueBySource).reduce((a, b) => a + b, 0)).toBe(budget.revenue);
    expect(Object.values(budget.spendingByFunction).reduce((a, b) => a + b, 0)).toBe(
      budget.expenditure
    );
    expect(Object.values(budget.publicSectorBreakdown).reduce((a, b) => a + b, 0)).toBe(
      budget.spendingByFunction.publicSector
    );
    expect(budget.expenditure - budget.revenue).toBe(budget.deficit);
  });

  it("keeps state-budget law and wider general-government outturn distinct", () => {
    const wider = PL_1991_GENERAL_GOVERNMENT_GDP_PERCENT;
    expect(wider.revenue - wider.expenditure).toBeCloseTo(wider.balance);
  });
});
