import { describe, expect, it } from "vitest";
import {
  SEED_UPKEEP_TARGET_SHARE,
  accrualPerTurn,
  upkeepPerTurn,
  overdraftFloor,
  settleAppropriation,
  upkeepBurden,
} from "./appropriation";

// 48,000/yr = 1,000/turn, which keeps every expectation below readable by hand.
const LINE = 48_000;

describe("accrualPerTurn", () => {
  it("is a 48th of the annual line", () => {
    expect(accrualPerTurn(LINE)).toBe(1_000);
  });

  it("is zero for an unusable line rather than negative", () => {
    expect(accrualPerTurn(0)).toBe(0);
    expect(accrualPerTurn(-5)).toBe(0);
  });
});

describe("upkeepPerTurn", () => {
  // This is the property that makes a seed-day arrears failure impossible: at seed the
  // live roster IS the table entry, so the share is exactly the target.
  it("charges exactly the target share at the seeded roster", () => {
    expect(upkeepPerTurn(2_000, 2_000, LINE)).toBeCloseTo(1_000 * SEED_UPKEEP_TARGET_SHARE, 9);
  });

  it("scales linearly with the roster — double the army, double the share", () => {
    expect(upkeepPerTurn(4_000, 2_000, LINE)).toBeCloseTo(2 * upkeepPerTurn(2_000, 2_000, LINE), 9);
  });

  // MILITARY_COUNTRY_SCALE is inside computeEffectiveUpkeep, so it is present in BOTH the
  // live roster and the table entry and cancels. Re-applying it would double-scale RU.
  it("cancels the country cost scale, which sits on both sides of the ratio", () => {
    expect(upkeepPerTurn(2_000 * 2.6, 2_000 * 2.6, LINE)).toBeCloseTo(
      upkeepPerTurn(2_000, 2_000, LINE),
      9
    );
  });

  it("charges nothing rather than dividing by zero or guessing", () => {
    expect(upkeepPerTurn(2_000, 0, LINE)).toBe(0);
    expect(upkeepPerTurn(2_000, 2_000, 0)).toBe(0);
    expect(upkeepPerTurn(2_000, -1, LINE)).toBe(0);
  });

  it("charges nothing for a country with no force", () => {
    expect(upkeepPerTurn(0, 2_000, LINE)).toBe(0);
  });
});

describe("settleAppropriation", () => {
  const FLOOR = overdraftFloor(LINE);

  it("makes the overdraft floor one year's accrual", () => {
    expect(FLOOR).toBe(LINE);
  });

  it("pays upkeep from the balance and reports no arrears", () => {
    const s = settleAppropriation(5_000, 1_000, 600, FLOOR);
    expect(s.balance).toBe(5_400);
    expect(s.paid).toBe(600);
    expect(s.arrearsRatio).toBe(0);
    expect(s.overdraftDrawn).toBe(0);
  });

  it("draws the overdraft before it will leave upkeep unpaid", () => {
    const s = settleAppropriation(0, 1_000, 3_000, FLOOR);
    expect(s.paid).toBe(3_000);
    expect(s.balance).toBe(-2_000);
    expect(s.overdraftDrawn).toBe(2_000);
    expect(s.arrearsRatio).toBe(0);
  });

  it("stops at the overdraft floor and reports the unfunded share", () => {
    // −47,500 + 1,000 accrual leaves 1,500 above the −48,000 floor; 3,000 was due.
    const s = settleAppropriation(-47_500, 1_000, 3_000, FLOOR);
    expect(s.balance).toBe(-FLOOR);
    expect(s.paid).toBe(1_500);
    expect(s.overdraftDrawn).toBe(1_500);
    expect(s.arrearsRatio).toBeCloseTo(0.5, 9);
  });

  it("reports full arrears when nothing at all can be paid", () => {
    const s = settleAppropriation(-FLOOR, 0, 3_000, FLOOR);
    expect(s.paid).toBe(0);
    expect(s.balance).toBe(-FLOOR);
    expect(s.overdraftDrawn).toBe(0);
    expect(s.arrearsRatio).toBe(1);
  });

  it("reports no arrears when there is no upkeep to fund", () => {
    const s = settleAppropriation(-FLOOR, 0, 0, FLOOR);
    expect(s.arrearsRatio).toBe(0);
  });

  it("never lets the balance fall below the floor", () => {
    const s = settleAppropriation(-FLOOR, 0, 1_000_000, FLOOR);
    expect(s.balance).toBe(-FLOOR);
  });

  // A country with no defence line has floor 0, so it cannot borrow at all — it simply
  // reports full arrears rather than accumulating phantom debt.
  it("cannot overdraw a country with no defence line", () => {
    const s = settleAppropriation(0, 0, 500, overdraftFloor(0));
    expect(s.balance).toBe(0);
    expect(s.paid).toBe(0);
    expect(s.arrearsRatio).toBe(1);
  });
});

