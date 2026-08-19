import { describe, expect, it } from "vitest";
import {
  EQUIPMENT_TRACK_MAX,
  lotsRequired,
  equipUnit,
  blendGrade,
  refitOrder,
  lotsToFillUnit,
  lotPrice,
  MATERIEL_SHARE_OF_UNIT_COST,
} from "./arsenal";

// Ticket #1134 pacing calibration, pinned against the live world so the dial cannot drift
// silently. `MATERIEL_SHARE_OF_UNIT_COST` is the ONE lever that moves arsenal pacing: a unit's
// materiel bill is this share of its price and the procurement budget per turn is fixed, so
// time-to-equip is directly proportional to it.
describe("arsenal pacing", () => {
  // Measured on prod: the US contracting window ran 4,604,985,708 over 12 turns, i.e.
  // 383,748,809 of procurement per turn, and a lot priced at 383,748,809 under the old 0.35
  // share. One lot per turn, exactly what the original calibration targeted.
  const US_PROCUREMENT_PER_TURN = 383_748_809;
  const US_ANCHORED_GDP = 383_748_809 / (0.35 / 1_000);

  it("prices the live US lot at the reworked share", () => {
    expect(lotPrice("US", US_ANCHORED_GDP)).toBe(219_285_034);
  });

  it("fills between 1.5x and 2x faster than the one lot per turn baseline", () => {
    const price = lotPrice("US", US_ANCHORED_GDP)!;
    const lotsPerTurn = US_PROCUREMENT_PER_TURN / price;
    expect(lotsPerTurn).toBeGreaterThan(1.5);
    expect(lotsPerTurn).toBeLessThan(2.0);
    expect(lotsPerTurn).toBeCloseTo(1.75, 2);
  });

  // The granularity divisor the two derived constants share CANNOT do this job: halving it
  // halves the lot price and doubles the lots a platform needs, which leaves time-to-equip
  // unchanged. Only the share moves pacing, which is why it is the single dial.
  it("leaves a platform's lot requirement untouched, so pacing comes from price alone", () => {
    expect(lotsRequired({ cost: 1_548 })).toBe(4);
    expect(MATERIEL_SHARE_OF_UNIT_COST).toBe(0.2);
  });
});

describe("lotsRequired", () => {
  it("scales with what the unit costs to build", () => {
    expect(lotsRequired({ cost: 4200 })).toBeGreaterThan(lotsRequired({ cost: 1600 }));
  });

  it("is always at least one lot — nothing is equipped from nothing", () => {
    expect(lotsRequired({ cost: 0 })).toBeGreaterThanOrEqual(1);
    expect(lotsRequired({ cost: -5 })).toBeGreaterThanOrEqual(1);
  });

  it("is a whole number of lots", () => {
    expect(Number.isInteger(lotsRequired({ cost: 1600 }))).toBe(true);
  });
});

