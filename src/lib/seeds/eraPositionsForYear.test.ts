import { describe, expect, it } from "vitest";
import { getEraPositions } from "./demographicCategories";
import { ERA_ANCHOR_YEARS, ERA_IDS_ASC } from "./eraInterpolation";
import { getEraPositionsForYear, resolveEraPositionsAtAnchor } from "./eraPositionsForYear";
import { ERA_CHECKPOINTS } from "@/lib/demographics/eraCheckpoints";
import { archetypeValuesToBuckets } from "@/lib/demographics/archetypeBucketMap";

/** A world that does not run era checkpoints, so anchors are used as authored. */
const NO_CHECKPOINTS = { startingYear: 2019 };

/**
 * Anchor identity is exact in intent but not in floating point: the blend still
 * runs its arithmetic at weight 1.0/0.0, so an authored -1.8 can come back as
 * -1.7999999999999998. Compare position tables numerically with a tolerance
 * rather than by deep structural equality, which made the assertion sensitive to
 * whether an authored constant happened to be representable in binary.
 */
function expectPositionsClose(
  got: ReturnType<typeof getEraPositions>,
  want: ReturnType<typeof getEraPositions>
) {
  expect(Object.keys(got).sort()).toEqual(Object.keys(want).sort());
  for (const dim of Object.keys(want) as Array<keyof typeof want>) {
    expect(Object.keys(got[dim]).sort()).toEqual(Object.keys(want[dim]).sort());
    for (const bucket of Object.keys(want[dim])) {
      expect(got[dim][bucket].economicLean).toBeCloseTo(want[dim][bucket].economicLean, 10);
      expect(got[dim][bucket].socialLean).toBeCloseTo(want[dim][bucket].socialLean, 10);
    }
  }
}
/** A 1953-seeded world — the only kind that runs checkpoints. */
const CHECKPOINTED = { startingYear: 1953 };

describe("getEraPositionsForYear — anchor identity", () => {
  it("reproduces the authored table at every anchor year, nationally", () => {
    for (const era of ERA_IDS_ASC) {
      expect(getEraPositionsForYear(ERA_ANCHOR_YEARS[era], undefined, NO_CHECKPOINTS)).toEqual(
        getEraPositions(era)
      );
    }
  });

  it("reproduces the authored table at every anchor year, per state", () => {
    for (const era of ERA_IDS_ASC) {
      for (const stateId of ["AL", "MA", "UT", "CA"]) {
        const got = getEraPositionsForYear(ERA_ANCHOR_YEARS[era], stateId, NO_CHECKPOINTS);
        // Anchors that author an override for this state must match exactly.
        // Later anchors carry it forward, which is asserted separately below.
        if (era === "1953" || era === "1979") {
          expectPositionsClose(got, getEraPositions(era, stateId));
        }
      }
    }
  });

  it("returns fresh objects, never the shared mutable base", () => {
    const a = getEraPositionsForYear(1953, "AL", NO_CHECKPOINTS);
    const b = getEraPositionsForYear(1953, "AL", NO_CHECKPOINTS);
    expect(a).not.toBe(b);
    expect(a.race).not.toBe(getEraPositions("1953").race);
  });
});

