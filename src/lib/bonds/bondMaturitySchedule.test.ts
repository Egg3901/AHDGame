import { describe, expect, it } from "vitest";
import {
  BOND_MATURITY_WARNING_TURNS,
  bondMaturitySchedule,
  type BondMaturityScheduleBond,
} from "./bondMaturitySchedule";

/**
 * Players issue a bond, spend the proceeds, and are then surprised on the
 * maturity turn when the whole face value leaves liquid capital at once. The
 * Bonds tab had no figure for that repayment anywhere, so this helper produces
 * it: total principal still owed, and the next repayment date with its amount.
 */
const live = (over: Partial<BondMaturityScheduleBond> = {}): BondMaturityScheduleBond => ({
  totalIssued: 1_000_000,
  maturityTurn: 200,
  matured: false,
  defaulted: false,
  ...over,
});

describe("bondMaturitySchedule", () => {
  it("returns no schedule when the corporation has no bonds", () => {
    const schedule = bondMaturitySchedule([], 100);
    expect(schedule.totalPrincipalDue).toBe(0);
    expect(schedule.next).toBeNull();
    expect(schedule.approaching).toBe(false);
  });

  it("sums principal across live bonds and reports the soonest repayment", () => {
    const schedule = bondMaturitySchedule(
      [
        live({ totalIssued: 4_000_000, maturityTurn: 340 }),
        live({ totalIssued: 1_000_000, maturityTurn: 196 }),
      ],
      100
    );
    expect(schedule.totalPrincipalDue).toBe(5_000_000);
    expect(schedule.next).toEqual({
      maturityTurn: 196,
      turnsRemaining: 96,
      amount: 1_000_000,
      bondCount: 1,
    });
  });

  it("groups bonds that come due on the same turn into one repayment", () => {
    const schedule = bondMaturitySchedule(
      [
        live({ totalIssued: 1_000_000, maturityTurn: 196 }),
        live({ totalIssued: 2_500_000, maturityTurn: 196 }),
        live({ totalIssued: 9_000_000, maturityTurn: 436 }),
      ],
      100
    );
    expect(schedule.next).toEqual({
      maturityTurn: 196,
      turnsRemaining: 96,
      amount: 3_500_000,
      bondCount: 2,
    });
  });

  it("excludes matured and defaulted bonds from principal and from the next repayment", () => {
    const schedule = bondMaturitySchedule(
      [
        live({ totalIssued: 7_000_000, maturityTurn: 110, matured: true }),
        live({ totalIssued: 3_000_000, maturityTurn: 120, defaulted: true }),
        live({ totalIssued: 1_000_000, maturityTurn: 300 }),
      ],
      100
    );
    expect(schedule.totalPrincipalDue).toBe(1_000_000);
    expect(schedule.next?.maturityTurn).toBe(300);
  });

  it("returns no schedule when every bond is already matured or defaulted", () => {
    const schedule = bondMaturitySchedule(
      [live({ maturityTurn: 110, matured: true }), live({ maturityTurn: 120, defaulted: true })],
      100
    );
    expect(schedule.totalPrincipalDue).toBe(0);
    expect(schedule.next).toBeNull();
    expect(schedule.approaching).toBe(false);
  });

  it("flags the repayment as approaching once it is within the warning window", () => {
    const atThreshold = bondMaturitySchedule(
      [live({ maturityTurn: 100 + BOND_MATURITY_WARNING_TURNS })],
      100
    );
    expect(atThreshold.next?.turnsRemaining).toBe(BOND_MATURITY_WARNING_TURNS);
    expect(atThreshold.approaching).toBe(true);

    const justOutside = bondMaturitySchedule(
      [live({ maturityTurn: 101 + BOND_MATURITY_WARNING_TURNS })],
      100
    );
    expect(justOutside.approaching).toBe(false);
  });

  it("warns at 24 turns out, not a game year", () => {
    expect(BOND_MATURITY_WARNING_TURNS).toBe(24);
  });

  it("clamps a bond already past its maturity turn to zero turns remaining", () => {
    const schedule = bondMaturitySchedule([live({ maturityTurn: 96 })], 100);
    expect(schedule.next?.turnsRemaining).toBe(0);
    expect(schedule.approaching).toBe(true);
  });
});
