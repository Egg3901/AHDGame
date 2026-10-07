import { describe, expect, it } from "vitest";
import { getHouseSeatMinShare, getMultiSeatMinShare } from "./seatEligibility";

describe("getHouseSeatMinShare", () => {
  it.each([
    [1, 0.2],
    [4, 0.2],
    [5, 1 / 6],
    [8, 1 / 9],
    [9, 0.1],
    [38, 0.1],
  ])("uses the delegation-aware gate for %i seats", (seats, expected) => {
    expect(getHouseSeatMinShare(seats)).toBeCloseTo(expected, 10);
  });

  it("preserves the legacy 20% gate when the seat count is unavailable or invalid", () => {
    expect(getHouseSeatMinShare()).toBe(0.2);
    expect(getHouseSeatMinShare(0)).toBe(0.2);
    expect(getHouseSeatMinShare(-1)).toBe(0.2);
    expect(getHouseSeatMinShare(5.5)).toBe(0.2);
    expect(getHouseSeatMinShare(Number.NaN)).toBe(0.2);
    expect(getHouseSeatMinShare(Number.POSITIVE_INFINITY)).toBe(0.2);
  });

  it("is bounded and non-increasing across plausible delegation sizes", () => {
    let previous = Number.POSITIVE_INFINITY;
    for (let seats = 1; seats <= 435; seats += 1) {
      const threshold = getHouseSeatMinShare(seats);
      expect(threshold).toBeGreaterThanOrEqual(0.1);
      expect(threshold).toBeLessThanOrEqual(0.2);
      expect(threshold).toBeLessThanOrEqual(previous);
      previous = threshold;
    }
  });
});

describe("getMultiSeatMinShare", () => {
  it("applies the delegation-aware rule only to the US House", () => {
    expect(getMultiSeatMinShare("house", 5, "US")).toBeCloseTo(1 / 6, 10);
    expect(getMultiSeatMinShare("house", 5, "NG")).toBe(0.2);
    expect(getMultiSeatMinShare("house", 5)).toBe(0.2);
    expect(getMultiSeatMinShare("commons", 5)).toBe(0.1);
    expect(getMultiSeatMinShare("shugiin", 34, "JP")).toBe(0.1);
    expect(getMultiSeatMinShare("snap_shugiin", 34, "JP")).toBe(0.1);
    expect(getMultiSeatMinShare("stateSenate", 5)).toBe(0.1);
    expect(getMultiSeatMinShare("governor", 5)).toBe(0.2);
  });
});