describe("regional character carries forward instead of decaying", () => {
  // The defect this guards: STATE_POSITION_OVERRIDES stops at 1979, so naive
  // interpolation flattens all 51 states onto the national number by 1991.
  const REGIONAL = [
    { stateId: "AL", expectEcon: 1.0 }, // Deep South, R of the nation
    { stateId: "UT", expectEcon: 1.5 }, // Mountain West, further R
    { stateId: "MA", expectEcon: -2.0 }, // Northeast, L of the nation
    { stateId: "DC", expectEcon: -3.5 }, // furthest L
  ];

  it("authors the 1979 gaps it claims to", () => {
    for (const { stateId, expectEcon } of REGIONAL) {
      const authoredGap =
        getEraPositions("1979", stateId).race.white.economicLean -
        getEraPositions("1979").race.white.economicLean;
      expect(authoredGap, stateId).toBeCloseTo(expectEcon, 10);
    }
  });

  it("carries the last authored anchor forward past the end of the table", () => {
    // 2019 is the last anchor with a state map, so 2023 must inherit its
    // regional character rather than collapse to the national number.
    for (const stateId of ["AL", "UT", "MA", "DC", "WV"]) {
      const gap2019 =
        getEraPositionsForYear(2019, stateId, NO_CHECKPOINTS).race.white.economicLean -
        getEraPositionsForYear(2019, undefined, NO_CHECKPOINTS).race.white.economicLean;
      const gap2023 =
        getEraPositionsForYear(2023, stateId, NO_CHECKPOINTS).race.white.economicLean -
        getEraPositionsForYear(2023, undefined, NO_CHECKPOINTS).race.white.economicLean;
      expect(gap2023, stateId).toBeCloseTo(gap2019, 10);
      expect(Math.abs(gap2023), stateId).toBeGreaterThan(0.2);
    }
  });

  it("does not flatten the electoral map — the spread stays wide at every anchor", () => {
    for (const year of [1953, 1979, 1991, 1999, 2007, 2019, 2023]) {
      const white = (s: string) =>
        getEraPositionsForYear(year, s, NO_CHECKPOINTS).race.white.economicLean;
      const values = ["AL", "UT", "MA", "DC", "CA", "WV", "NY"].map(white);
      const spread = Math.max(...values) - Math.min(...values);
      expect(spread, `year ${year}`).toBeGreaterThan(2);
      expect(white("MA"), `year ${year}`).toBeGreaterThan(white("DC"));
      // Alabama is to the LEFT of Massachusetts before the realignment — that
      // is the Solid South, not a bug — and to its right after.
      if (year >= 1979) {
        expect(white("AL"), `year ${year}`).toBeGreaterThan(white("MA"));
      } else {
        expect(white("AL"), `year ${year}`).toBeLessThan(white("MA"));
      }
    }
  });

  it("inverts Appalachia between 1992 and 2020 — the series' largest regional swing", () => {
    // West Virginia is authored economically LEFT of the national white
    // baseline in 1991 (Clinton +13 there) and far to its RIGHT by 2019. If a
    // future edit flattens this, the whole point of a living electorate is
    // gone, so it is asserted directly.
    const gap = (year: number) =>
      getEraPositionsForYear(year, "WV", NO_CHECKPOINTS).race.white.economicLean -
      getEraPositionsForYear(year, undefined, NO_CHECKPOINTS).race.white.economicLean;

    expect(gap(1991)).toBeLessThan(0);
    expect(gap(2019)).toBeGreaterThan(2);
    // and it passes through neutral somewhere in between, monotonically
    expect(gap(1999)).toBeGreaterThan(gap(1991));
    expect(gap(2007)).toBeGreaterThan(gap(1999));
    expect(gap(2019)).toBeGreaterThan(gap(2007));
  });

  it("never runs the Southern realignment backwards", () => {
    // Alabama's white voters must never drift back toward, let alone across,
    // the national base after realigning. They may still move WITH a national
    // trend — the invariant is the gap, not the absolute value (the national
    // race.white base itself falls 1.5 -> 1.0 across 1979->1991, and Alabama
    // moving with the country while staying right of it is correct).
    const authored1953 = getEraPositions("1953", "AL").race.white.economicLean;
    for (const year of [1979, 1985, 1991, 1999, 2007, 2019, 2023]) {
      const al = getEraPositionsForYear(year, "AL", NO_CHECKPOINTS).race.white.economicLean;
      const national = getEraPositionsForYear(year, undefined, NO_CHECKPOINTS).race.white
        .economicLean;
      expect(al).toBeGreaterThan(national);
      expect(al).toBeGreaterThan(authored1953);
    }
  });
});

describe("interpolation between anchors", () => {
  it("blends Alabama's realignment smoothly across 1953→1979", () => {
    const lo = getEraPositions("1953", "AL").race.white.economicLean;
    const hi = getEraPositions("1979", "AL").race.white.economicLean;
    // 2026-08 compressed 1953 calibration: AL whites -2.4 (was -3).
    expect(lo).toBe(-2.4);
    expect(hi).toBe(2.5);

    const mid = getEraPositionsForYear(1966, "AL", NO_CHECKPOINTS).race.white.economicLean;
    expect(mid).toBeCloseTo(lo + (hi - lo) * ((1966 - 1953) / (1979 - 1953)), 10);
    expect(mid).toBeGreaterThan(lo);
    expect(mid).toBeLessThan(hi);
  });

  it("clamps outside the anchor range rather than extrapolating", () => {
    expect(getEraPositionsForYear(1900, "AL", NO_CHECKPOINTS)).toEqual(
      getEraPositionsForYear(1953, "AL", NO_CHECKPOINTS)
    );
    expect(getEraPositionsForYear(2100, "AL", NO_CHECKPOINTS)).toEqual(
      getEraPositionsForYear(2023, "AL", NO_CHECKPOINTS)
    );
  });
});

