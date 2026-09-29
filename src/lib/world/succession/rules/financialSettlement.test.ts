import { describe, expect, it } from "vitest";
import {
  allocateSuccessionAmount,
  allocateSuccessionDebtService,
  planSuccessionFinances,
  type SuccessionFinancialTerms,
} from "./financialSettlement";

const terms: SuccessionFinancialTerms = {
  settlementId: "cs-negotiation-1",
  sourceEntityId: "CS",
  participants: [
    { entityId: "CZ2", population: 10_000_000 },
    { entityId: "SK", population: 5_000_000 },
  ],
  financialAssetsMinor: 101,
  creditorDebtMinor: 1000,
};

describe("negotiated succession finances", () => {
  it("defaults to population while preserving the existing servicing issuer", () => {
    const plan = planSuccessionFinances(terms);
    expect(plan.assetAllocation).toEqual({ CZ2: 67, SK: 34 });
    expect(plan.debtResponsibility).toEqual({ CZ2: 667, SK: 333 });
    expect(plan.servicingIssuerId).toBe("CS");
    expect(plan.servicingEntityKind).toBe("legacy-administration");
    expect(plan.creditorDebtMinor).toBe(1000);
    expect(plan.assetBasis).toBe("population");
  });
  it("keeps a continuing parent as its own issuer", () => {
    const plan = planSuccessionFinances({
      ...terms,
      sourceEntityId: "RU",
      participants: [
        { entityId: "RU", population: 10_000_000 },
        { entityId: "UKR", population: 5_000_000 },
      ],
    });
    expect(plan.servicingEntityKind).toBe("continuing-state");
    expect(plan.servicingIssuerId).toBe("RU");
  });
  it("allows different negotiated asset and debt shares including a zero share", () => {
    const plan = planSuccessionFinances({
      ...terms,
      assetSharesBps: { CZ2: 5000, SK: 5000 },
      debtSharesBps: { CZ2: 10000, SK: 0 },
    });
    expect(plan.assetAllocation).toEqual({ CZ2: 51, SK: 50 });
    expect(plan.debtResponsibility).toEqual({ CZ2: 1000, SK: 0 });
    expect(plan.assetBasis).toBe("negotiated");
    expect(allocateSuccessionDebtService(plan, 73)).toEqual({ CZ2: 73, SK: 0 });
  });
  it("is independent of participant order and conserves the maximum safe balance", () => {
    const total = Number.MAX_SAFE_INTEGER;
    const a = allocateSuccessionAmount(total, { RU: 147000000, UKR: 52000000, BLR: 10000000 });
    const b = allocateSuccessionAmount(total, { BLR: 10000000, RU: 147000000, UKR: 52000000 });
    expect(a).toEqual(b);
    expect(Object.values(a).reduce((sum, value) => sum + BigInt(value), BigInt(0))).toBe(
      BigInt(total)
    );
  });
  it.each([0, 1, 2, 3, 7, 100, 1000001])(
    "conserves every asset and debt-service unit for total %s",
    (total) => {
      const allocation = allocateSuccessionAmount(total, { AA: 7, BB: 3, CC: 1 });
      expect(Object.values(allocation).reduce((sum, value) => sum + value, 0)).toBe(total);
      expect(
        Object.values(allocation).every((value) => Number.isSafeInteger(value) && value >= 0)
      ).toBe(true);
    }
  );
  it.each<Record<string, number>>([
    { CZ2: 6000, SK: 3000 },
    { CZ2: 6000, SK: 5000 },
    { CZ2: 10000 },
    { CZ2: 6000, SK: 4000, OTHER: 0 },
    { CZ2: 6000.5, SK: 3999.5 },
    { CZ2: 10001, SK: -1 },
  ])("rejects incomplete or invalid negotiated shares: %j", (shares) => {
    expect(() => planSuccessionFinances({ ...terms, debtSharesBps: shares })).toThrow();
  });
  it("rejects duplicates, empty populations and invalid financial amounts", () => {
    expect(() =>
      planSuccessionFinances({
        ...terms,
        participants: [terms.participants[0], terms.participants[0]],
      })
    ).toThrow(/Duplicate/);
    expect(() =>
      planSuccessionFinances({
        ...terms,
        participants: [{ entityId: "AA", population: 0 }, terms.participants[1]],
      })
    ).toThrow();
    for (const amount of [-1, 0.5, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => planSuccessionFinances({ ...terms, creditorDebtMinor: amount })).toThrow();
    }
  });
});
