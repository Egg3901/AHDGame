import { describe, expect, it } from "vitest";
import { planSuccessionFinances } from "./financialSettlement";
import { continuingContributionRiskLoss, planContinuingDebtService } from "./continuingService";
const finances = planSuccessionFinances({
  settlementId: "su-1991",
  sourceEntityId: "RU",
  participants: [
    { entityId: "RU", population: 2 },
    { entityId: "UA", population: 1 },
    { entityId: "BY", population: 1 },
  ],
  financialAssetsMinor: 0,
  creditorDebtMinor: 1000,
});
describe("continuing issuer debt contributions", () => {
  it("uses the established successor risk penalty only on unpaid calls", () => {
    expect(continuingContributionRiskLoss(100, 0)).toBe(0);
    expect(continuingContributionRiskLoss(100, 50)).toBe(0.01);
    expect(continuingContributionRiskLoss(100, 100)).toBe(0.02);
    expect(continuingContributionRiskLoss(0, 0)).toBe(0);
    expect(() => continuingContributionRiskLoss(100, 101)).toThrow();
  });
  it("retains the issuer's share and credits only actual successor contributions", () => {
    const result = planContinuingDebtService({
      finances,
      dueMinor: 100,
      availableMinorBySuccessor: { UA: 20, BY: 100 },
      priorArrearsMinor: { UA: 10, BY: 0 },
    });
    expect(result).toEqual({
      issuerOwnShareMinor: 50,
      successorCallsMinor: { BY: 25, UA: 35 },
      successorContributionsMinor: { BY: 25, UA: 20 },
      successorArrearsMinor: { BY: 0, UA: 15 },
      totalContributionsMinor: 45,
    });
  });
  it("recovers arrears from their debtor after the original bonds have matured", () => {
    expect(
      planContinuingDebtService({
        finances,
        dueMinor: 0,
        availableMinorBySuccessor: { UA: 15, BY: 100 },
        priorArrearsMinor: { UA: 15, BY: 0 },
      })
    ).toMatchObject({
      issuerOwnShareMinor: 0,
      successorContributionsMinor: { UA: 15, BY: 0 },
      successorArrearsMinor: { UA: 0, BY: 0 },
    });
  });
  it("carries an unpaid call without inventing cash or spreading it to another successor", () => {
    expect(
      planContinuingDebtService({
        finances,
        dueMinor: 100,
        availableMinorBySuccessor: { UA: 0, BY: 100 },
        priorArrearsMinor: { UA: 0, BY: 0 },
      })
    ).toMatchObject({ totalContributionsMinor: 25, successorArrearsMinor: { UA: 25, BY: 0 } });
  });
  it("rejects incomplete and unsafe arrears balances", () => {
    expect(() =>
      planContinuingDebtService({
        finances,
        dueMinor: 100,
        availableMinorBySuccessor: { UA: 0, BY: 100 },
        priorArrearsMinor: { UA: 0 },
      })
    ).toThrow();
    expect(() =>
      planContinuingDebtService({
        finances,
        dueMinor: 100,
        availableMinorBySuccessor: { UA: 0, BY: 100 },
        priorArrearsMinor: { UA: Number.MAX_SAFE_INTEGER, BY: 0 },
      })
    ).toThrow();
  });
});
