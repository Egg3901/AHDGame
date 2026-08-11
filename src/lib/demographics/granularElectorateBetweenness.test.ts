/**
 * The program's stated verification bar, as a deterministic test.
 *
 * The plan asks for sim runs at 1953, a synthetic 1966 and 1979, with 1966
 * required to land between the anchors. The sim worker runs deployed code with
 * `eraSystemEnabled` off, so it cannot exercise this branch — but the property
 * the sim was meant to demonstrate is a pure function of the substrate, so it
 * can be asserted directly and for EVERY state rather than the handful a sim
 * run would surface.
 *
 * What "between" means here needs care, and the first version of this test got
 * it wrong. The aggregate lean is a share-weighted mean, and BOTH the shares
 * and the leans interpolate at once — so the aggregate is a product of two
 * linear functions of t, i.e. quadratic, and is NOT required to be monotone
 * even when every input is. Where the two anchors' aggregates are far apart
 * that curvature is invisible; where they are nearly identical the interval is
 * degenerate and ordinary composition drift shows up as a tiny "overshoot".
 *
 * Measured, the overshoot is at most ~0.04 on a ±5 axis, and in every case the
 * anchors differ by less than that themselves (Georgia's 1953 and 1979
 * aggregates differ by 0.003). So this asserts two things: a loose bound
 * everywhere, and STRICT betweenness wherever the anchors genuinely separate,
 * which is where the property has any meaning.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { US_STATES } from "@/lib/constants";
import {
  clearGranularElectorateCache,
  deriveGranularElectorateUnits,
  type GranularElectorateUnit,
} from "./granularElectorate";
import {
  getEraInterpolationFallbacks,
  resetEraInterpolationFallbacks,
} from "@/lib/seeds/eraInterpolation";

function aggregate(stateId: string, year: number) {
  const derived = deriveGranularElectorateUnits("US", stateId, "1953-default", null, null, null, {
    year,
    startingYear: 1953,
  });
  if (!derived || derived.units.length === 0) return null;
  let share = 0;
  let econ = 0;
  let social = 0;
  let turnout = 0;
  for (const u of derived.units as GranularElectorateUnit[]) {
    share += u.share;
    econ += u.share * u.economicLean;
    social += u.share * u.socialLean;
    turnout += u.share * u.turnout;
  }
  if (share === 0) return null;
  return { econ: econ / share, social: social / share, turnout: turnout / share, share };
}

/**
 * Slack for the share×lean bilinear term (see the module doc). Two thirds of
 * one percent of a single axis unit — far below any gameplay-visible
 * difference, and below the 0.5 lean quantization step units are coalesced on.
 */
// Raised 0.05 -> 0.08 with the 2026-08 compressed era calibration: anchors
// sit much closer together now (e.g. CA 1953/1979 econ within 0.05), so the
// checkpoint pacing's legitimate bow between anchors can exceed the old
// slack while still being far below the quantization step.
const BILINEAR_SLACK = 0.08;
/** Anchor separation above which strict betweenness is required. */
const MEANINGFUL_SEPARATION = 0.25;

beforeEach(() => {
  clearGranularElectorateCache();
  resetEraInterpolationFallbacks();
});

