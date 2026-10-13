import { describe, it, expect } from "vitest";
import {
  comparisonHistory,
  selectedFinancialSummary,
  sortComparisonMembers,
  comparisonCsv,
  groupBondDebt,
  type ComparisonMember,
} from "./financialComparison";
const point = (turn: number, revenue = 100, income = 20, cash?: number) => ({
  turn,
  revenue,
  costs: revenue - income,
  income,
  ...(cash === undefined ? {} : { cash }),
});
const member = (id: string, revenue = 100, income = 20): ComparisonMember => ({
  id,
  name: id,
  history: [point(20, revenue, income, 1000), point(19, revenue, income, 900)],
  currentCash: 2000,
  debt: 100,
});
describe("comparison reporting", () => {
  it("weights margins by revenue, preserves losses and keeps stocks separate", () => {
    const result = selectedFinancialSummary([member("a", 100, 20), member("b", 200, 80)]);
    expect(result.latest?.income).toBe(100);
    expect(result.margin).toBeCloseTo(100 / 3);
    expect(result.cash).toBe(4000);
    expect(result.debt).toBe(200);
    expect(selectedFinancialSummary([member("a", 100, -20)]).margin).toBe(-20);
  });
  it("never fills private, empty or mismatched totals", () => {
    const b = member("b");
    b.history = null;
    b.debt = null;
    expect(selectedFinancialSummary([member("a"), b])).toMatchObject({
      latest: null,
      margin: null,
      debt: null,
      cash: 4000,
    });
    b.history = [point(19)];
    expect(selectedFinancialSummary([member("a"), b]).latest).toBeNull();
    expect(selectedFinancialSummary([])).toEqual({
      latest: null,
      margin: null,
      cash: null,
      debt: null,
    });
  });
  it("scales flow history by 24, but cash history is never scaled", () => {
    const rows = [member("a"), member("b", 200, 80)];
    expect(comparisonHistory(rows, "income", 20, 12, "day").consecutive[1].values).toEqual([
      480, 1920,
    ]);
    expect(comparisonHistory(rows, "cash", 20, 12, "day").consecutive[1].values).toEqual([
      1000, 1000,
    ]);
  });
  it("does not join missing turns or pretend missing cash was zero", () => {
    const m = member("a");
    m.history = [point(20), point(18), point(17)];
    expect(comparisonHistory([m], "cash", 20, 24, "turn").all).toEqual([]);
    expect(
      comparisonHistory([m], "revenue", 20, 24, "turn").consecutive.map((p) => p.turn)
    ).toEqual([20]);
    m.name = "  =SUM(A1)";
    expect(comparisonCsv([m], "turn", [])).toContain("'  =SUM(A1)");
    m.history = null;
    expect(comparisonHistory([m], "revenue", 20, 24, "turn").all).toEqual([]);
  });
  it.each([12, 24, 48] as const)("limits comparison history to %s turns", (range) => {
    const m = member("a");
    m.history = Array.from({ length: 49 }, (_, i) => point(100 - i));
    expect(comparisonHistory([m], "revenue", 100, range, "turn").all).toHaveLength(range);
  });
  it("sorts known values in either direction with private values last", () => {
    const hidden = member("z");
    hidden.history = null;
    const rows = [member("b", 200), hidden, member("a", 100)];
    expect(sortComparisonMembers(rows, "revenue", 1).map((m) => m.id)).toEqual(["a", "b", "z"]);
    expect(sortComparisonMembers(rows, "revenue", -1).map((m) => m.id)).toEqual(["b", "a", "z"]);
    expect(rows.map((m) => m.id)).toEqual(["b", "z", "a"]);
  });
  it("refuses overflowing totals and daily history", () => {
    const huge = member("a", 1e308, 1e308);
    expect(selectedFinancialSummary([huge, { ...huge, id: "b" }]).latest).toBeNull();
    expect(comparisonHistory([huge], "income", 20, 12, "day").all).toEqual([]);
    expect(
      groupBondDebt(
        ["a"],
        [{ corporationId: "a", principal: 1e308, currencyCode: "GBP" }],
        new Map([["GBP", 1e-308]])
      ).get("a")
    ).toBeNull();
  });
  it("exports only the selected values in anchor units, quotes names and leaves unknowns blank", () => {
    const m = member("a", 100, -20);
    m.name = '=SUM("A1")';
    m.debt = null;
    const csv = comparisonCsv([m], "day", [
      "name",
      "turn",
      "revenue",
      "costs",
      "income",
      "cash",
      "debt",
      "basis",
    ]);
    expect(csv).toContain('"\'=SUM(""A1"")","20","2400","2880","-480","2000","","day"');
    m.history = null;
    expect(comparisonCsv([m], "turn", [])).not.toContain('"0"');
  });
});
describe("current bond debt", () => {
  it("groups and converts outstanding principal and preserves known zero debt", () => {
    expect(
      groupBondDebt(
        ["a", "b"],
        [
          { corporationId: "a", principal: 200, currencyCode: "GBP" },
          { corporationId: "a", principal: 100, countryId: "US" },
        ],
        new Map([
          ["GBP", 4],
          ["USD", 2],
        ])
      )
    ).toEqual(
      new Map([
        ["a", 100],
        ["b", 0],
      ])
    );
  });
  it.each([undefined, 0, -1, NaN, Infinity])(
    "fails closed for unknown or invalid FX (%s)",
    (rate) => {
      expect(
        groupBondDebt(
          ["a"],
          [{ corporationId: "a", principal: 100, currencyCode: "GBP" }],
          rate === undefined ? new Map() : new Map([["GBP", rate]])
        ).get("a")
      ).toBeNull();
    }
  );
});