describe("equipUnit", () => {
  it("delivers full equipment at the arsenal's grade when fully supplied", () => {
    const r = equipUnit(10, 10, 2);
    expect(r.techTier).toBe(2);
    expect(r.equipment).toEqual({
      firepower: EQUIPMENT_TRACK_MAX,
      protection: EQUIPMENT_TRACK_MAX,
      support: EQUIPMENT_TRACK_MAX,
    });
  });

  // The whole point of the design: an empty store yields a hollow formation, never a
  // refused button.
  it("delivers a hollow formation from an empty arsenal rather than refusing", () => {
    const r = equipUnit(0, 10, 2);
    expect(r.techTier).toBe(0);
    expect(r.equipment).toEqual({ firepower: 0, protection: 0, support: 0 });
  });

  it("scales equipment by the fill fraction", () => {
    const half = equipUnit(5, 10, 3);
    const full = equipUnit(10, 10, 3);
    expect(half.equipment.firepower).toBeLessThan(full.equipment.firepower);
    expect(half.equipment.firepower).toBeGreaterThan(0);
  });

  // Grade and fill are orthogonal on purpose: grade is what the industry can BUILD,
  // fill is how much ARRIVED. Advanced industry with no throughput fields good-tier
  // units with empty racks.
  it("keeps tier at the arsenal grade even when barely supplied", () => {
    expect(equipUnit(1, 10, 3).techTier).toBe(3);
  });

  it("never exceeds tier 3 and never emits a fractional tier", () => {
    const r = equipUnit(10, 10, 99);
    expect(r.techTier).toBe(3);
    expect(Number.isInteger(r.techTier)).toBe(true);
  });

  it("clamps a negative grade rather than emitting a negative tier", () => {
    expect(equipUnit(10, 10, -2).techTier).toBe(0);
  });

  it("treats a zero requirement as fully supplied rather than dividing by zero", () => {
    expect(() => equipUnit(0, 0, 1)).not.toThrow();
    expect(equipUnit(0, 0, 1).techTier).toBe(1);
    expect(equipUnit(0, 0, 1).equipment.firepower).toBe(EQUIPMENT_TRACK_MAX);
  });

  it("cannot be over-supplied past full", () => {
    expect(equipUnit(999, 10, 2).equipment.firepower).toBe(EQUIPMENT_TRACK_MAX);
  });

  it("emits whole-number equipment tracks", () => {
    for (const drawn of [0, 1, 3, 5, 7, 10]) {
      const eq = equipUnit(drawn, 10, 2).equipment;
      for (const v of Object.values(eq)) expect(Number.isInteger(v)).toBe(true);
    }
  });
});

describe("blendGrade", () => {
  it("is the incoming grade when the store was empty", () => {
    expect(blendGrade(0, 0, 100, 3)).toBe(3);
  });

  it("is volume-weighted between stored and incoming", () => {
    expect(blendGrade(100, 1, 100, 3)).toBeCloseTo(2, 9);
    expect(blendGrade(300, 1, 100, 3)).toBeCloseTo(1.5, 9);
  });

  it("is unchanged by a zero delivery", () => {
    expect(blendGrade(100, 1.5, 0, 3)).toBeCloseTo(1.5, 9);
  });

  it("is zero when there is nothing on either side", () => {
    expect(blendGrade(0, 0, 0, 0)).toBe(0);
  });
});

describe("lotsToFillUnit", () => {
  it("is what remains between the unit's kit and a full load", () => {
    const bare = { equipment: { firepower: 0, protection: 0, support: 0 } } as never;
    const full = {
      equipment: {
        firepower: EQUIPMENT_TRACK_MAX,
        protection: EQUIPMENT_TRACK_MAX,
        support: EQUIPMENT_TRACK_MAX,
      },
    } as never;
    expect(lotsToFillUnit(bare, 10)).toBe(10);
    expect(lotsToFillUnit(full, 10)).toBe(0);
  });

  it("never asks for a negative number of lots", () => {
    const over = { equipment: { firepower: 99, protection: 99, support: 99 } } as never;
    expect(lotsToFillUnit(over, 10)).toBe(0);
  });
});

describe("refitOrder", () => {
  const unit = (fp: number) => ({ equipment: { firepower: fp, protection: fp, support: fp } });

  // Nearest-to-complete first, so scarce lots produce usable formations instead of every
  // unit crawling upward together and none becoming combat-worthy.
  it("puts the nearest-to-complete unit first", () => {
    const near = unit(2) as never;
    const far = unit(0) as never;
    expect(refitOrder([far, near])[0]).toBe(near);
  });

  it("does not mutate the input array", () => {
    const list = [unit(0), unit(2)] as never[];
    const copy = [...list];
    refitOrder(list);
    expect(list).toEqual(copy);
  });

  it("handles an empty force", () => {
    expect(refitOrder([])).toEqual([]);
  });

  it("tolerates a unit with missing equipment rather than throwing", () => {
    const legacy = {} as never;
    expect(() => refitOrder([legacy, unit(1) as never])).not.toThrow();
  });
});
