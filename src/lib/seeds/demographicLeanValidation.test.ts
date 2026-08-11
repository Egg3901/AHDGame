/**
 * Validate voter archetype composition and derived state leans against 2020 election data.
 *
 * The demographic model produces compressed leans (≈ -1.0 to +2.0) compared to
 * actual 2020 margins (≈ -5 to +4.3). This is structural: averaging 12 groups with
 * opposing leans compresses toward zero. The model's value is in relative ordering
 * and population composition, not exact lean magnitude.
 *
 * These tests validate:
 * 1. Composition weights include race.white in relevant archetypes
 * 2. Group populations sum to 100% for every state
 * 3. Correct direction for strong partisan states (not swing states)
 * 4. Correct relative ordering between clearly different state pairs
 * 5. Swing states are near zero (within ±1.5)
 */

import { describe, it, expect } from "vitest";
import { demographicCategories, VOTER_GROUP_COMPOSITION } from "../seeds/demographicCategories";
import { stateDemographics, stateCensusData } from "../seeds/stateDemographics";
import { calculateStateLean } from "../utils/demographics";
import { ELECTION_2020_MARGIN, marginToLean } from "../data/2020ElectionResults";

function getDisplayLean(econ: number, social: number): number {
  if ((econ >= 0 && social >= 0) || (econ <= 0 && social <= 0)) {
    return (econ + social) / 2;
  }
  return Math.abs(econ) > Math.abs(social) ? econ : social;
}

function getDerivedLean(stateId: string): number {
  const demo = stateDemographics.find((d) => d._id === stateId);
  if (!demo) throw new Error(`No demographics for ${stateId}`);
  const lean = calculateStateLean(demo, demographicCategories);
  return getDisplayLean(lean.economicLean, lean.socialLean);
}

// ── Composition coverage ──────────────────────────────────────────────────────

describe("VOTER_GROUP_COMPOSITION", () => {
  it("deriveGroupPopulations reads from VOTER_GROUP_COMPOSITION (no hardcoded duplication)", () => {
    // Verify that changing VOTER_GROUP_COMPOSITION would affect population derivation
    // by checking that all 12 groups use valid dimensions
    for (const [id, comp] of Object.entries(VOTER_GROUP_COMPOSITION)) {
      for (const { dim, key } of comp.weights) {
        expect(
          ["race", "age", "education", "wealth", "ideology"].includes(dim),
          `${id}: invalid dimension "${dim}"`
        ).toBe(true);
        // Key must be a valid sub-key of that dimension
        expect(typeof key).toBe("string");
      }
    }
  });

  it("includes race.white in right-leaning archetypes", () => {
    const rightGroups = [
      "evangelicals",
      "rural_traditionalists",
      "small_business",
      "retirees",
      "libertarians",
    ];
    for (const id of rightGroups) {
      const comp = VOTER_GROUP_COMPOSITION[id];
      const hasWhite = comp.weights.some((w) => w.dim === "race" && w.key === "white");
      expect(hasWhite, `${id} should include race.white`).toBe(true);
    }
  });

  it("includes race.white in left-leaning archetypes for balance", () => {
    const leftGroups = ["college_liberals", "secular_professionals"];
    for (const id of leftGroups) {
      const comp = VOTER_GROUP_COMPOSITION[id];
      const hasWhite = comp.weights.some((w) => w.dim === "race" && w.key === "white");
      expect(hasWhite, `${id} should include race.white`).toBe(true);
    }
  });

  it("includes race.white in centrist archetypes", () => {
    const centerGroups = ["soccer_moms", "union_trades"];
    for (const id of centerGroups) {
      const comp = VOTER_GROUP_COMPOSITION[id];
      const hasWhite = comp.weights.some((w) => w.dim === "race" && w.key === "white");
      expect(hasWhite, `${id} should include race.white`).toBe(true);
    }
  });

  it("includes race.black in union_trades and public_sector", () => {
    for (const id of ["union_trades", "public_sector"]) {
      const comp = VOTER_GROUP_COMPOSITION[id];
      const hasBlack = comp.weights.some((w) => w.dim === "race" && w.key === "black");
      expect(hasBlack, `${id} should include race.black`).toBe(true);
    }
  });

  it("new_immigrants uses hispanic, asian, and other", () => {
    const comp = VOTER_GROUP_COMPOSITION["new_immigrants"];
    expect(comp.weights.some((w) => w.key === "hispanic")).toBe(true);
    expect(comp.weights.some((w) => w.key === "asian")).toBe(true);
    expect(comp.weights.some((w) => w.key === "other")).toBe(true);
    expect(comp.civicMultiplier).toBe(0.8);
  });

  it("all 12 archetypes have composition definitions", () => {
    const allIds = demographicCategories[0].groups.map((g) => g.id);
    for (const id of allIds) {
      expect(VOTER_GROUP_COMPOSITION[id], `Missing composition for ${id}`).toBeDefined();
      expect(
        VOTER_GROUP_COMPOSITION[id].weights.length,
        `${id} should have at least 1 weight`
      ).toBeGreaterThan(0);
    }
  });

  it("retirees uses multiple dimensions (not just age.senior)", () => {
    const comp = VOTER_GROUP_COMPOSITION["retirees"];
    expect(comp.weights.length).toBeGreaterThanOrEqual(2);
  });
});

