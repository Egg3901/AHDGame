import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { duesIncomePerTurn, servicesCostPerTurn, UNION_TREASURY_FLOW_SCALE } from "./unionDues";

describe("union treasury flow scale", () => {
  it("credits three times the annual dues divided by a 48-turn year", () => {
    // 100 members * 4.8 a year / 48 turns = 10, then * 3 = 30.
    expect(TURNS_PER_YEAR).toBe(48);
    expect(UNION_TREASURY_FLOW_SCALE).toBe(3);
    expect(duesIncomePerTurn(100, 4.8)).toBe(30);
  });

  it("bills three times the wage-fraction service cost per turn", () => {
    // healthFund is 2.5% of wages: 100 members * 10 wage * 0.025 / 48 = 0.520833..., * 3 = 1.5625.
    expect(servicesCostPerTurn(100, 10, ["healthFund"])).toBeCloseTo(1.5625, 8);
  });
});