describe("upkeepBurden", () => {
  // The signal both Defense metrics read. It replaced a synthetic envelope whose floor was
  // country-independent, so 26 of 27 live nations divided by the identical constant.
  it("is the share of a turn's income the force consumes", () => {
    expect(upkeepBurden(55, 100)).toBeCloseTo(0.55, 6);
    expect(upkeepBurden(150, 100)).toBeCloseTo(1.5, 6);
  });

  // Reduces to SEED_UPKEEP_TARGET_SHARE x (liveRoster / seedRoster): both terms are the same
  // country's own money, which is what makes it comparable across nations and eras with no
  // shared constant. A country at its seeded force reads 0.55 in any currency or decade.
  it("reads the calibration share for a country at its seeded roster", () => {
    const line = 4_800;
    const accrual = accrualPerTurn(line);
    const atSeed = upkeepPerTurn(1_000, 1_000, line);
    expect(upkeepBurden(atSeed, accrual)).toBeCloseTo(SEED_UPKEEP_TARGET_SHARE, 6);

    const doubled = upkeepPerTurn(2_000, 1_000, line);
    expect(upkeepBurden(doubled, accrual)).toBeCloseTo(SEED_UPKEEP_TARGET_SHARE * 2, 6);
  });

  // ⚠️ The contract the whole design rests on. null and 0 are OPPOSITE readings: 0 means the
  // force costs nothing to sustain — the most positive score available — while null means
  // there is no defence line to measure against and the metric must stay silent. Returning 0
  // here would hand every unfunded country a maximal budget balance.
  it("returns null — never 0 — when there is no usable defence line", () => {
    expect(upkeepBurden(500, 0)).toBeNull();
    expect(upkeepBurden(500, -1)).toBeNull();
    expect(upkeepBurden(0, 0)).toBeNull();
  });

  it("returns a real 0 for a real force that costs nothing", () => {
    expect(upkeepBurden(0, 100)).toBe(0);
  });

  // The trap this contract has to survive: `upkeepPerTurn` returns 0 for an unmeasurable
  // seed roster, and 0 against a real accrual is a burden of 0 — the MAXIMAL score. Callers
  // must check the seed themselves; `upkeepBurden` cannot tell the two apart from numbers
  // alone. `militaryForceEffects` does exactly that.
  it("cannot distinguish an unmeasurable seed from a free force — callers must", () => {
    const line = 4_800;
    const unmeasurable = upkeepPerTurn(1_000, 0, line);
    expect(unmeasurable).toBe(0);
    // Reads as the most positive value available, which is why the call site guards first.
    expect(upkeepBurden(unmeasurable, accrualPerTurn(line))).toBe(0);
  });

  it("never reports a negative burden", () => {
    expect(upkeepBurden(-50, 100)).toBe(0);
  });

  // ⚠️ Documents a LIMITATION, not a feature, so nobody re-asserts that this tracks budget.
  // `upkeepPerTurn` is itself `accrual x 0.55 x (live/seed)`, so dividing by accrual cancels
  // the defence line entirely. A minister who triples or guts the line moves this by nothing.
  // Making it budget-sensitive means pinning the seed calibration to a fixed currency amount
  // rather than to the live accrual — a design change, not a rename.
  it("is INVARIANT to the defence line — the accrual cancels", () => {
    const roster = 1_000;
    const burdens = [1e12, 1e9, 4_800, 1, 1e-6].map((line) =>
      upkeepBurden(upkeepPerTurn(roster, roster, line), accrualPerTurn(line))
    );
    for (const b of burdens) expect(b).toBeCloseTo(SEED_UPKEEP_TARGET_SHARE, 9);
  });

  // The corollary, and the reason the invariance is worth writing down: upkeep is a share of
  // your own accrual, so a country that zeroes its defence line owes nothing and can never
  // fall into arrears — its army holds full readiness for free.
  it("cannot produce arrears from cutting the line, because upkeep scales with it", () => {
    for (const line of [48_000, 4_800, 48]) {
      const settled = settleAppropriation(
        0,
        accrualPerTurn(line),
        upkeepPerTurn(1_000, 1_000, line),
        overdraftFloor(line)
      );
      expect(settled.arrearsRatio).toBe(0);
    }
  });
});
