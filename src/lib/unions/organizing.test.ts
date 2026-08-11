import { describe, expect, it } from "vitest";
import { organizingBand, organizingValue } from "./organizing";
import { LEADERSHIP_ELECTION_MIN_PRESSURE } from "./unionEconomy";

describe("organizingBand", () => {
  it("calls anything below the leadership threshold unorganized", () => {
    expect(organizingBand(0).label).toBe("Unorganized");
    expect(organizingBand(LEADERSHIP_ELECTION_MIN_PRESSURE - 0.1).label).toBe("Unorganized");
  });

  it("flips to Building exactly at the threshold that unlocks a leadership vote", () => {
    expect(organizingBand(LEADERSHIP_ELECTION_MIN_PRESSURE).label).toBe("Building");
  });

  it("tops out at Dominant", () => {
    expect(organizingBand(100).label).toBe("Dominant");
  });

  it("covers the whole range with no gaps", () => {
    for (let p = 0; p <= 100; p += 0.5) {
      expect(organizingBand(p).label).toBeTruthy();
    }
  });

  it("treats a non-finite score as zero rather than throwing", () => {
    expect(organizingBand(Number.NaN).label).toBe("Unorganized");
    expect(organizingValue(Number.NaN)).toBe("0.0 / 100");
  });
});

describe("organizingValue", () => {
  it("prints the score out of 100", () => {
    expect(organizingValue(16.5)).toBe("16.5 / 100");
  });
});
