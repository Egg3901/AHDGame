import { describe, expect, it } from "vitest";
import { prospectEraScaling, prospectDurationTurns, PROSPECT_DURATION_TURNS } from "./prospecting";

describe("prospecting era scaling", () => {
  it("is neutral with no era clock, so existing worlds are unchanged", () => {
    for (const y of [null, undefined, NaN]) {
      expect(prospectEraScaling(y as number | null)).toEqual({
        success: 1,
        yield: 1,
        duration: 1,
      });
    }
    expect(prospectDurationTurns(null)).toBe(PROSPECT_DURATION_TURNS);
  });

  it("is neutral at the present day — 2019 IS the authored constants", () => {
    expect(prospectEraScaling(2019)).toEqual({ success: 1, yield: 1, duration: 1 });
    expect(prospectDurationTurns(2019)).toBe(PROSPECT_DURATION_TURNS);
  });

  // The model is a trade, not a difficulty slider. If success and yield moved
  // the same way, early eras would simply be worse at prospecting and nobody
  // would do it — the point is that a 1953 strike is rarer AND bigger.
  it("trades success against payoff in earlier eras", () => {
    const y1953 = prospectEraScaling(1953);
    expect(y1953.success).toBeLessThan(1);
    expect(y1953.yield).toBeGreaterThan(1);
    expect(y1953.duration).toBeGreaterThan(1);
  });

  it("moves monotonically toward the present", () => {
    const years = [1953, 1979, 1991, 2019];
    const scalings = years.map(prospectEraScaling);
    for (let i = 1; i < scalings.length; i++) {
      expect(scalings[i].success, `success ${years[i]}`).toBeGreaterThanOrEqual(
        scalings[i - 1].success
      );
      expect(scalings[i].yield, `yield ${years[i]}`).toBeLessThanOrEqual(scalings[i - 1].yield);
      expect(scalings[i].duration, `duration ${years[i]}`).toBeLessThanOrEqual(
        scalings[i - 1].duration
      );
    }
  });

  it("interpolates between anchors rather than stepping", () => {
    const mid = prospectEraScaling(1966);
    expect(mid.success).toBeGreaterThan(prospectEraScaling(1953).success);
    expect(mid.success).toBeLessThan(prospectEraScaling(1979).success);
  });

  it("clamps outside the anchor range instead of extrapolating", () => {
    expect(prospectEraScaling(1900)).toEqual(prospectEraScaling(1953));
    expect(prospectEraScaling(2100)).toEqual(prospectEraScaling(2019));
  });

  it("never returns a duration below one turn", () => {
    for (let y = 1900; y <= 2100; y += 7) {
      expect(prospectDurationTurns(y), `${y}`).toBeGreaterThanOrEqual(1);
      expect(Number.isInteger(prospectDurationTurns(y)), `${y} is whole`).toBe(true);
    }
  });

  // Expected-value sanity: the trade should be roughly balanced, not a stealth
  // nerf or buff to early eras. Success × yield is the per-survey EV before
  // cost, and it must stay within a reasonable band of the modern value.
  it("keeps expected value per survey in the same ballpark across eras", () => {
    const ev = (year: number) => {
      const e = prospectEraScaling(year);
      return e.success * e.yield;
    };
    const modern = ev(2019);
    for (const year of [1953, 1979, 1991]) {
      const ratio = ev(year) / modern;
      expect(ratio, `${year} EV ratio`).toBeGreaterThan(0.75);
      expect(ratio, `${year} EV ratio`).toBeLessThan(1.25);
    }
  });
});
