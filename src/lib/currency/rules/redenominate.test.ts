import { describe, expect, it } from "vitest";
import { redenominateFederalBudget, redenominateStateBudget } from "./redenominate";

describe("currency redenomination rules", () => {
  it("scales every federal money bucket but not debt rates", () => {
    const converted = redenominateFederalBudget(
      {
        revenue: { incomeTax: 10, total: 10 },
        taxBases: { taxableIncome: 100 },
        spending: { byCategory: { healthcare: 4 }, stateGrants: 2, total: 6 },
        debt: { principal: 50, ceiling: 80, interestRate: 3, ceilingLastRaisedYear: 2027 },
        treasuryBalance: -50,
        surplus: 4,
        gdp: 200,
        baselineSpendingByCategory: { healthcare: 4 },
        baselineStateGrants: 2,
        defenseAppropriation: {
          balance: 20,
          accruedThroughTurn: 17,
          arrearsRatio: 0.25,
          encumbered: 5,
        },
        intelligenceAppropriation: { balance: 8, accruedThroughTurn: 12 },
        militaryPriceBaselineGdp: 200,
      },
      0.1
    );
    expect(converted.revenue.total).toBe(1);
    expect(converted.spending.byCategory.healthcare).toBe(0.4);
    expect(converted.debt.principal).toBe(5);
    expect(converted.debt).toMatchObject({ interestRate: 3, ceilingLastRaisedYear: 2027 });
    expect(converted.defenseAppropriation).toEqual({
      balance: 2,
      accruedThroughTurn: 17,
      arrearsRatio: 0.25,
      encumbered: 0.5,
    });
    expect(converted.intelligenceAppropriation).toEqual({ balance: 0.8, accruedThroughTurn: 12 });
    expect(converted.militaryPriceBaselineGdp).toBe(20);
  });

  it("scales state fiscal money consistently", () => {
    const converted = redenominateStateBudget(
      {
        revenue: { total: 12 },
        taxBases: { taxableIncome: 60 },
        spending: { byCategory: { education: 8 }, total: 8 },
        balance: 4,
        surplus: 4,
        stateGdp: 100,
      },
      0.5
    );
    expect(converted).toMatchObject({ balance: 2, surplus: 2, stateGdp: 50 });
    expect(converted.revenue.total).toBe(6);
  });
});
