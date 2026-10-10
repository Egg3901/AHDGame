import { describe, expect, it } from "vitest";
import { DEPARTMENT_DEFINITIONS } from "@/lib/governmentFinance/departmentCatalog";
import { getCabinetPositions } from "@/lib/constants/cabinetMechanics";
import { missingCabinetAccounts } from "./accountRoster";
import { resetActionsForSeat } from "../catalog";
import { useCabinetAction as activateCabinetAction } from "./actions";
import { cabinetActionFunding } from "./actionFunding";

describe("Cabinet account and administrative coverage", () => {
  for (const countryId of ["US", "UK", "JP", "IE", "SCO", "WAL"] as const) {
    it(`gives every ${countryId} office an account and cash-free work`, () => {
      const accounts = missingCabinetAccounts({
        definitions: DEPARTMENT_DEFINITIONS,
        accounts: [],
        worldId: "world",
        countryId,
        sourceTurn: 1,
        currentTurn: 100,
      });
      for (const seat of getCabinetPositions(countryId)) {
        const own = accounts.filter((account) => account.controllingSeatId === seat.id);
        expect(own.length, seat.id).toBeGreaterThan(0);
        const action = resetActionsForSeat(countryId, seat.id).find(
          (row) => row.costClass === "Staff"
        );
        expect(action, seat.id).toBeDefined();
        const funding = cabinetActionFunding({ accounts: own, defenseSeat: false });
        const used = activateCabinetAction({
          action: action!,
          turn: 100,
          actor: { charges: 4, lastRechargeTurn: 100 },
          seatActive: true,
          legalAuthority: true,
          capacityAvailable: true,
          annualNationalGdp: 1_000_000_000,
          flexibleOperatingFunds: funding.flexibleFunds,
          active: [],
          history: [],
        });
        expect(used.allowed, seat.id).toBe(true);
        expect(used.operatingDebit, seat.id).toBe(0);
      }
      expect(
        accounts.every(
          (account) =>
            account.balance === 0 &&
            account.annualAuthority === 0 &&
            account.accruedThroughTurn === 100
        )
      ).toBe(true);
      expect(
        missingCabinetAccounts({
          definitions: DEPARTMENT_DEFINITIONS,
          accounts,
          worldId: "world",
          countryId,
          sourceTurn: 1,
          currentTurn: 100,
        })
      ).toEqual([]);
    });
  }

  it("does not replace funded accounts or erase obligations", () => {
    const input = {
      definitions: DEPARTMENT_DEFINITIONS,
      accounts: [],
      worldId: "world",
      countryId: "JP" as const,
      sourceTurn: 1,
      currentTurn: 10,
    };
    const existing = {
      ...missingCabinetAccounts(input)[0]!,
      balance: 125,
      encumbered: 30,
      arrears: 7,
    };
    const additions = missingCabinetAccounts({ ...input, accounts: [existing] });
    expect(additions.some((row) => row._id === existing._id)).toBe(false);
    expect(existing).toMatchObject({ balance: 125, encumbered: 30, arrears: 7 });
  });
});

describe("action funding", () => {
  it("uses only unencumbered ordinary account cash", () => {
    expect(
      cabinetActionFunding({
        accounts: [
          { balance: 100, encumbered: 40, externallySettled: false },
          { balance: 999, encumbered: 0, externallySettled: true },
        ],
        defenseSeat: false,
      })
    ).toEqual({ source: "department", flexibleFunds: 60 });
  });
  it("keeps Defense on its appropriation and other specialized budgets isolated", () => {
    expect(
      cabinetActionFunding({
        accounts: [],
        defenseSeat: true,
        defenseAppropriation: { balance: 100, encumbered: 70 },
      })
    ).toEqual({ source: "defense", flexibleFunds: 30 });
    expect(
      cabinetActionFunding({
        accounts: [{ balance: 999, encumbered: 0, externallySettled: true }],
        defenseSeat: false,
      })
    ).toEqual({ source: "none", flexibleFunds: 0 });
  });
});