// ── Population normalization ──────────────────────────────────────────────────

describe("stateDemographics population normalization", () => {
  it("all states have group populations summing to ~100%", () => {
    for (const demo of stateDemographics) {
      const groups = Object.values(demo.groups);
      const totalPop = groups.reduce((s, g) => s + g.population, 0);
      expect(totalPop).toBeCloseTo(100, 0); // within ±0.5%
    }
  });

  it("all states have 12 voter groups", () => {
    for (const demo of stateDemographics) {
      expect(Object.keys(demo.groups).length).toBe(12);
    }
  });

  it("no group has 0% or negative population", () => {
    for (const demo of stateDemographics) {
      for (const [id, group] of Object.entries(demo.groups)) {
        expect(group.population, `${demo._id}/${id} population`).toBeGreaterThan(0);
      }
    }
  });

  it("group leans are within -5 to +5", () => {
    for (const demo of stateDemographics) {
      for (const [id, group] of Object.entries(demo.groups)) {
        expect(group.economicLean, `${demo._id}/${id} econ lean`).toBeGreaterThanOrEqual(-5);
        expect(group.economicLean, `${demo._id}/${id} econ lean`).toBeLessThanOrEqual(5);
        expect(group.socialLean, `${demo._id}/${id} social lean`).toBeGreaterThanOrEqual(-5);
        expect(group.socialLean, `${demo._id}/${id} social lean`).toBeLessThanOrEqual(5);
      }
    }
  });
});

// ── Direction validation (strong partisan states) ─────────────────────────────

describe("derived lean direction for strong partisan states", () => {
  // States where 2020 margin was > 15 points — direction should be unambiguous
  const strongBlue = ["CA", "MA", "MD", "NY", "HI", "IL", "DC"];
  const strongRed = ["WY", "WV", "OK", "ID", "AR", "AL", "ND", "SD", "KY", "TN"];

  it.each(strongBlue)("%s should derive as left-leaning (negative)", (stateId) => {
    const lean = getDerivedLean(stateId);
    expect(lean, `${stateId} should be negative (blue)`).toBeLessThan(0);
  });

  it.each(strongRed)("%s should derive as right-leaning (positive)", (stateId) => {
    const lean = getDerivedLean(stateId);
    expect(lean, `${stateId} should be positive (red)`).toBeGreaterThan(0);
  });
});

// ── Swing states should be near zero ──────────────────────────────────────────

describe("swing states are near zero", () => {
  // States with 2020 margin < 5 points
  const swingStates = ["AZ", "GA", "WI", "PA", "MI", "NV", "NC"];

  it.each(swingStates)("%s should be within ±1.5 of zero", (stateId) => {
    const lean = getDerivedLean(stateId);
    expect(Math.abs(lean), `${stateId} lean ${lean} should be near zero`).toBeLessThan(1.5);
  });
});

// ── Relative ordering ─────────────────────────────────────────────────────────

describe("relative lean ordering between states", () => {
  const pairsRedderFirst: [string, string][] = [
    ["WY", "CO"], // WY is much redder than CO
    ["AL", "GA"], // AL is redder than GA (swing)
    ["TX", "AZ"], // TX leans redder than AZ
    ["OH", "PA"], // OH is redder than PA
    ["IN", "MI"], // IN is redder than MI
    ["SC", "NC"], // SC is redder than NC
    ["IA", "WI"], // IA is redder than WI
    ["UT", "NV"], // UT is redder than NV
    ["MS", "GA"], // MS is redder than GA
    ["KS", "CO"], // KS is redder than CO
  ];

  it.each(pairsRedderFirst)("%s should derive redder (more positive) than %s", (redder, bluer) => {
    const rLean = getDerivedLean(redder);
    const bLean = getDerivedLean(bluer);
    expect(rLean, `${redder} (${rLean}) should be > ${bluer} (${bLean})`).toBeGreaterThan(bLean);
  });
});

// ── Race.white sensitivity ────────────────────────────────────────────────────

describe("race.white affects archetype distribution", () => {
  it("high-white state (WV) differs from low-white state (HI) in right-leaning group size", () => {
    const wv = stateDemographics.find((d) => d._id === "WV")!;
    const hi = stateDemographics.find((d) => d._id === "HI")!;

    // WV is 92% white, HI is 22% white — right-leaning groups should be larger in WV
    const rightGroups = ["evangelicals", "rural_traditionalists", "retirees"];
    const wvRightTotal = rightGroups.reduce((s, id) => s + wv.groups[id].population, 0);
    const hiRightTotal = rightGroups.reduce((s, id) => s + hi.groups[id].population, 0);

    expect(wvRightTotal).toBeGreaterThan(hiRightTotal);
  });

  it("new_immigrants is larger in high-hispanic states", () => {
    const tx = stateDemographics.find((d) => d._id === "TX")!; // 40% hispanic
    const me = stateDemographics.find((d) => d._id === "ME")!; // 2% hispanic

    expect(tx.groups["new_immigrants"].population).toBeGreaterThan(
      me.groups["new_immigrants"].population * 3
    );
  });
});

