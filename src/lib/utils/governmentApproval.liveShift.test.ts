import { describe, it, expect } from "vitest";
import {
  computeStateApprovalBase,
  computeNationalAveragesFromMetrics,
  APPROVAL_AXIS_WEIGHT_K,
} from "@/lib/utils/governmentApproval";
import type { StateMetrics } from "@/lib/db/types";
import type { StateDemographicGroup } from "@/lib/db/types/demographics";

/**
 * P6d GATE 2 — live-shift bound. The cutover (the six axis metrics enter the
 * basket + electorate weighting) must not move any representative state's
 * approval by more than ±5 pts vs the pre-cutover value (axis metrics excluded,
 * ideology-blind average). If this gate fails, APPROVAL_AXIS_WEIGHT_K is too
 * high and must be reduced.
 */

const AXIS_METRIC_PATHS: Array<[string, string]> = [
  ["governance", "civilLiberties"],
  ["governance", "nationalPride"],
  ["governance", "militaryReadiness"],
  ["economic", "economicFreedom"],
  ["economic", "regulatoryBurden"],
  ["mediaInformation", "stateMediaControl"],
];

function stripAxis(m: StateMetrics): StateMetrics {
  const clone = JSON.parse(JSON.stringify(m)) as StateMetrics;
  for (const [cat, id] of AXIS_METRIC_PATHS) {
    const c = clone[cat as keyof StateMetrics] as Record<string, unknown> | undefined;
    if (c) delete c[id];
  }
  return clone;
}

/** A realistic multi-metric state with a spread of values + the 6 axis metrics. */
function buildState(
  id: string,
  spread: number // -1 (poor) .. +1 (strong) shifts every metric off the basket centre
): StateMetrics {
  const s = (base: number, swing: number) => ({ value: base + swing * spread });
  return {
    _id: id,
    economic: {
      gdpGrowth: s(2.5, 1.5),
      unemploymentRate: s(6, -2),
      povertyRate: s(13, -4),
      medianIncome: s(50000, 12000),
      smallBusinessFormation: s(8, 2),
      economicFreedom: s(50, 15),
      regulatoryBurden: s(50, -15),
    },
    education: { highSchoolGradRate: s(88, 5), testPerformance: s(70, 10) },
    healthcare: { lifeExpectancy: s(79, 2), nhsWaitingTime: s(18, -6) },
    publicSafety: { crimeRate: s(4500, -1500), incarcerationRate: s(450, -100) },
    social: { childPoverty: s(18, -6), housingAffordability: s(40, -15) },
    governance: {
      civilLiberties: s(55, 15),
      nationalPride: s(52, 12),
      militaryReadiness: s(50, 15),
    },
    mediaInformation: { pressFreedom: s(69, 12), stateMediaControl: s(30, -12) },
  } as unknown as StateMetrics;
}

function group(population: number, econ: number, social: number): StateDemographicGroup {
  return { population, economicLean: econ, socialLean: social };
}

// Electorate flavors spanning the compass.
const ELECTORATES: Record<string, StateDemographicGroup[]> = {
  conservative: [group(55, 4, 4), group(45, 2, 2)],
  progressive: [group(55, -4, -4), group(45, -2, -3)],
  libertarian: [group(50, 4, -4), group(50, 3, -3)],
  authoritarianLeft: [group(50, -4, 4), group(50, -3, 3)],
  centrist: [group(100, 0, 0)],
};

/**
 * A POLARIZED state — strong on right/authoritarian-coded metrics, weak on
 * left-coded services. This is where electorate weighting bites hardest, so it
 * is the real stress test for the ±5pt bound (the lockstep spread states above
 * barely move because reweighting near-identical contributions is near-neutral).
 */
function buildPolarized(id: string): StateMetrics {
  return {
    _id: id,
    economic: {
      gdpGrowth: { value: 5 },
      unemploymentRate: { value: 4 },
      povertyRate: { value: 20 },
      medianIncome: { value: 55000 },
      smallBusinessFormation: { value: 12 },
      economicFreedom: { value: 75 },
      regulatoryBurden: { value: 25 },
    },
    healthcare: { lifeExpectancy: { value: 77 }, nhsWaitingTime: { value: 30 } },
    publicSafety: { crimeRate: { value: 3000 }, incarcerationRate: { value: 600 } },
    social: { childPoverty: { value: 28 }, housingAffordability: { value: 30 } },
    governance: {
      civilLiberties: { value: 40 },
      nationalPride: { value: 80 },
      militaryReadiness: { value: 80 },
    },
    mediaInformation: { pressFreedom: { value: 55 }, stateMediaControl: { value: 50 } },
  } as unknown as StateMetrics;
}

describe("P6d live-shift bound (GATE 2)", () => {
  // A spread of states + a polarized one form the national average; we measure
  // each one's shift across every electorate flavor.
  const states = [
    ...[-1, -0.5, 0, 0.5, 1].map((sp, i) => buildState(`S${i}`, sp)),
    buildPolarized("POLAR"),
    // a left-strong mirror so the average isn't skewed by the single polarized doc
    buildState("MIRROR", -0.8),
  ];
  const cutoverAverages = computeNationalAveragesFromMetrics(states);
  const baselineAverages = computeNationalAveragesFromMetrics(states.map(stripAxis));

  it(`every state × every electorate shifts ≤ 5 pts at k=${APPROVAL_AXIS_WEIGHT_K}`, () => {
    let maxShift = 0;
    for (const m of states) {
      const baseline = computeStateApprovalBase(stripAxis(m), baselineAverages);
      for (const [flavor, groups] of Object.entries(ELECTORATES)) {
        const cutover = computeStateApprovalBase(m, cutoverAverages, { groups });
        const shift = Math.abs(cutover - baseline);
        maxShift = Math.max(maxShift, shift);
        expect(shift, `${m._id} / ${flavor}: ${baseline} → ${cutover}`).toBeLessThanOrEqual(5);
      }
    }
    // Sanity: the weighting actually does something (not a no-op everywhere).
    expect(maxShift).toBeGreaterThan(0);
  });

  it("electorate ideology tilts approval the right way: conservatives reward a right/auth-polarized state more than progressives", () => {
    // buildState(1) is strong on BOTH camps' preferred metrics, so after the
    // #2897 affinity recalibration (stateMediaControl/incarcerationRate flipped
    // to social:-1 — lower-is-better libertarian goods) it no longer separates
    // the electorates. The POLARIZED state (strong right/auth metrics, weak
    // left-coded services) is the construction that still expresses the tilt.
    const strong = buildPolarized("STRONG");
    const cons = computeStateApprovalBase(strong, cutoverAverages, {
      groups: ELECTORATES.conservative,
    });
    const prog = computeStateApprovalBase(strong, cutoverAverages, {
      groups: ELECTORATES.progressive,
    });
    // A right/authoritarian-strong state pleases conservatives more than progressives.
    expect(cons).toBeGreaterThan(prog);
  });
});
