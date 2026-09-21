import { describe, expect, it } from "vitest";
import { settleDepartmentAccount } from "./departmentSettlement";
import type {
  DepartmentAccountPolicyInput,
  DepartmentAccountSettlementInput,
  DepartmentProgramClaimInput,
} from "./types";

const civilPolicy: DepartmentAccountPolicyInput = {
  canOverdraft: false,
  usesEncumbrance: true,
  arrearsMode: "record",
};

function program(
  programId: string,
  priority: DepartmentProgramClaimInput["priority"],
  requestedOutlay: number,
  overrides: Partial<DepartmentProgramClaimInput> = {}
): DepartmentProgramClaimInput {
  return {
    programId,
    legislationTypeId: `${programId}_law`,
    policyOptionId: `${programId}_option`,
    status: "operating",
    priority,
    annualDemand: requestedOutlay * 48,
    periodDemand: requestedOutlay,
    requestedOutlay,
    requestedEncumbrance: 0,
    capacity: {
      capacityType: "fixture_operations",
      maintenanceDemand: 0,
      programDemand: 100,
      sourceBreakdown: { workforce: 100, facilities: 0, systems: 0, efficiency: 0 },
    },
    coverageRatio: 1,
    rampFactor: 1,
    createsArrearsOnShortfall: false,
    ...overrides,
  };
}

function fixture(overrides: Partial<DepartmentAccountSettlementInput> = {}) {
  return {
    departmentId: "fixture_department",
    turn: 10,
    accruedThroughTurn: 9,
    openingBalance: 0,
    openingEncumbered: 0,
    openingArrears: 0,
    authority: 100,
    policy: civilPolicy,
    programs: [program("continuity", 5, 70), program("new", 6, 70)],
    ...overrides,
  } satisfies DepartmentAccountSettlementInput;
}

describe("department account settlement", () => {
  it("pays protected obligations before current programs", () => {
    const result = settleDepartmentAccount(
      fixture({
        openingBalance: 40,
        openingEncumbered: 30,
        openingArrears: 20,
        authority: 80,
      })
    );
    expect(result).toMatchObject({
      arrearsPaid: 20,
      encumbrancePaid: 30,
      programOutlays: 70,
      closingBalance: 0,
      closingEncumbered: 0,
      closingArrears: 0,
    });
    expect(result.programs.map(({ programId, allocated }) => ({ programId, allocated }))).toEqual([
      { programId: "continuity", allocated: 70 },
      { programId: "new", allocated: 0 },
    ]);
  });

  it("distributes same-tier shortfalls pro rata with deterministic residual cents", () => {
    const result = settleDepartmentAccount(
      fixture({
        authority: 5,
        programs: [program("alpha", 5, 3), program("beta", 5, 3)],
      })
    );
    expect(result.programs.map(({ programId, allocated }) => ({ programId, allocated }))).toEqual([
      { programId: "alpha", allocated: 3 },
      { programId: "beta", allocated: 2 },
    ]);
  });

  it("applies Cabinet weights only within the same legal priority tier", () => {
    const result = settleDepartmentAccount(
      fixture({
        authority: 100,
        programs: [
          program("protected_by_tier", 4, 40, { allocationWeight: 0 }),
          program("emphasized", 5, 100, { allocationWeight: 75 }),
          program("deemphasized", 5, 100, { allocationWeight: 25 }),
        ],
      })
    );
    expect(result.programs.map(({ programId, allocated }) => ({ programId, allocated }))).toEqual([
      { programId: "protected_by_tier", allocated: 40 },
      { programId: "emphasized", allocated: 45 },
      { programId: "deemphasized", allocated: 15 },
    ]);
  });

  it("caps a weighted program at demand and redistributes the remainder", () => {
    const result = settleDepartmentAccount(
      fixture({
        authority: 80,
        programs: [
          program("small", 5, 10, { allocationWeight: 90 }),
          program("large", 5, 100, { allocationWeight: 10 }),
        ],
      })
    );
    expect(result.programs.map(({ programId, allocated }) => ({ programId, allocated }))).toEqual([
      { programId: "small", allocated: 10 },
      { programId: "large", allocated: 70 },
    ]);
  });

  it("records arrears only for obligations that survive nonpayment", () => {
    const result = settleDepartmentAccount(
      fixture({
        authority: 50,
        programs: [
          program("mandatory", 4, 80, { createsArrearsOnShortfall: true }),
          program("discretionary", 5, 80),
        ],
      })
    );
    expect(result.programs[0]).toMatchObject({ allocated: 50, newArrears: 30 });
    expect(result.programs[1]).toMatchObject({ allocated: 0, newArrears: 0 });
    expect(result.closingArrears).toBe(30);
  });

  it("pays retained encumbrances during repeal and accepts no new obligation", () => {
    const result = settleDepartmentAccount(
      fixture({
        openingBalance: 60,
        openingEncumbered: 60,
        authority: 0,
        programs: [
          program("repealed", 5, 0, {
            requestedEncumbrance: 50,
            openingEncumbered: 60,
            repealTurn: 10,
          }),
        ],
      })
    );
    expect(result).toMatchObject({
      encumbrancePaid: 60,
      newEncumbrance: 0,
      closingEncumbered: 0,
      closingBalance: 0,
    });
    expect(result.programs[0]).toMatchObject({ status: "winding_down", allocated: 0 });
  });

  it("preserves the account byte-for-byte on same-turn replay", () => {
    const input = fixture({ accruedThroughTurn: 10, openingBalance: 80, openingEncumbered: 20 });
    expect(settleDepartmentAccount(input)).toEqual({
      departmentId: "fixture_department",
      turn: 10,
      replayed: true,
      authorityAccrued: 0,
      arrearsPaid: 0,
      encumbrancePaid: 0,
      programOutlays: 0,
      totalOutlays: 0,
      newEncumbrance: 0,
      newArrears: 0,
      overdraft: 0,
      closingBalance: 80,
      closingEncumbered: 20,
      closingArrears: 0,
      programs: [],
    });
  });

  it("records explicit overdraft only when the account policy permits it", () => {
    const result = settleDepartmentAccount(
      fixture({
        authority: 10,
        policy: { ...civilPolicy, canOverdraft: true, arrearsMode: "sovereign_overdraft" },
        programs: [program("defense_upkeep", 3, 100)],
      })
    );
    expect(result).toMatchObject({ overdraft: 90, programOutlays: 100, closingBalance: 0 });
  });

  it("conserves money and remains monotone over bounded funding inputs", () => {
    let previousDelivery = 0;
    for (let authority = 0; authority <= 500; authority += 7) {
      const result = settleDepartmentAccount(
        fixture({ authority, programs: [program("service", 5, 300)] })
      );
      expect(result.authorityAccrued + result.overdraft).toBe(
        result.totalOutlays + result.closingBalance
      );
      expect(result.closingEncumbered).toBeLessThanOrEqual(result.closingBalance);
      const delivery = result.programs[0]!.implementation.implementationFactor;
      expect(delivery).toBeGreaterThanOrEqual(previousDelivery);
      previousDelivery = delivery;
    }
  });
});
