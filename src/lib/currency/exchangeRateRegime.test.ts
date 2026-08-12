import { describe, it, expect } from "vitest";
import {
  describeTrinity,
  rateChangeRefusal,
  resolveTrinity,
  type FxRegime,
} from "./exchangeRateRegime";

const REGIMES: FxRegime[] = ["float", "band", "peg"];

describe("the impossible trinity", () => {
  it("never lets a configuration hold all three corners", () => {
    // The whole point. Exhaustive over the configuration space.
    for (const regime of REGIMES) {
      for (const capitalControls of [false, true]) {
        const t = resolveTrinity(regime, capitalControls);
        const held = [t.exchangeRateStability, t.capitalMobility, t.monetaryIndependence].filter(
          Boolean
        ).length;
        expect(held, `${regime}/${capitalControls}`).toBeLessThanOrEqual(2);
      }
    }
  });

  it("holds exactly two corners for every sensible configuration", () => {
    for (const regime of REGIMES) {
      for (const capitalControls of [false, true]) {
        const t = resolveTrinity(regime, capitalControls);
        if (t.wasteful) continue;
        const held = [t.exchangeRateStability, t.capitalMobility, t.monetaryIndependence].filter(
          Boolean
        ).length;
        expect(held, `${regime}/${capitalControls}`).toBe(2);
      }
    }
  });

  it("flags floating WITH capital controls as wasteful rather than as a trade", () => {
    // Closing the capital account under a float buys an independence the float
    // already provided. The player gave up two corners for one. That is a bad
    // choice, not an impossible one, and the model should say so instead of
    // reporting a trade that did not happen.
    const t = resolveTrinity("float", true);
    expect(t.wasteful).toBe(true);
    expect(t.givenUp).toEqual(["exchangeRateStability", "capitalMobility"]);
    expect(t.monetaryIndependence).toBe(true);
  });

  it("marks every sensible configuration as not wasteful", () => {
    expect(resolveTrinity("float", false).wasteful).toBe(false);
    expect(resolveTrinity("peg", false).wasteful).toBe(false);
    expect(resolveTrinity("peg", true).wasteful).toBe(false);
    expect(resolveTrinity("band", false).wasteful).toBe(false);
  });

  it("costs a pegged, open economy its policy rate", () => {
    const t = resolveTrinity("peg", false);
    expect(t.monetaryIndependence).toBe(false);
    expect(t.givenUp).toEqual(["monetaryIndependence"]);
  });

  it("gives the rate back when the capital account closes", () => {
    const t = resolveTrinity("peg", true);
    expect(t.monetaryIndependence).toBe(true);
    expect(t.givenUp).toEqual(["capitalMobility"]);
  });

  it("gives the rate back when the currency floats", () => {
    const t = resolveTrinity("float", false);
    expect(t.monetaryIndependence).toBe(true);
    expect(t.givenUp).toEqual(["exchangeRateStability"]);
  });

  it("treats a band as a commitment, not a free option", () => {
    // A chair who promised to defend a corridor promised to spend reserves on
    // it. Treating a band as a float would make the promise costless.
    expect(resolveTrinity("band", false).monetaryIndependence).toBe(false);
  });
});

describe("rateChangeRefusal", () => {
  it("permits a rate change wherever independence survives", () => {
    expect(rateChangeRefusal("float", false)).toBeNull();
    expect(rateChangeRefusal("float", true)).toBeNull();
    expect(rateChangeRefusal("peg", true)).toBeNull();
    expect(rateChangeRefusal("band", true)).toBeNull();
  });

  it("refuses a pegged, open economy and names both ways out", () => {
    const refusal = rateChangeRefusal("peg", false)!;
    expect(refusal).toMatch(/pegged/i);
    expect(refusal).toMatch(/float/i);
    expect(refusal).toMatch(/capital controls/i);
  });

  it("refuses a banded, open economy and names the band specifically", () => {
    const refusal = rateChangeRefusal("band", false)!;
    expect(refusal).toMatch(/band/i);
    expect(refusal).toMatch(/capital controls/i);
  });
});

describe("describeTrinity", () => {
  it("describes every configuration without falling through", () => {
    for (const regime of REGIMES) {
      for (const capitalControls of [false, true]) {
        const text = describeTrinity(resolveTrinity(regime, capitalControls));
        expect(text.length, `${regime}/${capitalControls}`).toBeGreaterThan(0);
      }
    }
  });

  it("names the corner that was actually surrendered", () => {
    expect(describeTrinity(resolveTrinity("peg", false))).toMatch(/policy rate is not yours/i);
    expect(describeTrinity(resolveTrinity("peg", true))).toMatch(/capital cannot move/i);
    expect(describeTrinity(resolveTrinity("float", false))).toMatch(/currency floats/i);
    expect(describeTrinity(resolveTrinity("float", true))).toMatch(/buy nothing/i);
  });
});