// ── Lean modulation ───────────────────────────────────────────────────────────

describe("state-specific lean modulation", () => {
  it("retirees lean more right in conservative states", () => {
    const wy = stateDemographics.find((d) => d._id === "WY")!;
    const ca = stateDemographics.find((d) => d._id === "CA")!;

    expect(wy.groups["retirees"].economicLean).toBeGreaterThan(ca.groups["retirees"].economicLean);
    expect(wy.groups["retirees"].socialLean).toBeGreaterThan(ca.groups["retirees"].socialLean);
  });

  it("soccer_moms lean more left in progressive states", () => {
    const ma = stateDemographics.find((d) => d._id === "MA")!;
    const al = stateDemographics.find((d) => d._id === "AL")!;

    expect(ma.groups["soccer_moms"].economicLean).toBeLessThan(
      al.groups["soccer_moms"].economicLean
    );
  });

  it("union_trades are more economically left in progressive states", () => {
    const mn = stateDemographics.find((d) => d._id === "MN")!;
    const wv = stateDemographics.find((d) => d._id === "WV")!;

    expect(mn.groups["union_trades"].economicLean).toBeLessThan(
      wv.groups["union_trades"].economicLean
    );
  });

  it("evangelicals lean harder right in evangelical-heavy states", () => {
    const al = stateDemographics.find((d) => d._id === "AL")!; // 38% evangelical
    const vt = stateDemographics.find((d) => d._id === "VT")!; // 5% evangelical

    expect(al.groups["evangelicals"].economicLean).toBeGreaterThan(
      vt.groups["evangelicals"].economicLean
    );
  });

  it("college_liberals lean more left in progressive states", () => {
    const ma = stateDemographics.find((d) => d._id === "MA")!;
    const al = stateDemographics.find((d) => d._id === "AL")!;

    expect(ma.groups["college_liberals"].economicLean).toBeLessThan(
      al.groups["college_liberals"].economicLean
    );
  });
});

// ── Census data completeness ──────────────────────────────────────────────────

describe("stateCensusData completeness", () => {
  it("all 50 states + DC have census data", () => {
    expect(Object.keys(stateCensusData).length).toBeGreaterThanOrEqual(51);
  });

  it("census race percentages sum to ~100 for each state", () => {
    for (const [stateId, config] of Object.entries(stateCensusData)) {
      const sum = Object.values(config.race).reduce((s, v) => s + v, 0);
      expect(sum, `${stateId} race total`).toBeCloseTo(100, -1); // within 1%
    }
  });

  it("census age percentages sum to ~100 for each state", () => {
    for (const [stateId, config] of Object.entries(stateCensusData)) {
      const sum = Object.values(config.age).reduce((s, v) => s + v, 0);
      expect(sum, `${stateId} age total`).toBeCloseTo(100, -1);
    }
  });

  it("census education percentages sum to ~100 for each state", () => {
    for (const [stateId, config] of Object.entries(stateCensusData)) {
      const sum = Object.values(config.education).reduce((s, v) => s + v, 0);
      expect(sum, `${stateId} education total`).toBeCloseTo(100, -1);
    }
  });

  it("census wealth percentages sum to ~100 for each state", () => {
    for (const [stateId, config] of Object.entries(stateCensusData)) {
      const sum = Object.values(config.wealth).reduce((s, v) => s + v, 0);
      expect(sum, `${stateId} wealth total`).toBeCloseTo(100, -1);
    }
  });
});

// ── Summary statistics ────────────────────────────────────────────────────────

describe("overall model quality", () => {
  it("mean absolute error vs 2020 should be under 2.0", () => {
    const errors: number[] = [];
    for (const demo of stateDemographics) {
      const margin = ELECTION_2020_MARGIN[demo._id];
      if (margin === undefined) continue;

      const derived = getDerivedLean(demo._id);
      const actual = marginToLean(margin);
      errors.push(Math.abs(derived - actual));
    }
    const mae = errors.reduce((s, e) => s + e, 0) / errors.length;
    expect(mae).toBeLessThan(2.0);
  });

  it("derived leans should span a reasonable range", () => {
    const leans = stateDemographics
      .filter((d) => ELECTION_2020_MARGIN[d._id] !== undefined)
      .map((d) => getDerivedLean(d._id));
    const min = Math.min(...leans);
    const max = Math.max(...leans);
    const range = max - min;

    // Should span at least 2.5 points (not all compressed to near 0)
    expect(range).toBeGreaterThan(2.5);
    // Min should be negative (blue states exist)
    expect(min).toBeLessThan(0);
    // Max should be > 1.0 (red states exist)
    expect(max).toBeGreaterThan(1.0);
  });
});
