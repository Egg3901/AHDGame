/**
 * Seed exchange rates must be in the world's own money.
 *
 * `getInitialRates` had tables for 1953/1979/1991 and fell through to the 2019
 * table for everything else — so a 1999 or 2007 world started with 2019 rates.
 * Nigeria seeded at 1550 naira/USD against a real 1999 rate near 97: a 16x
 * error on day one, feeding every trade, budget and corporate valuation.
 */
import { describe, expect, it } from "vitest";
import {
  INITIAL_RATES,
  INITIAL_RATES_1953,
  INITIAL_RATES_1979,
  INITIAL_RATES_1991,
  getInitialRates,
  getInitialRatesForYear,
} from "./currencies";

describe("forex year anchors", () => {
  it("returns the authored table unchanged at every anchor year", () => {
    // Anchor identity: existing worlds must be byte-identical.
    expect(getInitialRatesForYear(1953)).toBe(INITIAL_RATES_1953);
    expect(getInitialRatesForYear(1979)).toBe(INITIAL_RATES_1979);
    expect(getInitialRatesForYear(1991)).toBe(INITIAL_RATES_1991);
    expect(getInitialRatesForYear(2019)).toBe(INITIAL_RATES);
  });

  it("keeps the authored presets byte-identical", () => {
    expect(getInitialRates("1953-default")).toBe(INITIAL_RATES_1953);
    expect(getInitialRates("1979-default")).toBe(INITIAL_RATES_1979);
    expect(getInitialRates("1991-default")).toBe(INITIAL_RATES_1991);
    expect(getInitialRates("2019-default")).toBe(INITIAL_RATES);
    // Unknown and alias presets still resolve to the modern table.
    expect(getInitialRates("empty")).toBe(INITIAL_RATES);
    expect(getInitialRates("2019-no-parties")).toBe(INITIAL_RATES);
  });

  it("stops seeding a 1999 world with 2019 money", () => {
    const rates1999 = getInitialRates("1999-default");
    const ng = rates1999.NG;
    expect(ng).toBeDefined();
    // The bug: 1550 (a 2019 rate) for a 1999 world.
    expect(ng).toBeLessThan(INITIAL_RATES.NG!);
    // And it must land between the bracketing anchors, not outside them.
    expect(ng!).toBeGreaterThan(INITIAL_RATES_1991.NG!);
  });

  it("interpolates geometrically, not linearly", () => {
    // Exchange rates compound. Nigeria 9.9 (1991) to 1550 (2019): the straight
    // line at 1999 is ~450, the geometric mean ~42. The real rate was ~97, so
    // the geometric form is the right shape and the linear one is an order of
    // magnitude out in the wrong direction.
    const ng1999 = getInitialRatesForYear(1999).NG!;
    const lo = INITIAL_RATES_1991.NG!;
    const hi = INITIAL_RATES.NG!;
    const t = (1999 - 1991) / (2019 - 1991);
    const linear = lo + (hi - lo) * t;
    const geometric = Math.exp(Math.log(lo) + (Math.log(hi) - Math.log(lo)) * t);
    expect(ng1999).toBeCloseTo(geometric, 6);
    expect(ng1999).toBeLessThan(linear / 5);
  });

  it("is monotone between two anchors for a depreciating currency", () => {
    let prev = 0;
    for (const year of [1991, 1995, 1999, 2003, 2007, 2011, 2015, 2019]) {
      const ng = getInitialRatesForYear(year).NG!;
      expect(ng).toBeGreaterThanOrEqual(prev);
      prev = ng;
    }
  });

  it("clamps outside the anchor range instead of extrapolating", () => {
    expect(getInitialRatesForYear(1900)).toBe(INITIAL_RATES_1953);
    expect(getInitialRatesForYear(2023)).toBe(INITIAL_RATES);
    expect(getInitialRatesForYear(2200)).toBe(INITIAL_RATES);
    // 2023 therefore stays exactly as it was before this change.
    expect(getInitialRates("2023-default")).toBe(INITIAL_RATES);
  });

  it("never drops a country that only one anchor authors", () => {
    // A missing entry means "not authored for that year", not "no currency".
    const mid = getInitialRatesForYear(1999);
    const union = new Set([...Object.keys(INITIAL_RATES_1991), ...Object.keys(INITIAL_RATES)]);
    for (const id of union) {
      expect(mid[id as keyof typeof mid], `${id} dropped`).toBeDefined();
    }
  });

  it("produces only positive, finite rates", () => {
    for (const year of [1953, 1966, 1979, 1985, 1991, 1999, 2007, 2019]) {
      for (const [id, rate] of Object.entries(getInitialRatesForYear(year))) {
        expect(Number.isFinite(rate), `${id} @ ${year}`).toBe(true);
        expect(rate, `${id} @ ${year}`).toBeGreaterThan(0);
      }
    }
  });

  it("rejects a non-finite year rather than producing NaN rates", () => {
    expect(getInitialRatesForYear(NaN)).toBe(INITIAL_RATES);
  });
});
