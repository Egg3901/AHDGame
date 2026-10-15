import { describe, it, expect } from "vitest";
import {
  splitLiveDepartmentAccounts,
  splitLiveTreasury,
  reconcileSplitTreasuryClaims,
} from "./liveFinance";
import type { ResetDepartmentAccountSnapshot } from "@/lib/resetFinance/rules/liveDepartmentAccount";
import type { ResetNationalTreasurySnapshot } from "@/lib/resetFinance/rules/treasurySnapshot";
import { DEPARTMENT_DEFINITIONS } from "@/lib/governmentFinance/departmentCatalog";
function account(countryId: "UK" | "SCO"): ResetDepartmentAccountSnapshot {
  const definition = DEPARTMENT_DEFINITIONS.find(
    (row) => row.countryId === countryId && row.portfolioIds.includes("health")
  )!;
  return {
    _id: `${countryId}:health`,
    countryId,
    worldId: "w",
    departmentId: definition.id,
    controllingSeatId: "health",
    openingAgencyNames: [],
    sourceTurn: countryId === "UK" ? 1 : 300,
    accruedThroughTurn: 299,
    lastAuthorityPaid: 101,
    unpaidAuthority: 33,
    grossAnnualClaim: 1003,
    grantReservation: 0,
    annualAuthority: 1003,
    balance: 1001,
    encumbered: 111,
    arrears: 21,
    externallySettled: false,
    familyGrossAnnualDemand: { L01: 1003 },
    familyGrantReservation: {},
    familyAnnualDemand: { L01: 1003 },
    programAllocationPercents: { L01: 100 },
    lastProgramDelivery: { L01: { requested: 51, outlaid: 41, implementationFactor: 0.8 } },
  };
}
function treasury(countryId: "UK" | "SCO"): ResetNationalTreasurySnapshot {
  return {
    _id: countryId,
    countryId,
    worldId: "w",
    sourceTurn: countryId === "UK" ? 1 : 300,
    settledThroughTurn: 299,
    cash: 1003,
    debt: 9001,
    debtCeiling: 10000,
    emergencyAdvance: 11,
    arrears: { interest: 0, mandatory: 0, grants: 0, existing: 33, new: 0 },
    claimArrears: { "UK:health": 33 },
    lastPaid: { interest: 0, mandatory: 0, grants: 0, existing: 101, new: 0 },
    lastPaidByClaim: { "UK:health": 101 },
  };
}
describe("live independence finance", () => {
  it.each([0.01, 0.123, 0.9])("conserves cash and detailed obligations at share %s", (weight) => {
    const source = account("UK"),
      next = account("SCO");
    const accounts = splitLiveDepartmentAccounts(
      [source],
      [next],
      DEPARTMENT_DEFINITIONS,
      weight,
      299
    );
    for (const key of [
      "balance",
      "encumbered",
      "arrears",
      "annualAuthority",
      "grossAnnualClaim",
      "lastAuthorityPaid",
    ] as const)
      expect(accounts.kept[0][key] + accounts.moved[0][key]).toBe(source[key]);
    expect(accounts.moved[0].sourceTurn).toBe(300);
    expect(accounts.moved[0].accruedThroughTurn).toBe(299);
    const split = splitLiveTreasury(treasury("UK"), treasury("SCO"), weight, 300, accounts.idMap);
    reconcileSplitTreasuryClaims(treasury("UK"), split.kept, split.moved, accounts.moved, [source]);
    for (const key of ["cash", "debt", "debtCeiling", "emergencyAdvance"] as const)
      expect(split.kept[key] + split.moved[key]).toBeCloseTo(treasury("UK")[key], 10);
    expect(
      (split.moved.claimArrears?.["SCO:health"] ?? 0) + split.kept.claimArrears!["UK:health"]
    ).toBe(33);
    expect(split.moved.arrears.existing + split.kept.arrears.existing).toBe(33);
    expect(accounts.moved[0].unpaidAuthority).toBe(split.moved.claimArrears?.["SCO:health"]);
    expect(split.moved.settledThroughTurn).toBe(299);
  });
  it("keeps claim categories aligned when a mandatory source maps to an ordinary account", () => {
    const source = treasury("UK");
    source.arrears = { interest: 0, mandatory: 33, grants: 0, existing: 0, new: 0 };
    source.lastPaid = { interest: 0, mandatory: 101, grants: 0, existing: 0, new: 0 };
    const split = splitLiveTreasury(source, treasury("SCO"), 0.5, 300, {
      "UK:health": "SCO:health",
    });
    reconcileSplitTreasuryClaims(
      source,
      split.kept,
      split.moved,
      [account("SCO")],
      [{ ...account("UK"), externallySettled: true }]
    );
    expect(split.kept.arrears.mandatory).toBe(17);
    expect(split.kept.arrears.existing).toBe(0);
    expect(split.moved.arrears.mandatory).toBe(0);
    expect(split.moved.arrears.existing).toBe(16);
    expect(split.kept.lastPaid!.mandatory).toBe(51);
    expect(split.moved.lastPaid!.existing).toBe(50);
  });
  it("carries Cabinet requests over as whole percents instead of rescaling them", () => {
    const source = {
      ...account("UK"),
      familyGrossAnnualDemand: { L01: 1003, L02: 500, L03: 200 },
      familyAnnualDemand: { L01: 1003, L02: 500, L03: 200 },
      grossAnnualClaim: 1703,
      annualAuthority: 1703,
      programAllocationPercents: { L01: 100, L02: 150, L03: 100 },
    };
    const accounts = splitLiveDepartmentAccounts(
      [source],
      [account("SCO")],
      DEPARTMENT_DEFINITIONS,
      0.3,
      299
    );
    expect(accounts.moved[0].programAllocationPercents).toEqual({ L01: 100, L02: 150, L03: 100 });
    expect(accounts.kept[0].programAllocationPercents).toEqual({ L01: 100, L02: 150, L03: 100 });
  });
  it("refuses a partially advanced cash book", () => {
    expect(() =>
      splitLiveDepartmentAccounts(
        [{ ...account("UK"), accruedThroughTurn: 298 }],
        [account("SCO")],
        DEPARTMENT_DEFINITIONS,
        0.1,
        299
      )
    ).toThrow("turns disagree");
    expect(() => splitLiveTreasury(treasury("UK"), treasury("SCO"), 0.1, 301)).toThrow(
      "not current"
    );
  });
});
