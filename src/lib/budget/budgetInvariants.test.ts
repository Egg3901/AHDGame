import { describe, expect, it } from "vitest";
import { checkFederalBudgetInvariants } from "./budgetInvariants";

const clean = {
  revenue: { total: 1000 },
  spending: { total: 1400 },
  surplus: -400,
  treasuryBalance: -5000,
  debt: { principal: 5000 },
};

describe("checkFederalBudgetInvariants", () => {
  it("reports nothing for a consistent budget", () => {
    expect(checkFederalBudgetInvariants(clean)).toEqual([]);
  });

  it("reports a stale surplus cache", () => {
    const breaches = checkFederalBudgetInvariants({ ...clean, surplus: -450 });
    expect(breaches).toHaveLength(1);
    expect(breaches[0].field).toBe("surplus");
    expect(breaches[0].stored).toBe(-450);
    expect(breaches[0].derived).toBe(-400);
    expect(breaches[0].absDelta).toBe(50);
  });

  it("reports a stale debt principal mirror", () => {
    const breaches = checkFederalBudgetInvariants({
      ...clean,
      debt: { principal: 4900 },
    });
    expect(breaches).toHaveLength(1);
    expect(breaches[0].field).toBe("debtPrincipal");
    expect(breaches[0].derived).toBe(5000);
  });

  it("floors debt principal at zero when the treasury is in surplus", () => {
    const breaches = checkFederalBudgetInvariants({
      ...clean,
      treasuryBalance: 250,
      debt: { principal: 0 },
    });
    expect(breaches).toEqual([]);
  });

  it("tolerates sub-unit floating point noise", () => {
    const breaches = checkFederalBudgetInvariants({ ...clean, surplus: -400.4 });
    expect(breaches).toEqual([]);
  });

  it("reports both fields when both drift", () => {
    const breaches = checkFederalBudgetInvariants({
      ...clean,
      surplus: -450,
      debt: { principal: 4900 },
    });
    expect(breaches.map((b) => b.field).sort()).toEqual(["debtPrincipal", "surplus"]);
  });

  it("skips a field the document does not carry", () => {
    expect(checkFederalBudgetInvariants({ revenue: { total: 1 }, spending: { total: 1 } })).toEqual(
      []
    );
  });
});
