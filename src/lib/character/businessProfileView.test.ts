import { expect, it } from "vitest";
import { businessProfileView } from "./businessProfileView";
const data = {
  corporation: null,
  isInvestor: true,
  portfolioValue: 123456,
  dividendIncomePerTurn: 0,
  bondIncomePerTurn: 0,
  equityHoldingCount: 1,
  bondHoldingCount: 0,
  hasFundHoldings: false,
  fxRatesRecord: {},
  corporateSectorSummary: null,
};
it("removes private finances before serializing another character's business profile", () => {
  expect(businessProfileView(data, false)).toEqual({
    corporation: null,
    isInvestor: true,
    finances: null,
  });
  expect(JSON.stringify(businessProfileView(data, false))).not.toContain("123456");
  expect(businessProfileView(data, true)?.finances?.portfolioValue).toBe(123456);
});
it("does not require positive dividend income to qualify as an investor", () => {
  expect(businessProfileView(data, false)).not.toBeNull();
  expect(businessProfileView({ ...data, isInvestor: false }, true)).toBeNull();
});
