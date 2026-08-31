import { describe, it, expect } from "vitest";
import { PRIME_RATE_STEP, snapToPrimeRateGrid } from "../centralBank";

describe("snapToPrimeRateGrid", () => {
  it("leaves an on-grid rate untouched", () => {
    for (const rate of [0, 0.25, 3, 4.75, 12.5, 25]) {
      expect(snapToPrimeRateGrid(rate)).toBe(rate);
    }
  });

  it("snaps the live off-grid US rate that locked out the chair", () => {
    // Ticket #1238: the autonomous chair had left the US bank on this exact
    // continuous Taylor-rule value, and every card submission was refused.
    expect(snapToPrimeRateGrid(4.653426586881501)).toBe(4.75);
  });

  it("rounds to the nearer grid point in both directions", () => {
    expect(snapToPrimeRateGrid(3.2520711440361882)).toBe(3.25);
    expect(snapToPrimeRateGrid(8.64732522882295)).toBe(8.75);
    expect(snapToPrimeRateGrid(11.874733795598033)).toBe(11.75);
  });

  it("produces a value the rate API accepts, before and after a step", () => {
    // The API validates multipleOf(PRIME_RATE_STEP), so a snapped base stepped
    // by the same amount has to stay exactly on the grid.
    const isOnGrid = (r: number) =>
      Math.abs(r / PRIME_RATE_STEP - Math.round(r / PRIME_RATE_STEP)) < 1e-9;
    for (const raw of [4.653426586881501, 2.1369085378852524, 6.9553979682157765, 0.01, 24.99]) {
      const base = snapToPrimeRateGrid(raw);
      expect(isOnGrid(base)).toBe(true);
      expect(isOnGrid(base + PRIME_RATE_STEP)).toBe(true);
      expect(isOnGrid(base - PRIME_RATE_STEP)).toBe(true);
    }
  });

  it("passes non-finite values through rather than producing NaN arithmetic", () => {
    expect(snapToPrimeRateGrid(Number.NaN)).toBeNaN();
    expect(snapToPrimeRateGrid(Number.POSITIVE_INFINITY)).toBe(Number.POSITIVE_INFINITY);
  });
});