describe("checkpoint de-duplication", () => {
  /** What the checkpoints deliver onto (dim:bucket, axis) for a state by `year`, computed independently. */
  function expectedBaked(stateId: string, axis: "economicLean" | "socialLean", year: number) {
    const out: Record<string, number> = {};
    for (const cp of ERA_CHECKPOINTS) {
      const win = cp.historicalWindow;
      if (!win) continue;
      const f =
        year <= win.startYear
          ? 0
          : year >= win.endYear
            ? 1
            : (year - win.startYear) / (win.endYear - win.startYear);
      if (f === 0) continue;
      const archetypes: Record<string, number> = {};
      for (const t of cp.targets) {
        if (t.axis !== axis || !t.stateIds.includes(stateId)) continue;
        if (t.dim && t.bucket) {
          out[`${t.dim}:${t.bucket}`] = (out[`${t.dim}:${t.bucket}`] ?? 0) + t.totalShift * f;
        } else if (t.groupId) {
          archetypes[t.groupId] = (archetypes[t.groupId] ?? 0) + t.totalShift * f;
        }
      }
      for (const [k, v] of Object.entries(archetypeValuesToBuckets(archetypes))) {
        out[k] = (out[k] ?? 0) + v;
      }
    }
    return out;
  }

  it("leaves the 1953 anchor untouched — nothing has happened yet", () => {
    expect(resolveEraPositionsAtAnchor("1953", "AL", CHECKPOINTED)).toEqual(
      getEraPositions("1953", "AL")
    );
  });

  it("subtracts the full delivered shift at 1979, so baseline + overlay == authored", () => {
    const baseline = resolveEraPositionsAtAnchor("1979", "AL", CHECKPOINTED);
    const authored = getEraPositions("1979", "AL");
    const baked = expectedBaked("AL", "economicLean", 1979);

    expect(baked["race:white"]).toBeGreaterThan(0);
    expect(baseline.race.white.economicLean + baked["race:white"]).toBeCloseTo(
      authored.race.white.economicLean,
      10
    );
  });

  it("keeps Alabama off the axis edge once the overlay is re-added", () => {
    // The bug this guards: +2.5 authored baseline + 3.5 overlay = +6.0 -> clamped
    // to +5, pinning the state at the extreme of the scale.
    const baseline = resolveEraPositionsAtAnchor("1979", "AL", CHECKPOINTED).race.white
      .economicLean;
    const withOverlay = baseline + expectedBaked("AL", "economicLean", 1979)["race:white"];
    expect(withOverlay).toBeLessThan(5);
    expect(withOverlay).toBeCloseTo(2.5, 10);
  });

  it("does not de-duplicate for worlds that never run checkpoints", () => {
    for (const era of ERA_IDS_ASC) {
      expect(resolveEraPositionsAtAnchor(era, "AL", { startingYear: 1979 })).toEqual(
        resolveEraPositionsAtAnchor(era, "AL", NO_CHECKPOINTS)
      );
    }
  });

  it("respects each target's geographic scope", () => {
    // Several checkpoints (Engel, Griswold, Miranda, the national Civil Rights
    // Act) are ALL_US_STATES, so every state gets SOME de-duplication — the
    // scoping that matters is that the Deep-South-only targets do not leak.
    // Alabama carries the regional Southern realignment on race:white on top
    // of the national ones; Vermont carries only the national ones.
    const gap = (s: string) =>
      resolveEraPositionsAtAnchor("1979", s, NO_CHECKPOINTS).race.white.economicLean -
      resolveEraPositionsAtAnchor("1979", s, CHECKPOINTED).race.white.economicLean;

    expect(gap("AL")).toBeGreaterThan(gap("VT") + 3);
    expect(gap("VT")).toBe(expectedBaked("VT", "economicLean", 1979)["race:white"] ?? 0);
  });
});
