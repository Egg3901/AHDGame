import { describe, it, expect } from "vitest";
import { deriveTicker, computeDayChange } from "./corpIdentity";

describe("deriveTicker", () => {
  it("prefers an explicit tickerSymbol", () => {
    expect(deriveTicker({ tickerSymbol: "MRDN", name: "Meridian Logistics Group" })).toBe("MRDN");
  });
  it("derives initials from multi-word names when no ticker", () => {
    expect(deriveTicker({ name: "Meridian Logistics Group" })).toBe("MLG");
  });
  it("derives from a single-word name by taking up to 4 leading letters, uppercased", () => {
    expect(deriveTicker({ name: "Aperture" })).toBe("APER");
  });
  it("strips non-letters and caps at 5 chars", () => {
    expect(deriveTicker({ name: "7-Eleven Holdings & Co" })).toBe("EHC");
  });
  it("falls back to 'CORP' for empty/letterless names", () => {
    expect(deriveTicker({ name: "1234" })).toBe("CORP");
  });
});

describe("computeDayChange", () => {
  it("returns null when fewer than 2 points", () => {
    expect(computeDayChange([])).toBeNull();
    expect(computeDayChange([{ sharePrice: 10 }])).toBeNull();
  });
  it("computes pct change and prev close from the last two points", () => {
    const r = computeDayChange([{ sharePrice: 47.18 }, { sharePrice: 48.32 }]);
    expect(r).not.toBeNull();
    expect(r!.prevClose).toBe(47.18);
    expect(r!.changePct).toBeCloseTo(2.42, 1);
  });
  it("returns 0 change when prev close is 0", () => {
    const r = computeDayChange([{ sharePrice: 0 }, { sharePrice: 5 }]);
    expect(r!.changePct).toBe(0);
  });
});