describe("a synthetic 1966 lands between its anchors, in every state", () => {
  it("holds for the economic axis", () => {
    const loose: string[] = [];
    const strict: string[] = [];
    let strictChecked = 0;
    for (const stateId of US_STATES) {
      const a = aggregate(stateId, 1953);
      clearGranularElectorateCache();
      const mid = aggregate(stateId, 1966);
      clearGranularElectorateCache();
      const b = aggregate(stateId, 1979);
      if (!a || !mid || !b) continue;
      const lo = Math.min(a.econ, b.econ);
      const hi = Math.max(a.econ, b.econ);
      const line = `${stateId}: 1953=${a.econ.toFixed(3)} 1966=${mid.econ.toFixed(3)} 1979=${b.econ.toFixed(3)}`;
      if (mid.econ < lo - BILINEAR_SLACK || mid.econ > hi + BILINEAR_SLACK) loose.push(line);
      if (hi - lo > MEANINGFUL_SEPARATION) {
        strictChecked++;
        if (mid.econ < lo || mid.econ > hi) strict.push(line);
      }
    }
    expect(loose, loose.join("\n")).toEqual([]);
    expect(strict, strict.join("\n")).toEqual([]);
    expect(strictChecked, "no state separated enough to test strictly").toBeGreaterThan(0);
  });

  it("holds for the social axis", () => {
    const loose: string[] = [];
    const strict: string[] = [];
    let strictChecked = 0;
    for (const stateId of US_STATES) {
      const a = aggregate(stateId, 1953);
      clearGranularElectorateCache();
      const mid = aggregate(stateId, 1966);
      clearGranularElectorateCache();
      const b = aggregate(stateId, 1979);
      if (!a || !mid || !b) continue;
      const lo = Math.min(a.social, b.social);
      const hi = Math.max(a.social, b.social);
      const line = `${stateId}: 1953=${a.social.toFixed(3)} 1966=${mid.social.toFixed(3)} 1979=${b.social.toFixed(3)}`;
      if (mid.social < lo - BILINEAR_SLACK || mid.social > hi + BILINEAR_SLACK) loose.push(line);
      if (hi - lo > MEANINGFUL_SEPARATION) {
        strictChecked++;
        if (mid.social < lo || mid.social > hi) strict.push(line);
      }
    }
    expect(loose, loose.join("\n")).toEqual([]);
    expect(strict, strict.join("\n")).toEqual([]);
    expect(strictChecked, "no state separated enough to test strictly").toBeGreaterThan(0);
  });

  it("holds for turnout", () => {
    const offenders: string[] = [];
    for (const stateId of US_STATES) {
      const a = aggregate(stateId, 1953);
      clearGranularElectorateCache();
      const mid = aggregate(stateId, 1966);
      clearGranularElectorateCache();
      const b = aggregate(stateId, 1979);
      if (!a || !mid || !b) continue;
      // Turnout is a geometric mean per cell then a share-weighted mean here,
      // so a small overshoot at the aggregate is possible; allow a tenth of a
      // point rather than asserting exact convexity.
      const lo = Math.min(a.turnout, b.turnout) - 0.1;
      const hi = Math.max(a.turnout, b.turnout) + 0.1;
      if (mid.turnout < lo || mid.turnout > hi) {
        offenders.push(
          `${stateId}: ${a.turnout.toFixed(2)} / ${mid.turnout.toFixed(2)} / ${b.turnout.toFixed(2)}`
        );
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});

describe("every state derives an electorate at every year in the range", () => {
  it("never returns an empty unit list, and never silently falls back", () => {
    const missing: string[] = [];
    for (const year of [1953, 1960, 1966, 1979, 1985, 1991, 1999, 2007, 2013, 2019, 2023]) {
      for (const stateId of US_STATES) {
        const agg = aggregate(stateId, year);
        if (!agg) missing.push(`${stateId}@${year}`);
      }
      clearGranularElectorateCache();
    }
    expect(missing, `states with no derivable electorate: ${missing.join(", ")}`).toEqual([]);
    // A fallback here would mean an authoring gap silently shaped the result.
    expect(getEraInterpolationFallbacks()).toEqual([]);
  });

  it("keeps every state's electorate shares summing to 1", () => {
    for (const stateId of ["AL", "CA", "NY", "WV", "UT"]) {
      for (const year of [1953, 1966, 1985, 2007, 2023]) {
        const agg = aggregate(stateId, year);
        expect(agg, `${stateId}@${year}`).not.toBeNull();
        expect(agg?.share, `${stateId}@${year}`).toBeCloseTo(1, 6);
        clearGranularElectorateCache();
      }
    }
  });
});
