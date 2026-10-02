import { describe, expect, it } from "vitest";
import { planSuccessionFinances } from "./financialSettlement";
import type { Bond } from "@/lib/db/types/bond";
import { planLegacyBondDue, planLegacyDebtService } from "./legacyService";

const finances = planSuccessionFinances({
  settlementId: "cs-1992",
  sourceEntityId: "CS",
  participants: [
    { entityId: "CZ2", population: 10 },
    { entityId: "SK", population: 5 },
  ],
  financialAssetsMinor: 0,
  creditorDebtMinor: 900,
});

describe("legacy settlement administration service", () => {
  it("values actual external coupon and maturity cash without moving the issuer", () => {
    const bond = {
      _id: { toString: () => "old-cs-bond" },
      issuerType: "sovereign",
      countryId: "CS",
      currencyCode: "CSK",
      couponRate: 4.8,
      maturityTurn: 90,
      holders: [{ units: 2 }],
      publicFloat: 1,
      centralBankHoldings: 2,
      matured: false,
      defaulted: false,
    } as unknown as Bond;
    const before = planLegacyBondDue({
      bonds: [bond],
      issuerId: "CS",
      turn: 89,
      ratesLocalPerAnchor: { CSK: 2 },
    });
    expect(before).toMatchObject({ couponMinor: 150, maturityMinor: 0, totalMinor: 150 });
    const due = planLegacyBondDue({
      bonds: [bond],
      issuerId: "CS",
      turn: 90,
      ratesLocalPerAnchor: { CSK: 2 },
    });
    expect(due).toMatchObject({ couponMinor: 150, maturityMinor: 150000, totalMinor: 150150 });
    expect(due.bonds).toEqual([
      { bondId: "old-cs-bond", currencyCode: "CSK", couponMinor: 150, maturityMinor: 150000 },
    ]);
    expect(bond.countryId).toBe("CS");
  });

  it("rejects missing live conversion and duplicate contracts", () => {
    const bond = {
      _id: { toString: () => "same" },
      issuerType: "sovereign",
      countryId: "CS",
      currencyCode: "CSK",
      couponRate: 5,
      maturityTurn: 100,
      holders: [{ units: 1 }],
      publicFloat: 0,
      matured: false,
      defaulted: false,
    } as unknown as Bond;
    expect(() =>
      planLegacyBondDue({ bonds: [bond], issuerId: "CS", turn: 90, ratesLocalPerAnchor: {} })
    ).toThrow("exchange rate");
    expect(() =>
      planLegacyBondDue({
        bonds: [bond, bond],
        issuerId: "CS",
        turn: 90,
        ratesLocalPerAnchor: { CSK: 1 },
      })
    ).toThrow("duplicate");
  });
  it("calls successors by agreed shares while preserving issuer and creditor due", () => {
    const plan = planLegacyDebtService({
      finances,
      dueMinor: 90,
      administrationCashMinor: 0,
      availableMinorBySuccessor: { CZ2: 100, SK: 100 },
    });
    expect(plan.successorCallsMinor).toEqual({ CZ2: 60, SK: 30 });
    expect(plan.successorContributionsMinor).toEqual(plan.successorCallsMinor);
    expect(plan.creditorPaymentMinor).toBe(90);
    expect(plan.creditorShortfallMinor).toBe(0);
    expect(plan.servicingIssuerId).toBe("CS");
    expect(finances.creditorDebtMinor).toBe(900);
  });

  it("records budget shortfalls and uses administration cash before missing a creditor payment", () => {
    const plan = planLegacyDebtService({
      finances,
      dueMinor: 90,
      administrationCashMinor: 20,
      availableMinorBySuccessor: { CZ2: 10, SK: 30 },
    });
    expect(plan.successorContributionsMinor).toEqual({ CZ2: 10, SK: 30 });
    expect(plan.successorArrearsMinor).toEqual({ CZ2: 50, SK: 0 });
    expect(plan.creditorPaymentMinor).toBe(60);
    expect(plan.creditorShortfallMinor).toBe(30);
    expect(plan.administrationCashAfterMinor).toBe(0);
  });

  it("keeps surplus administration cash for future service", () => {
    const plan = planLegacyDebtService({
      finances,
      dueMinor: 3,
      administrationCashMinor: 10,
      availableMinorBySuccessor: { CZ2: 10, SK: 10 },
    });
    expect(plan.creditorPaymentMinor).toBe(3);
    expect(plan.administrationCashAfterMinor).toBe(10);
  });

  it("respects negotiated debt shares and never creates duplicate creditor principal", () => {
    const negotiated = planSuccessionFinances({
      settlementId: "yu-1992",
      sourceEntityId: "YU",
      participants: [
        { entityId: "SI", population: 2 },
        { entityId: "HR", population: 5 },
      ],
      financialAssetsMinor: 0,
      creditorDebtMinor: 1000,
      debtSharesBps: { SI: 2500, HR: 7500 },
    });
    const plan = planLegacyDebtService({
      finances: negotiated,
      dueMinor: 8,
      administrationCashMinor: 0,
      availableMinorBySuccessor: { SI: 100, HR: 100 },
    });
    expect(plan.successorCallsMinor).toEqual({ HR: 6, SI: 2 });
    expect(plan.servicingIssuerId).toBe("YU");
    expect(negotiated.creditorDebtMinor).toBe(1000);
  });

  it("does not replace a continuing state's own debt service", () => {
    const continuing = planSuccessionFinances({
      settlementId: "soviet-1991",
      sourceEntityId: "RU",
      participants: [
        { entityId: "RU", population: 10 },
        { entityId: "UKR", population: 4 },
      ],
      financialAssetsMinor: 0,
      creditorDebtMinor: 20,
    });
    expect(() =>
      planLegacyDebtService({
        finances: continuing,
        dueMinor: 2,
        administrationCashMinor: 0,
        availableMinorBySuccessor: { RU: 2, UKR: 2 },
      })
    ).toThrow("continuing states");
  });
  it("rejects missing, invalid or overflowed budget balances", () => {
    const base = { finances, dueMinor: 90, administrationCashMinor: 0 };
    expect(() =>
      planLegacyDebtService({ ...base, availableMinorBySuccessor: { CZ2: 90 } })
    ).toThrow();
    expect(() =>
      planLegacyDebtService({ ...base, availableMinorBySuccessor: { CZ2: -1, SK: 30 } })
    ).toThrow();
    expect(() =>
      planLegacyDebtService({
        ...base,
        dueMinor: -1,
        availableMinorBySuccessor: { CZ2: 90, SK: 90 },
      })
    ).toThrow();
    expect(() =>
      planLegacyDebtService({
        ...base,
        administrationCashMinor: Number.MAX_SAFE_INTEGER,
        availableMinorBySuccessor: { CZ2: 90, SK: 90 },
      })
    ).toThrow("precision");
  });
});
