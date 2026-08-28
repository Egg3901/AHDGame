import { describe, it, expect } from "vitest";
import { sideAgg, sideMults, type SideAgg } from "@/lib/military/battle";
import { NO_SUPPORT } from "../frontSupport";
import type { FrontSupport } from "../types";

/**
 * The battle seam.
 *
 * These tests exist because there were NONE. `airShare` and `airm` decided a term in
 * every land battle in the game and nothing asserted on either, so the whole air
 * contribution could be changed, inverted, or deleted with a fully green suite. That is
 * how a silent balance regression ships.
 */

const stat = { fp: 50, ar: 50, sh: 50, mo: 50, mb: 50, rn: 50, aa: 50, rc: 50 };
const item = (cv: number, domain = "ground") => ({ cv, s: { ...stat }, domain });

const support = (over: Partial<FrontSupport>): FrontSupport => ({ ...NO_SUPPORT, ...over });

describe("sideAgg", () => {
  it("defaults to no support, so every existing caller is unaffected", () => {
    const agg = sideAgg([item(100)]);
    expect(agg.airSuperiority).toBe(0);
    expect(agg.casWeight).toBe(0);
    expect(agg.mass).toBe(100);
  });

  it("folds close air support into mass", () => {
    const agg = sideAgg([item(100)], support({ casWeight: 25 }));
    expect(agg.mass).toBe(125);
  });

  it("does not let close air support drag the front's average stats", () => {
    // CAS adds push, not armour. If it were divided into the per-stat averages, flying a
    // sortie would silently change the character of the ground force fighting.
    const withoutCas = sideAgg([item(100)]);
    const withCas = sideAgg([item(100)], support({ casWeight: 500 }));
    expect(withCas.ar).toBe(withoutCas.ar);
    expect(withCas.fp).toBe(withoutCas.fp);
    expect(withCas.aa).toBe(withoutCas.aa);
  });

  it("carries air superiority through from the naval and air layer", () => {
    const agg = sideAgg([item(100)], support({ airSuperiority: 73 }));
    expect(agg.airSuperiority).toBe(73);
  });

  it("no longer derives air strength from what the side happens to have brought", () => {
    // The old model counted a side's own air and naval mass as its air share, so bringing
    // aircraft read as winning the air war. Bringing them now proves nothing.
    const broughtAircraft = sideAgg([item(100, "air"), item(100, "ground")]);
    expect(broughtAircraft.airSuperiority).toBe(0);
  });
});

describe("sideMults air term", () => {
  const agg = (over: Partial<SideAgg>): SideAgg => ({
    mass: 100,
    fp: 50,
    ar: 50,
    sh: 50,
    mo: 50,
    mb: 50,
    rn: 50,
    aa: 50,
    rc: 50,
    airSuperiority: 0,
    casWeight: 0,
    ...over,
  });

  it("is neutral when both sides hold the sky equally", () => {
    const m = sideMults(agg({ airSuperiority: 50 }), agg({ airSuperiority: 50 }));
    expect(m.airm).toBe(1);
  });

  it("rewards the side that won the air war", () => {
    const m = sideMults(agg({ airSuperiority: 90 }), agg({ airSuperiority: 10 }));
    expect(m.airm).toBeGreaterThan(1);
  });

  it("punishes the side that lost it", () => {
    const m = sideMults(agg({ airSuperiority: 10 }), agg({ airSuperiority: 90 }));
    expect(m.airm).toBeLessThan(1);
  });

  it("is symmetric: what one side gains the other loses", () => {
    const won = sideMults(agg({ airSuperiority: 90 }), agg({ airSuperiority: 10 })).airm;
    const lost = sideMults(agg({ airSuperiority: 10 }), agg({ airSuperiority: 90 })).airm;
    expect(won - 1).toBeCloseTo(1 - lost, 10);
  });

  it("stays inside the magnitude the previous formula could reach", () => {
    // The coefficient and spread were deliberately left at 0.24 and 120 so the replay
    // isolates measuring air power properly from retuning it. Total air dominance must
    // not suddenly be worth more than the old model could ever produce.
    const maxSwing = sideMults(agg({ airSuperiority: 100 }), agg({ airSuperiority: 0 })).airm;
    expect(maxSwing).toBeLessThanOrEqual(1.12);
    expect(maxSwing).toBeGreaterThan(1);
  });

  it("clamps, so a runaway channel cannot produce an unbounded multiplier", () => {
    const absurd = sideMults(agg({ airSuperiority: 10_000 }), agg({ airSuperiority: 0 })).airm;
    expect(absurd).toBeLessThanOrEqual(1.12);
  });
});
