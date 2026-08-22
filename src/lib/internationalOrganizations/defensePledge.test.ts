import { describe, expect, it } from "vitest";
import { defenseSharePct, defenseSharePctFromMacroSectors } from "./defensePledge";

describe("defenseSharePct", () => {
  it("returns defense outlay as a percent of GDP", () => {
    expect(defenseSharePct(20, 1000)).toBeCloseTo(2);
  });

  it("omits an entity that has no outlay or no GDP rather than calling it zero", () => {
    expect(defenseSharePct(0, 1000)).toBeUndefined();
    expect(defenseSharePct(20, 0)).toBeUndefined();
  });
});

describe("defenseSharePctFromMacroSectors", () => {
  it("uses the defense sector's share of aggregate capacity", () => {
    expect(
      defenseSharePctFromMacroSectors({
        agriculture: { capacity: 75 },
        defense: { capacity: 25 },
      })
    ).toBeCloseTo(25);
  });

  it("omits a macro with no defense sector rather than calling it zero", () => {
    expect(
      defenseSharePctFromMacroSectors({ agriculture: { capacity: 75 }, retail: { capacity: 50 } })
    ).toBeUndefined();
  });

  it("omits missing or empty sector maps", () => {
    expect(defenseSharePctFromMacroSectors(undefined)).toBeUndefined();
    expect(defenseSharePctFromMacroSectors({})).toBeUndefined();
  });
});
