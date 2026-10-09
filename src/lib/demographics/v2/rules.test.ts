import { describe, expect, it } from "vitest";
import {
  applyRegisteredShareToParticipation,
  liveElectorateAgeMarginals,
  resolveCompetitiveness,
  resolveIssueSalience,
  resolveParticipation,
  summarizeParticipation,
} from "./rules";
import { demographicsV2CalibrationForCountry } from "./calibration";

function vector(entries: Array<[age: number, population: number]>) {
  const male = Array<number>(101).fill(0);
  const female = Array<number>(101).fill(0);
  for (const [age, population] of entries) {
    male[age] = population / 2;
    female[age] = population / 2;
  }
  return { male, female };
}

describe("Demographics v2 rules", () => {
  it("derives electorate age shares from the live vector and excludes children", () => {
    const result = liveElectorateAgeMarginals(
      vector([
        [10, 500],
        [20, 20],
        [35, 30],
        [50, 40],
        [70, 10],
      ])
    );
    expect(result).toEqual({ young: 20, mid: 30, mature: 40, senior: 10 });
  });

  it("honors a higher legal voting age", () => {
    const result = liveElectorateAgeMarginals(
      vector([
        [18, 30],
        [21, 20],
        [40, 50],
      ]),
      21
    );
    expect(result?.young).toBeCloseTo(20 / 0.7);
    expect(result?.mid).toBeCloseTo(50 / 0.7);
    expect(result?.mature).toBe(0);
    expect(result?.senior).toBe(0);
  });

  it("returns an additive participation ledger and clamps the final rate", () => {
    expect(
      resolveParticipation({
        baselineTurnout: 60,
        salience: 1,
        competitiveness: 1,
        accessFriction: 0.25,
        contactLift: 4,
        saturation: 0.5,
      })
    ).toEqual({
      baseline: 60,
      salience: 3,
      competitiveness: 3,
      access: -1,
      contact: 4,
      saturation: -1,
      resolvedTurnout: 68,
    });
    expect(
      resolveParticipation({
        baselineTurnout: 94,
        salience: 1,
        competitiveness: 1,
        accessFriction: 0,
      }).resolvedTurnout
    ).toBe(95);
  });

  it("applies the registered share once and records the exact access effect", () => {
    const result = applyRegisteredShareToParticipation(
      {
        baseline: 60,
        salience: 2,
        competitiveness: 3,
        access: 0,
        contact: 4,
        saturation: -1,
        resolvedTurnout: 68,
      },
      0.9
    );
    expect(result).toMatchObject({
      baseline: 60,
      salience: 2,
      competitiveness: 3,
      contact: 4,
      saturation: -1,
      resolvedTurnout: 61.2,
    });
    expect(result.access).toBeCloseTo(-6.8);
  });

  it("turns candidate contrast into bounded axis salience and race closeness", () => {
    expect(
      resolveIssueSalience([
        { economic: -4, social: -1 },
        { economic: 4, social: 1 },
      ])
    ).toEqual({ economic: 1.15, social: 0.9249999999999999, overall: 0.625 });
    expect(resolveCompetitiveness([52, 50, 20])).toBeCloseTo(14 / 15);
    expect(resolveCompetitiveness([80])).toBe(0);
  });

  it("selects a versioned country calibration with a safe global fallback", () => {
    expect(demographicsV2CalibrationForCountry("US").id).toBe("US-v1");
    expect(demographicsV2CalibrationForCountry("UK").accessMaxPoints).toBe(2.5);
    expect(demographicsV2CalibrationForCountry("ZZ").id).toBe("global-v1");
  });

  it("summarizes unit ledgers using electorate shares", () => {
    const calibration = demographicsV2CalibrationForCountry("US");
    const summary = summarizeParticipation({
      calibration,
      competitiveness: 0.8,
      issueSalience: { economic: 1.1, social: 0.9, overall: 0.5 },
      rows: [
        {
          share: 0.75,
          ledger: {
            baseline: 60,
            salience: 1,
            competitiveness: 2,
            access: -1,
            contact: 2,
            saturation: -0.2,
            resolvedTurnout: 63.8,
          },
        },
        {
          share: 0.25,
          ledger: {
            baseline: 80,
            salience: 1,
            competitiveness: 2,
            access: -1,
            contact: 4,
            saturation: -0.8,
            resolvedTurnout: 85.2,
          },
        },
      ],
    });
    expect(summary).toMatchObject({ calibrationId: "US-v1", baseline: 65, contact: 2.5 });
    expect(summary?.resolvedTurnout).toBeCloseTo(69.15);
  });
});
