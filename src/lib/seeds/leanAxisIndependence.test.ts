import { describe, expect, it } from "vitest";
import { demographicCategories, getEraPositions } from "@/lib/seeds/demographicCategories";

/**
 * The economic and social leans are meant to be two independent axes. They were
 * not: authored `race.white` social values were a ~0.6x scaled copy of the
 * economic value for every 1953 state, which produced r=0.972 on measured state
 * leans and left both cross-pressured quadrants empty. The practical effect was
 * that 1953 Mississippi came out as the most socially LEFT state in the country
 * and Vermont among the most socially right — backwards on the defining social
 * question of the era.
 *
 * These tests pin the property, not the numbers, so a recalibration is free to
 * move values as long as the axes stay independent and history stays the right
 * way round.
 */

function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  const ex = xs.reduce((a, b) => a + b, 0) / n;
  const ey = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - ex;
    const dy = ys[i] - ey;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  return sxy / Math.sqrt(sxx * syy);
}

/** `race.white` economic/social pairs for every state with a 1953 override. */
function whiteOverrides1953(): Array<{ state: string; econ: number; social: number }> {
  const states = [
    "MS",
    "SC",
    "AL",
    "GA",
    "LA",
    "AR",
    "VA",
    "NC",
    "TX",
    "FL",
    "TN",
    "OK",
    "KY",
    "MO",
    "MD",
    "WV",
    "DE",
    "MN",
    "NY",
    "MI",
    "WI",
    "MA",
    "RI",
    "CT",
    "IL",
    "NJ",
    "PA",
    "OH",
    "IN",
    "UT",
    "AZ",
    "ID",
    "WY",
    "NM",
    "MT",
    "NE",
    "NV",
    "ND",
    "SD",
    "KS",
    "CO",
    "IA",
    "VT",
    "WA",
    "ME",
    "OR",
    "NH",
    "CA",
  ];
  const out: Array<{ state: string; econ: number; social: number }> = [];
  for (const state of states) {
    const white = getEraPositions("1953", state).race?.white;
    if (white) out.push({ state, econ: white.economicLean, social: white.socialLean });
  }
  return out;
}

describe("1953 US social axis reflects the era's actual social cleavage", () => {
  it("makes the Deep South the most socially right region, not the most left", () => {
    const by = new Map(whiteOverrides1953().map((r) => [r.state, r.social]));
    const deepSouth = ["MS", "AL", "SC", "GA", "LA"];
    const north = ["MN", "NY", "MI", "MA", "WI"];

    for (const s of deepSouth) {
      expect(by.get(s)!).toBeGreaterThan(3);
    }
    for (const n of north) {
      expect(by.get(n)!).toBeLessThan(0);
    }
    // Mississippi 1953 should be the single most socially reactionary entry.
    const max = Math.max(...whiteOverrides1953().map((r) => r.social));
    expect(by.get("MS")).toBe(max);
  });

  it("keeps the Solid South socially reactionary on every state", () => {
    // The social axis is what this change owns, so it is asserted for all six.
    const rows = whiteOverrides1953();
    for (const s of ["MS", "AL", "SC", "GA", "LA", "AR"]) {
      expect(rows.find((r) => r.state === s)!.social).toBeGreaterThan(0);
    }
  });

  it("represents the New Deal coalition's cross-pressure in the Deep South", () => {
    // Economically Democratic AND socially reactionary at once. If this
    // collapses to one sign the coalition cannot be represented at all.
    //
    // NOT asserted for every Deep South state, and Mississippi is the reason.
    // Its white economic lean is +0.3 — economically Republican — while Alabama
    // sits at -2.4 and Georgia at -2.5. That is correct, not a solver artifact.
    //
    // Mississippi voted Democratic in 1952 because of Reconstruction legacy, the
    // one-party machine and registration, NOT because its white electorate was
    // economically left. That electorate was planters and Dixiecrats: they
    // opposed Truman's Fair Deal and passed a right-to-work law in 1954.
    // Economically conservative, racially reactionary, Democratic by
    // organization. The seed carries exactly that — MS registration is DEM 66 /
    // REP 6 with org 38 / 8, so partisanship comes from the org and
    // registration layer while the lean axes carry ideology.
    //
    // Reading a D+20.8 result as "therefore economically left" is the precise
    // conflation this whole file exists to prevent. Partisan performance is not
    // ideological position; that is why there are two axes and a separate
    // registration model.
    const rows = whiteOverrides1953();
    const crossPressured = ["AL", "SC", "GA", "LA", "AR"].filter((s) => {
      const row = rows.find((r) => r.state === s)!;
      return row.econ < 0 && row.social > 0;
    });
    expect(crossPressured.length).toBeGreaterThanOrEqual(5);
  });

  it("keeps Vermont economically Republican but not socially reactionary", () => {
    const vt = whiteOverrides1953().find((r) => r.state === "VT")!;
    expect(vt.econ).toBeGreaterThan(2);
    expect(vt.social).toBeLessThan(1);
    // and well to the left of the Deep South on the social axis
    const ms = whiteOverrides1953().find((r) => r.state === "MS")!;
    expect(vt.social).toBeLessThan(ms.social - 3);
  });

  it("does not let the social axis be a scaled copy of the economic axis", () => {
    const rows = whiteOverrides1953();
    const r = pearson(
      rows.map((x) => x.econ),
      rows.map((x) => x.social)
    );
    // Was +0.98. Any strong positive correlation means one axis wearing two labels.
    expect(r).toBeLessThan(0.5);

    const opposite = rows.filter((x) => x.econ * x.social < 0).length;
    expect(opposite).toBeGreaterThan(8);
  });
});

