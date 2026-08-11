/**
 * v0 macro-stability DESIGN-TIME DIAGNOSTIC (not a behavior regression test).
 *
 * This file exists to reason about a balance defect: it reimplements the
 * output-gap and migration-pull formulas with their constants as PARAMETERS (the
 * real functions bake them in as module constants), so we can sweep the proposed
 * fix values. It `console.table`s trajectories for inspection. It is NOT guarding
 * production behavior — when the real constants are tuned, the assertions about
 * "current" values will intentionally need updating.
 *
 * Fidelity is anchored by the parity tests below: they assert the parameterized
 * reimplementations equal the REAL imported `advanceOutputGap` /
 * `economicPullFactor` at default constants to 9 digits — which also verifies the
 * production signatures/shapes the rest of the file relies on.
 *
 * It deliberately isolates the output gap + the pull (where gdpGrowth ≡ potential
 * is forced and where the boom/doom bifurcation lives) rather than reproducing
 * the full demographic cohort loop. A live on-seed dump is the complementary
 * empirical confirmation.
 *
 * See docs/plans/2026-06-30-macro-balance-v0.md.
 */
import { describe, it, expect } from "vitest";
import { advanceOutputGap, GAP_CLOSURE, OUTPUT_GAP_BOUND } from "./outputGap";
import { economicPullFactor } from "@/lib/demographics/flows/internationalMigration";

const TPY = 48;
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

interface GapConstants {
  closure: number;
  bound: number;
}
// Pre-fix value (literal) — documents the saturation the v0 #2 fix removed.
const OLD_GAP: GapConstants = { closure: 0.5, bound: OUTPUT_GAP_BOUND[1] };
// Live value (raised to 1.5 by the v0 #2 fix) — what production uses today.
const LIVE_GAP: GapConstants = { closure: GAP_CLOSURE, bound: OUTPUT_GAP_BOUND[1] };

/** Parameterized reimplementation of advanceOutputGap. */
function simGap(prevGap: number, sectorSignal: number, potential: number, k: GapConstants) {
  const impulse = sectorSignal - potential;
  const rawGap = prevGap + (impulse - k.closure * prevGap) / TPY;
  const gap = clamp(rawGap, -k.bound, k.bound);
  const gdpGrowth = potential + (gap - prevGap) * TPY;
  return { gap, gdpGrowth, impulse };
}

interface PullConstants {
  kGdp: number;
  kUnemp: number;
}
const CURRENT_PULL: PullConstants = { kGdp: 0.06, kUnemp: 0.04 };

/** PRE-FIX absolute formula (growth vs a fixed 2.5% neutral) — documents the old doom-loop behavior. */
function simPull(gdpGrowth: number, unemployment: number, k: PullConstants) {
  const score = k.kGdp * (gdpGrowth - 2.5) - k.kUnemp * (unemployment - 5);
  return clamp(1 + score, 0.5, 1.5);
}

/**
 * Proposed v0 fix for the migration doom-loop: pull reads the OUTPUT GAP
 * (gdpGrowth − potential) instead of absolute growth vs a fixed 2.5% neutral. A
 * region growing at its own potential is then migration-neutral (interior
 * equilibrium); only genuinely hot/depressed regions attract/shed.
 */
function simPullOnGap(
  gdpGrowth: number,
  potential: number,
  unemployment: number,
  k: PullConstants
) {
  const score = k.kGdp * (gdpGrowth - potential) - k.kUnemp * (unemployment - 5);
  return clamp(1 + score, 0.5, 1.5);
}

/** Iterate the gap to steady state holding the signal + potential fixed. */
function gapSteadyState(sectorSignal: number, potential: number, k: GapConstants) {
  let gap = 0;
  let last = simGap(gap, sectorSignal, potential, k);
  for (let t = 0; t < TPY * 40; t++) {
    last = simGap(gap, sectorSignal, potential, k);
    gap = last.gap;
  }
  return last;
}

const round = (x: number, d = 2) => Math.round(x * 10 ** d) / 10 ** d;

// Representative region archetypes from the investigation (sectorSignal vs
// potential, %/yr). US is taken from the boom end of its regional range (+1.5
// to +4.3) so it sits ABOVE the 2.5% pull-neutral — i.e. genuinely in the boom
// basin; UK sits in the doom basin (potential < 0).
const ARCHETYPES = [
  { name: "UK", sectorSignal: 6, potential: -0.9 },
  { name: "US", sectorSignal: 12, potential: 4.0 },
  { name: "DE", sectorSignal: 5, potential: 2.0 },
  { name: "JP", sectorSignal: 9, potential: 1.4 },
];

describe("macro-stability diagnostic — parity with real code", () => {
  it("simGap matches advanceOutputGap at default constants", () => {
    const cases = [
      [0, 6, -0.9],
      [10, 12, 2],
      [-5, -8, 1.5],
      [14.9, 9, 1.4],
    ] as const;
    for (const [prev, sig, pot] of cases) {
      const mine = simGap(prev, sig, pot, LIVE_GAP);
      const real = advanceOutputGap(prev, sig, pot, TPY);
      expect(mine.gap).toBeCloseTo(real.gap, 9);
      expect(mine.gdpGrowth).toBeCloseTo(real.gdpGrowth, 9);
      expect(mine.impulse).toBeCloseTo(real.impulse, 9);
    }
  });

  it("simPullOnGap matches the (v0-fixed, output-gap-based) economicPullFactor", () => {
    for (const [g, pot, u] of [
      [6, 2.5, 5],
      [-0.9, -0.9, 8],
      [12, 4, 3],
      [2, 2, 5],
    ] as const) {
      expect(simPullOnGap(g, pot, u, CURRENT_PULL)).toBeCloseTo(
        economicPullFactor({ gdpGrowth: g, unemployment: u, potential: pot }),
        9
      );
    }
  });
});

