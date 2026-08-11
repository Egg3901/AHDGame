import { describe, it, expect } from "vitest";
import { didPass, otherChamber } from "./billLifecycleHelpers";

describe("didPass", () => {
  it("returns true when votesFor > votesAgainst", () => {
    expect(didPass(10, 5)).toBe(true);
    expect(didPass(1, 0)).toBe(true);
  });

  it("returns false when votesFor <= votesAgainst", () => {
    expect(didPass(5, 10)).toBe(false);
    expect(didPass(5, 5)).toBe(false);
    expect(didPass(0, 0)).toBe(false);
  });
});

describe("otherChamber", () => {
  it("returns senate for house", () => {
    expect(otherChamber("house")).toBe("senate");
  });

  it("returns house for senate", () => {
    expect(otherChamber("senate")).toBe("house");
  });
});