/**
 * Every era authors its own `race.white` regional map. Each one had social as a
 * scaled copy of economic (r = 0.98 in 1979, 0.97 in 1991, 0.9977 in 2019), so
 * the same invariants are asserted per era rather than for 1953 alone.
 *
 * The correlation bounds differ on purpose. American politics really did become
 * more one-dimensional over time, so 2019 is allowed to be far more aligned than
 * 1953. What is not allowed in any era is a literal scaled copy with no
 * cross-pressured states at all.
 */
const ERA_BOUNDS: Record<string, { maxCorr: number; minOpposite: number }> = {
  "1953": { maxCorr: 0.5, minOpposite: 8 },
  "1979": { maxCorr: 0.9, minOpposite: 2 },
  "1991": { maxCorr: 0.95, minOpposite: 2 },
  "2019": { maxCorr: 0.99, minOpposite: 5 },
};

function whiteOverridesFor(era: string) {
  const states = [
    "MS",
    "AL",
    "SC",
    "GA",
    "LA",
    "AR",
    "VA",
    "NC",
    "TX",
    "FL",
    "TN",
    "OK",
    "KY",
    "MO",
    "MD",
    "WV",
    "DE",
    "MN",
    "NY",
    "MI",
    "WI",
    "MA",
    "RI",
    "CT",
    "IL",
    "NJ",
    "PA",
    "OH",
    "IN",
    "UT",
    "AZ",
    "ID",
    "WY",
    "NM",
    "MT",
    "NE",
    "NV",
    "ND",
    "SD",
    "KS",
    "CO",
    "IA",
    "VT",
    "WA",
    "ME",
    "OR",
    "NH",
    "CA",
  ];
  const out: Array<{ state: string; econ: number; social: number }> = [];
  for (const state of states) {
    const white = getEraPositions(era as Parameters<typeof getEraPositions>[0], state).race?.white;
    if (white) out.push({ state, econ: white.economicLean, social: white.socialLean });
  }
  return out;
}

describe.each(Object.keys(ERA_BOUNDS))("era %s keeps two real axes", (era) => {
  const bounds = ERA_BOUNDS[era];

  it("does not author social as a scaled copy of economic", () => {
    const rows = whiteOverridesFor(era);
    const r = pearson(
      rows.map((x) => x.econ),
      rows.map((x) => x.social)
    );
    expect(r).toBeLessThan(bounds.maxCorr);
  });

  it("has states occupying a cross-pressured quadrant", () => {
    const rows = whiteOverridesFor(era);
    const opposite = rows.filter((x) => x.econ * x.social < 0).length;
    expect(opposite).toBeGreaterThanOrEqual(bounds.minOpposite);
  });

  it("keeps the Deep South socially right of the northern industrial states", () => {
    const by = new Map(whiteOverridesFor(era).map((r) => [r.state, r.social]));
    const south = ["MS", "AL", "SC"].map((s) => by.get(s)!);
    const north = ["MA", "NY", "MN"].map((s) => by.get(s)!);
    expect(Math.min(...south)).toBeGreaterThan(Math.max(...north));
  });
});

describe("demographic group defaults populate both cross-pressured quadrants", () => {
  const groups = demographicCategories
    .flatMap((c) => c.groups ?? [])
    .filter(
      (g): g is typeof g & { defaultEconomicLean: number; defaultSocialLean: number } =>
        typeof g.defaultEconomicLean === "number" && typeof g.defaultSocialLean === "number"
    );

  it("has at least one economically-right / socially-left group", () => {
    expect(groups.some((g) => g.defaultEconomicLean > 1 && g.defaultSocialLean < -1)).toBe(true);
  });

  it("has at least one economically-left / socially-right group", () => {
    expect(groups.some((g) => g.defaultEconomicLean < -1 && g.defaultSocialLean > 0)).toBe(true);
  });

  it("keeps the two default axes from collapsing onto one diagonal", () => {
    const r = pearson(
      groups.map((g) => g.defaultEconomicLean),
      groups.map((g) => g.defaultSocialLean)
    );
    // Was ~0.88 with both off-diagonal quadrants empty.
    expect(r).toBeLessThan(0.8);
  });
});
