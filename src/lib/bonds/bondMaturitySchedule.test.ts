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
 *
 * Amounts are ₳ throughout. A corporation's bonds do not all share one
 * currency once it has relocated, so the caller normalizes before summing.
 */
const live = (over: Partial<BondMaturityScheduleBond> = {}): BondMaturityScheduleBond => ({
  principalAnchor: 1_000_000,
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
        live({ principalAnchor: 4_000_000, maturityTurn: 340 }),
        live({ principalAnchor: 1_000_000, maturityTurn: 196 }),
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
        live({ principalAnchor: 1_000_000, maturityTurn: 196 }),
        live({ principalAnchor: 2_500_000, maturityTurn: 196 }),
        live({ principalAnchor: 9_000_000, maturityTurn: 436 }),
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
        live({ principalAnchor: 7_000_000, maturityTurn: 110, matured: true }),
        live({ principalAnchor: 3_000_000, maturityTurn: 120, defaulted: true }),
        live({ principalAnchor: 1_000_000, maturityTurn: 300 }),
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

  it("returns an empty schedule when the bond list is missing", () => {
    // The corporation page reads `bondInfo.bonds` with optional chaining, so an
    // absent list is a shape this can be handed, not an impossible one.
    const schedule = bondMaturitySchedule(undefined, 100);
    expect(schedule).toEqual({ totalPrincipalDue: 0, next: null, approaching: false });
  });

  it("skips a bond with no face value instead of poisoning the total", () => {
    // The bonds route's redaction branch emits rows with maturity fields only.
    const schedule = bondMaturitySchedule(
      [
        {
          principalAnchor: undefined as unknown as number,
          maturityTurn: 150,
          matured: false,
          defaulted: false,
        },
        live({ principalAnchor: 2_000_000, maturityTurn: 300 }),
      ],
      100
    );
    expect(schedule.totalPrincipalDue).toBe(2_000_000);
    expect(schedule.next?.maturityTurn).toBe(300);
  });

  it("returns an empty schedule rather than NaN turns when the turn is unknown", () => {
    const schedule = bondMaturitySchedule([live()], Number.NaN);
    expect(schedule.next).toBeNull();
    expect(schedule.approaching).toBe(false);
  });
});
