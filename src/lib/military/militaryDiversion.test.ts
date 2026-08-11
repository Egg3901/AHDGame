import { describe, expect, it } from "vitest";
import { lotsFromSector, militaryDivertedShare, freshMilitaryDiversion } from "./arsenal";

/**
 * Output shipped to a state arsenal is paid for per lot and must not ALSO be sold on the
 * market. Before this, a contracted plant supplied its full output to the world and collected
 * the contract price on top — one plant's production paid for twice, scaling with however
 * many contracts a friendly minister chose to write.
 */
describe("militaryDivertedShare", () => {
  const plant = (revenue: number) => ({ strategyId: "munitions", revenue });

  it("is the share of the plant's own output the delivery represents", () => {
    const p = plant(10_000_000);
    const output = lotsFromSector(p);
    expect(militaryDivertedShare(p, output / 2)).toBeCloseTo(0.5, 6);
  });

  it("is 1 when the whole plant is delivering to the state", () => {
    const p = plant(10_000_000);
    expect(militaryDivertedShare(p, lotsFromSector(p))).toBe(1);
  });

  // A multi-domain plant splits output per component, so several contracts on one plant can
  // sum past its output. Clamping is what stops that becoming negative supply and revenue.
  it("never exceeds everything the plant makes", () => {
    const p = plant(10_000_000);
    expect(militaryDivertedShare(p, lotsFromSector(p) * 5)).toBe(1);
  });

  it("is 0 for a plant producing nothing, rather than dividing by zero", () => {
    expect(militaryDivertedShare(plant(0), 100)).toBe(0);
    expect(Number.isFinite(militaryDivertedShare(plant(0), 100))).toBe(true);
  });

  it("is 0 when nothing was delivered", () => {
    expect(militaryDivertedShare(plant(10_000_000), 0)).toBe(0);
  });
});

describe("freshMilitaryDiversion", () => {
  // Deliveries run AFTER commodity pricing in the turn order, so the stamp is always read a
  // turn later than it was written.
  it("still applies on the turn after it was stamped", () => {
    expect(
      freshMilitaryDiversion({ militaryDivertedFraction: 0.5, militaryDivertedTurn: 9 }, 10)
    ).toBe(0.5);
  });

  it("applies on the same turn", () => {
    expect(
      freshMilitaryDiversion({ militaryDivertedFraction: 0.5, militaryDivertedTurn: 10 }, 10)
    ).toBe(0.5);
  });

  // The expiry is what lets a completed or cancelled contract stop biting without any sweep
  // going to find and clear the sector.
  it("expires on its own once the stamp is older than one turn", () => {
    expect(
      freshMilitaryDiversion({ militaryDivertedFraction: 0.5, militaryDivertedTurn: 8 }, 10)
    ).toBe(0);
  });

  it("ignores an unstamped or absent diversion", () => {
    expect(freshMilitaryDiversion({}, 10)).toBe(0);
    expect(freshMilitaryDiversion({ militaryDivertedFraction: 0.5 }, 10)).toBe(0);
    expect(freshMilitaryDiversion({ militaryDivertedTurn: 10 }, 10)).toBe(0);
  });

  // A corrupt value must never invert the leg into free supply or free revenue.
  it("clamps a nonsense stored value into 0..1", () => {
    expect(
      freshMilitaryDiversion({ militaryDivertedFraction: 4, militaryDivertedTurn: 10 }, 10)
    ).toBe(1);
    expect(
      freshMilitaryDiversion({ militaryDivertedFraction: -2, militaryDivertedTurn: 10 }, 10)
    ).toBe(0);
    expect(
      freshMilitaryDiversion({ militaryDivertedFraction: NaN, militaryDivertedTurn: 10 }, 10)
    ).toBe(0);
  });
});
