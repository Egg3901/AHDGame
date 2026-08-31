import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import { computeForceMetricDeltas, driftReadiness } from "./militaryForceEffects";
import { readinessBaselineOf, ARREARS_READINESS_WEIGHT } from "@/lib/military/readinessDrift";
import { aggregateForce } from "@/lib/constants/military";
import { buildCountryRoster } from "@/lib/admin/seed/seedMilitaryUnits";
import type { MilitaryUnit } from "@/lib/db/types/militaryUnit";

describe("computeForceMetricDeltas", () => {
  // The second argument is now the upkeep BURDEN — the share of a turn's defence income the
  // force consumes — not a synthetic envelope. A burden above 1 means the force costs more
  // than the line brings in, which is the only honest definition of over budget.
  it("a force costing more than the line accrues produces a negative budgetBalance", () => {
    const agg = {
      unitCount: 5,
      totalPower: 1000,
      totalPersonnel: 1,
      totalUpkeep: 1500,
      avgReadiness: 70,
      forwardShare: 0,
    };
    const d = computeForceMetricDeltas(agg, 1.5);
    expect(d.budgetBalance).toBeLessThan(0);
    expect(d.publicSafetyConfidence).toBeGreaterThan(0); // power + readiness above baseline
  });

  it("a force inside its income produces a non-negative budgetBalance", () => {
    const agg = {
      unitCount: 5,
      totalPower: 500,
      totalPersonnel: 1,
      totalUpkeep: 600,
      avgReadiness: 55,
      forwardShare: 0,
    };
    const d = computeForceMetricDeltas(agg, 0.6);
    expect(d.budgetBalance).toBeGreaterThanOrEqual(0);
  });

  // A country with no usable defence line has NO signal, which must contribute nothing. A
  // burden of 0 would read as "this force is free" — the most positive value there is — so
  // the absent case is null, not zero.
  it("a null burden contributes no budgetBalance rather than a maximal one", () => {
    const d = computeForceMetricDeltas(
      {
        unitCount: 0,
        totalPower: 0,
        totalPersonnel: 0,
        totalUpkeep: 0,
        avgReadiness: 0,
        forwardShare: 0,
      },
      null
    );
    expect(d.budgetBalance).toBe(0);
    expect(Number.isFinite(d.budgetBalance)).toBe(true);
  });

  // These two pin the ONE thing that must never be simplified away: a burden of 0 and an
  // absent burden are opposite readings. 0 means the force costs nothing to sustain — the
  // most positive score available — while null means the country has no usable defence line
  // and the metric must stay silent. Narrowing the parameter to `number` and letting callers
  // pass 0 would quietly hand every unfunded country a maximal budget balance.
  it("treats a zero burden as the MAXIMAL budget balance, not an absent one", () => {
    const d = computeForceMetricDeltas(
      {
        unitCount: 3,
        totalPower: 500,
        totalPersonnel: 1,
        totalUpkeep: 600,
        avgReadiness: 70,
        forwardShare: 0,
      },
      0
    );
    expect(d.budgetBalance).toBeGreaterThan(0);
  });

  it("scores an absent burden strictly below a zero one", () => {
    const absent = computeForceMetricDeltas(
      {
        unitCount: 3,
        totalPower: 500,
        totalPersonnel: 1,
        totalUpkeep: 600,
        avgReadiness: 70,
        forwardShare: 0,
      },
      null
    );
    const free = computeForceMetricDeltas(
      {
        unitCount: 3,
        totalPower: 500,
        totalPersonnel: 1,
        totalUpkeep: 600,
        avgReadiness: 70,
        forwardShare: 0,
      },
      0
    );
    expect(absent.budgetBalance).toBe(0);
    expect(absent.budgetBalance).toBeLessThan(free.budgetBalance);
  });
});

