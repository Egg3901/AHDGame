import { describe, expect, it } from "vitest";
import { DEPARTMENT_DEFINITIONS } from "@/lib/governmentFinance/departmentCatalog";
import { includedAuthorityPerTurn } from "@/lib/governmentFinance/rules/appropriation";
import { buildOpeningDepartmentBoards1991 } from "../openingDepartmentBoards1991";
import { openingFiscalBooks1991 } from "../opening1991";
import { openingNamedGrantClaims1991 } from "../openingOwnership1991";
import { buildOpeningDepartmentFundingPartition } from "./liveDepartmentAccount";
import { settleLiveDepartmentTurn } from "./liveDepartmentTurn";

const fiscal = openingFiscalBooks1991();
const { accounts } = buildOpeningDepartmentFundingPartition(
  buildOpeningDepartmentBoards1991("world-1991", 1),
  DEPARTMENT_DEFINITIONS,
  { US: fiscal.US.grants, UK: fiscal.UK.grants, JP: fiscal.JP.grants },
  openingNamedGrantClaims1991()
);

describe("v2 live Cabinet period settlement", () => {
  it("accrues each country's ordinary 1991 authority exactly over 240 turns", () => {
    for (const countryId of ["US", "UK", "JP"] as const) {
      let paid = 0;
      let outlaid = 0;
      for (const original of accounts.filter(
        (entry) => entry.countryId === countryId && !entry.externallySettled
      )) {
        let account = original;
        for (let turn = 2; turn <= 241; turn += 1) {
          const result = settleLiveDepartmentTurn({
            account,
            turn,
            authorityPaid: Object.values(account.familyAnnualDemand).reduce(
              (sum, amount) => sum + includedAuthorityPerTurn(amount, turn),
              0
            ),
          });
          account = result.next;
          paid += result.settlement!.authorityAccrued;
          outlaid += result.settlement!.totalOutlays;
          expect(result.settlement!.overdraft).toBe(0);
          expect(result.settlement!.closingArrears).toBe(0);
        }
        expect(account.balance).toBe(0);
      }
      const expected = accounts
        .filter((entry) => entry.countryId === countryId && !entry.externallySettled)
        .reduce((sum, entry) => sum + entry.annualAuthority * 5, 0);
      expect(paid).toBe(expected);
      expect(outlaid).toBe(expected);
    }
  });

  it("can underfund one service and reallocate to another without a second treasury debit", () => {
    const original = accounts.find(
      (entry) =>
        entry.countryId === "US" &&
        !entry.externallySettled &&
        Object.keys(entry.familyAnnualDemand).length >= 2
    )!;
    const [reduced, expanded] = Object.keys(original.familyAnnualDemand);
    const authored = {
      ...original,
      programAllocationPercents: { [reduced!]: 50, [expanded!]: 150 },
    };
    const due = Object.values(authored.familyAnnualDemand).reduce(
      (sum, amount) => sum + includedAuthorityPerTurn(amount, 2),
      0
    );
    const result = settleLiveDepartmentTurn({
      account: authored,
      turn: 2,
      authorityPaid: due,
    });
    expect(result.settlement!.authorityAccrued).toBe(due);
    expect(result.settlement!.totalOutlays).toBeLessThanOrEqual(due);
    expect(
      result.settlement!.programs.find((entry) => entry.programId === reduced)!.implementation
        .coverageRatio
    ).toBeLessThan(1);
    expect(
      result.settlement!.programs.find((entry) => entry.programId === expanded)!.requested
    ).toBeGreaterThan(0);
    expect(result.next.arrears).toBe(0);
    expect(result.next.lastAuthorityPaid).toBe(due);
    expect(Object.keys(result.next.lastProgramDelivery)).toEqual(
      result.settlement!.programs.map((program) => program.programId)
    );
    for (const program of result.settlement!.programs) {
      expect(result.next.lastProgramDelivery[program.programId]).toEqual({
        requested: program.requested,
        outlaid: program.outlaid,
        implementationFactor: program.implementation.implementationFactor,
      });
    }
    expect(
      Object.values(result.next.lastProgramDelivery).reduce(
        (sum, program) => sum + program.outlaid,
        0
      )
    ).toBe(result.settlement!.programOutlays);
    expect(
      settleLiveDepartmentTurn({ account: result.next, turn: 2, authorityPaid: due }).settlement
        ?.replayed
    ).toBe(true);
    expect(() =>
      settleLiveDepartmentTurn({ account: result.next, turn: 2, authorityPaid: 0 })
    ).toThrow("replay differs");
  });

  it("refuses unpaid, excessive, and specialized-authority claims", () => {
    const ordinary = accounts.find((entry) => !entry.externallySettled)!;
    const specialist = accounts.find((entry) => entry.externallySettled)!;
    const due = Object.values(ordinary.familyAnnualDemand).reduce(
      (sum, amount) => sum + includedAuthorityPerTurn(amount, 2),
      0
    );
    expect(() =>
      settleLiveDepartmentTurn({ account: ordinary, turn: 2, authorityPaid: due + 1 })
    ).toThrow("did not schedule");
    expect(() =>
      settleLiveDepartmentTurn({ account: specialist, turn: 2, authorityPaid: 1 })
    ).toThrow("existing account shell");
    expect(
      settleLiveDepartmentTurn({ account: specialist, turn: 3, authorityPaid: 0 }).capacityBasis
    ).toBe("externally-settled");
    expect(() =>
      settleLiveDepartmentTurn({ account: ordinary, turn: 4, authorityPaid: 0 })
    ).toThrow("advance once");
    expect(() =>
      settleLiveDepartmentTurn({
        account: { ...ordinary, programAllocationPercents: { bogus: 100 } },
        turn: 2,
        authorityPaid: 0,
      })
    ).toThrow("Unknown Cabinet family");
  });
});
