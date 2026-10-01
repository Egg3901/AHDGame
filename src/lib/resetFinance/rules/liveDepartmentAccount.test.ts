import { describe, expect, it } from "vitest";
import { DEPARTMENT_DEFINITIONS } from "@/lib/governmentFinance/departmentCatalog";
import { buildOpeningDepartmentBoards1991 } from "../openingDepartmentBoards1991";
import { openingFiscalBooks1991 } from "../opening1991";
import { openingNamedGrantClaims1991 } from "../openingOwnership1991";
import {
  buildOpeningDepartmentFundingPartition,
  openingDepartmentAccountsPayload,
  openingDepartmentContinuityPayload,
} from "./liveDepartmentAccount";

describe("1991 v2 live Cabinet account opening", () => {
  const boards = buildOpeningDepartmentBoards1991("world-1991", 1);
  const fiscal = openingFiscalBooks1991();
  const grants = { US: fiscal.US.grants, UK: fiscal.UK.grants, JP: fiscal.JP.grants };
  const namedGrants = openingNamedGrantClaims1991();

  it("resolves funded 1991 Cabinet seats and partitions the existing operating claim", () => {
    const { accounts, continuity } = buildOpeningDepartmentFundingPartition(
      boards,
      DEPARTMENT_DEFINITIONS,
      grants,
      namedGrants
    );
    for (const board of boards) {
      const countryAccounts = accounts.filter((row) => row.countryId === board.countryId);
      const countryContinuity = continuity.find((row) => row.countryId === board.countryId)!;
      expect(countryAccounts.length).toBeGreaterThan(0);
      expect(
        countryAccounts.reduce((sum, row) => sum + row.annualAuthority, 0) +
          countryContinuity.annualAuthority +
          grants[board.countryId]
      ).toBeCloseTo(board.operating, 2);
      expect(
        countryAccounts.reduce((sum, row) => sum + row.grantReservation, 0) +
          countryContinuity.grantReservation
      ).toBe(grants[board.countryId]);
      expect(countryAccounts.every((row) => row.balance === 0)).toBe(true);
      expect(countryAccounts.every((row) => row.accruedThroughTurn === 1)).toBe(true);
    }
    expect(accounts.find((row) => row.departmentId === "us_education_department")).toBeDefined();
    expect(
      accounts.find((row) => row.departmentId === "us_defense_department")?.externallySettled
    ).toBe(true);
    expect(
      accounts.find((row) => row.departmentId === "us_defense_department")?.grantReservation
    ).toBe(0);
    expect(
      accounts.find((row) => row.departmentId === "us_health_department")?.externallySettled
    ).toBe(false);
    const jpGrantOwner = accounts.find(
      (row) => row.countryId === "JP" && row.familyGrantReservation.L08
    );
    expect(jpGrantOwner?.familyGrantReservation.L08).toBe(fiscal.JP.grants);
    const ukGrantOwner = accounts.find(
      (row) => row.countryId === "UK" && row.familyGrantReservation.L06
    );
    expect(ukGrantOwner?.familyGrantReservation.L06).toBe(fiscal.UK.grants);
    expect(continuity.find((row) => row.countryId === "US")?.grantReservation).toBe(
      fiscal.US.grants
    );
    expect(continuity.find((row) => row.countryId === "UK")?.grantReservation).toBe(0);
    expect(continuity.find((row) => row.countryId === "JP")?.grantReservation).toBe(0);
    expect(openingDepartmentAccountsPayload(accounts)).toBe(
      openingDepartmentAccountsPayload([...accounts].reverse())
    );
    expect(openingDepartmentContinuityPayload(continuity)).toBe(
      openingDepartmentContinuityPayload([...continuity].reverse())
    );
  });

  it("fails closed if a funded Cabinet seat has no unique 1991 department", () => {
    expect(() => buildOpeningDepartmentFundingPartition(boards, [], grants, namedGrants)).toThrow(
      "Ambiguous 1991 department"
    );
  });
});