describe("W1 balance pass — unified power holds the calibrated band", () => {
  // After vet/equipment entered effPower, a seeded force's publicSafetyConfidence
  // must stay in the calibrated ~0.02..0.06 band at the unchanged POWER_NORM=1500.
  for (const country of ["US", "CN"]) {
    it(`${country} seeded force lands publicSafetyConfidence in-band`, () => {
      const roster = buildCountryRoster(
        country,
        ["r1", "r2", "r3", "r4", "r5", "r6"],
        1,
        "2019"
      ).map((u) => ({ ...u, _id: new ObjectId() }) as MilitaryUnit);
      const agg = aggregateForce(roster, country, "standard");
      const deltas = computeForceMetricDeltas(agg, agg.totalUpkeep * 1.1);
      expect(deltas.publicSafetyConfidence).toBeGreaterThan(0.02);
      expect(deltas.publicSafetyConfidence).toBeLessThan(0.06);
    });
  }
});

describe("driftReadiness", () => {
  it("moves toward the posture baseline by a bounded step", () => {
    expect(driftReadiness(50, "alert")).toBeGreaterThan(50); // alert baseline is high
    expect(driftReadiness(95, "garrison")).toBeLessThan(95); // garrison baseline is lower
  });
  it("does not overshoot the baseline", () => {
    expect(driftReadiness(71, "standard")).toBe(72); // baseline 72, step capped at target
  });

  /**
   * A formation spent down to the floor has to be able to come back on a timescale a
   * player will actually see. The battle ledger's tempo escalator charges a worn unit
   * up to four times as much for the same engagement, so recovery that crawls leaves a
   * spent formation unable to climb out at any realistic fighting cadence: it is knocked
   * straight back to the floor by its next battle. Recovery has to outrun that.
   */
  it("brings a formation back from the floor inside half a day of turns", () => {
    let readiness = 3;
    let turns = 0;
    const target = readinessBaselineOf("alert");
    while (readiness < target && turns < 100) {
      readiness = driftReadiness(readiness, "alert");
      turns++;
    }
    expect(readiness).toBe(target);
    expect(turns).toBeLessThanOrEqual(12);
  });
});

// A force whose upkeep the defence appropriation could not fund settles toward a
// suppressed baseline. Deliberately a moved TARGET rather than a decay counter: on a
// one-hour turn clock an irreversible drain would punish sleeping, and this is fully
// reversible the moment funding returns.
describe("arrears suppression", () => {
  it("leaves the baseline alone with no arrears", () => {
    expect(readinessBaselineOf("standard", 0)).toBe(readinessBaselineOf("standard"));
  });

  it("suppresses the baseline in proportion to the unfunded share", () => {
    const full = readinessBaselineOf("standard");
    expect(readinessBaselineOf("standard", 1)).toBe(
      Math.round(full * (1 - ARREARS_READINESS_WEIGHT))
    );
    expect(readinessBaselineOf("standard", 0.5)).toBe(
      Math.round(full * (1 - 0.5 * ARREARS_READINESS_WEIGHT))
    );
  });

  it("clamps a nonsensical ratio rather than inverting the baseline", () => {
    expect(readinessBaselineOf("standard", 5)).toBe(readinessBaselineOf("standard", 1));
    expect(readinessBaselineOf("standard", -5)).toBe(readinessBaselineOf("standard", 0));
  });

  it("applies to every posture, including an unknown one", () => {
    for (const posture of ["garrison", "standard", "forward", "alert", "improvised"]) {
      expect(readinessBaselineOf(posture, 1)).toBeLessThan(readinessBaselineOf(posture, 0));
    }
  });

  it("drifts a unit down toward the suppressed baseline and back up once cleared", () => {
    const atBaseline = readinessBaselineOf("standard");
    expect(driftReadiness(atBaseline, "standard", 1)).toBeLessThan(atBaseline);
    const sagged = readinessBaselineOf("standard", 1);
    expect(driftReadiness(sagged, "standard", 0)).toBeGreaterThan(sagged);
  });

  it("never destroys a unit — the floor is a readiness value, not removal", () => {
    expect(readinessBaselineOf("garrison", 1)).toBeGreaterThan(0);
  });

  it("defaults to no suppression so existing callers are unchanged", () => {
    expect(driftReadiness(50, "alert")).toBe(driftReadiness(50, "alert", 0));
  });
});