describe("FINDING (pre-fix) — output gap saturated → gdpGrowth ≡ potential", () => {
  it("at the old closure (0.5), high-wedge regions pinned the gap; headline ≡ potential", () => {
    const rows = ARCHETYPES.map((a) => {
      const ss = gapSteadyState(a.sectorSignal, a.potential, OLD_GAP);
      return {
        region: a.name,
        sectorSignal: a.sectorSignal,
        potential: a.potential,
        impulse: round(ss.impulse),
        steadyGap: round(ss.gap),
        gdpGrowth: round(ss.gdpGrowth),
        pinned: ss.gap >= OUTPUT_GAP_BOUND[1] - 0.5,
      };
    });
    console.table(rows);

    for (const r of rows) {
      // Headline = potential at steady state — note this holds even for UNSATURATED
      // regions (it's the gap model's design), so it's not by itself the defect.
      expect(r.gdpGrowth).toBeCloseTo(r.potential, 6);
      // Saturation specifically hits high-wedge regions: steady gap = impulse/closure,
      // so it pinned exactly when impulse > bound × closure (= 7.5 at the old 0.5).
      const shouldPin = r.impulse > OUTPUT_GAP_BOUND[1] * OLD_GAP.closure;
      expect(r.pinned).toBe(shouldPin);
    }
    // The hot regions (US, JP) are pinned; low-wedge regions (DE) are not.
    expect(rows.some((r) => r.pinned)).toBe(true);
    expect(rows.some((r) => !r.pinned)).toBe(true);
  });
});

describe("FIX (v0 #2) — the live GAP_CLOSURE unsaturates the gap", () => {
  it("the live closure leaves no archetype pinned, where the old 0.5 did", () => {
    const rows = ARCHETYPES.map((a) => {
      const old = gapSteadyState(a.sectorSignal, a.potential, OLD_GAP);
      const live = gapSteadyState(a.sectorSignal, a.potential, LIVE_GAP);
      return {
        region: a.name,
        gapOld: round(old.gap),
        gapLive: round(live.gap),
        pinnedOld: old.gap >= OUTPUT_GAP_BOUND[1] - 0.5,
        pinnedLive: live.gap >= OUTPUT_GAP_BOUND[1] - 0.5,
      };
    });
    console.table(rows);
    expect(rows.every((r) => !r.pinnedLive)).toBe(true);
    expect(rows.some((r) => r.pinnedOld)).toBe(true);
  });
});

describe("MECHANISM — the doom-loop is the pull reading ABSOLUTE growth, not the gap", () => {
  // At steady state headline = potential, so a demographically-weak region settles
  // at a LOW gdpGrowth. The current pull compares that to a fixed 2.5% neutral, so
  // any such region sheds population — which lowers potential further. The gap
  // cushion is far too small to lift pull back over 1 (verified below), so raising
  // GAP_CLOSURE does NOT fix #3. Repointing pull to the output gap does.
  it("absolute pull splits regions into boom/doom basins at 2.5%; gap-pull collapses both to neutral", () => {
    const rows = ARCHETYPES.map((a) => {
      const gdpGrowth = a.potential; // steady state: headline = potential
      return {
        region: a.name,
        potential: a.potential,
        pullAbsolute: round(simPull(gdpGrowth, 5, CURRENT_PULL), 3),
        pullOnGap: round(simPullOnGap(gdpGrowth, a.potential, 5, CURRENT_PULL), 3),
      };
    });
    console.table(rows);

    const uk = rows.find((r) => r.region === "UK")!;
    const us = rows.find((r) => r.region === "US")!;
    // The bifurcation is exactly the 2.5% neutral: UK (potential < 2.5) gets a
    // repulsive multiplier (< 1, doom side); US (potential > 2.5) an attractive
    // one (> 1, boom side) — the two basins.
    expect(uk.pullAbsolute).toBeLessThan(1);
    expect(us.pullAbsolute).toBeGreaterThan(1);
    // Under output-gap pull, EVERY region settled at its own potential is neutral
    // (≈ 1) — both basins collapse to an interior equilibrium, no rails.
    for (const r of rows) expect(r.pullOnGap).toBeCloseTo(1, 2);
  });

  it("output-gap pull still rewards genuinely hot economies and penalizes depressed ones", () => {
    // Running ABOVE potential (positive output gap) → attracts.
    expect(simPullOnGap(4, 1, 5, CURRENT_PULL)).toBeGreaterThan(1);
    // Running BELOW potential (negative output gap) → sheds. This is the correct,
    // cyclical signal — emigrate when genuinely depressed, not merely low-trend.
    expect(simPullOnGap(-1, 1.5, 5, CURRENT_PULL)).toBeLessThan(1);
  });
});
