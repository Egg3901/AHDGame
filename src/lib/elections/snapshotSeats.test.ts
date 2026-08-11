import { describe, expect, it } from "vitest";
import { seatEstimateForVoteTotals } from "./snapshotSeats";

describe("seatEstimateForVoteTotals", () => {
  it("returns undefined for single-seat races", () => {
    expect(seatEstimateForVoteTotals("house", "CA", 1, { a: 100, b: 50 })).toBeUndefined();
  });

  it("returns undefined for non-multi-seat election types", () => {
    expect(seatEstimateForVoteTotals("senate", "CA", 2, { a: 100, b: 50 })).toBeUndefined();
  });

  it("infers seats for a multi-seat house race from vote totals", () => {
    const seats = seatEstimateForVoteTotals("house", "CA-01", 4, {
      candA: 4000,
      candB: 3000,
      candC: 2000,
      candD: 1000,
    });
    expect(seats).toBeDefined();
    const total = Object.values(seats!).reduce((s, n) => s + n, 0);
    expect(total).toBe(4);
  });
});
