import { describe, expect, it } from "vitest";
import {
  CALL_MARGIN_PCT,
  PRE_FINAL_REPORTING_CAP,
  computeBaselineReportingPct,
  computeElectoralTotals,
  computeFinalHour,
  computeNationalProjection,
  computeUnitResult,
  hashFraction,
  unitRevealOffset,
} from "./computeResults";
import type { NationalParty } from "./types";

const NOW = new Date("2026-07-07T21:30:00Z");

describe("hashFraction / unitRevealOffset", () => {
  it("is deterministic and in range", () => {
    const values = Array.from({ length: 20 }, () => unitRevealOffset("e1", "PA"));
    expect(new Set(values).size).toBe(1);
    for (const key of ["PA", "CA", "TX", "ME_CD1", "WY"]) {
      const offset = unitRevealOffset("e1", key);
      expect(offset).toBeGreaterThanOrEqual(0.06);
      expect(offset).toBeLessThanOrEqual(0.94);
    }
  });

  it("orders units differently per election", () => {
    const a = ["PA", "CA", "TX", "GA", "AZ"].map((u) => unitRevealOffset("e1", u));
    const b = ["PA", "CA", "TX", "GA", "AZ"].map((u) => unitRevealOffset("e2", u));
    expect(a).not.toEqual(b);
  });

  it("hashFraction stays in [0,1)", () => {
    for (let i = 0; i < 50; i++) {
      const v = hashFraction(`key-${i}`);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("computeFinalHour", () => {
  const base = {
    status: "active",
    currentTurn: 47,
    endTurn: 48,
    nextScheduledTurn: new Date(NOW.getTime() + 30 * 60 * 1000),
    pausedAt: null,
    now: NOW,
  };

  it("is half elapsed 30 minutes before a 60-minute final turn", () => {
    const result = computeFinalHour(base);
    expect(result).not.toBeNull();
    expect(result!.progress).toBeCloseTo(0.5, 5);
    expect(result!.endsAt).toEqual(base.nextScheduledTurn);
  });

  it("respects a 30-minute fastMode window", () => {
    const result = computeFinalHour(
      { ...base, nextScheduledTurn: new Date(NOW.getTime() + 15 * 60 * 1000) },
      30 * 60 * 1000
    );
    expect(result!.progress).toBeCloseTo(0.5, 5);
  });

  it("returns null outside the final turn window", () => {
    expect(computeFinalHour({ ...base, currentTurn: 45 })).toBeNull();
  });

  it("returns null when paused, missing schedule, or not active", () => {
    expect(computeFinalHour({ ...base, pausedAt: new Date() })).toBeNull();
    expect(computeFinalHour({ ...base, nextScheduledTurn: null })).toBeNull();
    expect(computeFinalHour({ ...base, status: "completed" })).toBeNull();
  });

  it("clamps to [0,1] when the turn is overdue", () => {
    const result = computeFinalHour({
      ...base,
      nextScheduledTurn: new Date(NOW.getTime() - 5 * 60 * 1000),
    });
    expect(result!.progress).toBe(1);
  });
});

describe("computeBaselineReportingPct", () => {
  it("scales with elapsed general-phase turns and caps below 100", () => {
    const at = (currentTurn: number) =>
      computeBaselineReportingPct({ currentTurn, startTurn: 0, endTurn: 48, primaryEndTurn: 24 });
    expect(at(24)).toBe(0);
    expect(at(36)).toBe(50);
    expect(at(48)).toBe(PRE_FINAL_REPORTING_CAP);
  });

  it("handles missing turn fields without dividing by zero", () => {
    expect(
      computeBaselineReportingPct({
        currentTurn: 10,
        startTurn: null,
        endTurn: null,
        primaryEndTurn: null,
      })
    ).toBe(PRE_FINAL_REPORTING_CAP);
  });
});

describe("computeUnitResult", () => {
  const baseInput = {
    electionId: "e1",
    unitId: "PA",
    name: "Pennsylvania",
    weight: 19,
    votes: { alice: 600_000, bob: 500_000 },
    isEnded: false,
    baselineReportingPct: 60,
    finalHourProgress: null as number | null,
  };

  it("never calls a unit mid-campaign", () => {
    const unit = computeUnitResult(baseInput);
    expect(unit.called).toBe(false);
    expect(unit.leaderId).toBe("alice");
    expect(unit.reportingPct).toBeLessThanOrEqual(PRE_FINAL_REPORTING_CAP);
  });

  it("calls a decisive unit once the drip passes its reveal offset", () => {
    const offset = unitRevealOffset("e1", "PA");
    const before = computeUnitResult({ ...baseInput, finalHourProgress: offset - 0.01 });
    const after = computeUnitResult({ ...baseInput, finalHourProgress: offset + 0.01 });
    expect(before.called).toBe(false);
    expect(after.called).toBe(true);
    expect(after.calledFor).toBe("alice");
    expect(after.reportingPct).toBe(100);
  });

  it("leaves a close race uncalled even when revealed", () => {
    // ~0.9% margin, below CALL_MARGIN_PCT
    const unit = computeUnitResult({
      ...baseInput,
      votes: { alice: 505_000, bob: 500_500 },
      finalHourProgress: 1,
    });
    expect(unit.leaderMarginPct).toBeLessThan(CALL_MARGIN_PCT);
    expect(unit.called).toBe(false);
  });

  it("never calls a tie, even after the election ends", () => {
    const unit = computeUnitResult({
      ...baseInput,
      votes: { alice: 100, bob: 100 },
      isEnded: true,
    });
    expect(unit.tied).toBe(true);
    expect(unit.called).toBe(false);
  });

  it("calls every decided unit when the election has ended", () => {
    const unit = computeUnitResult({
      ...baseInput,
      votes: { alice: 505_000, bob: 500_500 },
      isEnded: true,
    });
    expect(unit.called).toBe(true);
    expect(unit.reportingPct).toBe(100);
  });

  it("reports empty units as silent", () => {
    const unit = computeUnitResult({ ...baseInput, votes: {} });
    expect(unit.totalVotes).toBe(0);
    expect(unit.reportingPct).toBe(0);
    expect(unit.called).toBe(false);
    expect(unit.leaderId).toBeUndefined();
  });

  it("reporting is monotonic in drip progress", () => {
    const steps = [0, 0.2, 0.4, 0.6, 0.8, 1].map(
      (p) => computeUnitResult({ ...baseInput, finalHourProgress: p }).reportingPct
    );
    const sorted = [...steps].sort((a, b) => a - b);
    expect(steps).toEqual(sorted);
  });
});

describe("computeElectoralTotals", () => {
  it("splits called vs leading EV", () => {
    const mk = (id: string, weight: number, called: boolean, leader: string) => ({
      id,
      name: id,
      weight,
      totalVotes: 100,
      reportingPct: 100,
      called,
      calledFor: called ? leader : undefined,
      leaderId: leader,
      tied: false,
      leaderMargin: 10,
      leaderMarginPct: 10,
      candidates: [],
    });
    const { calledEv, leadingEv } = computeElectoralTotals([
      mk("CA", 54, true, "alice"),
      mk("TX", 40, true, "bob"),
      mk("PA", 19, false, "alice"),
    ]);
    expect(calledEv).toEqual({ alice: 54, bob: 40 });
    expect(leadingEv).toEqual({ alice: 19 });
  });
});

describe("computeNationalProjection", () => {
  const party = (id: string, name: string, projectedSeats: number): NationalParty => ({
    party: id,
    name,
    abbreviation: name.slice(0, 3).toUpperCase(),
    color: "#123456",
    declaredSeats: 0,
    projectedSeats,
  });

  it("calls a Westminster majority with its margin", () => {
    const projection = computeNationalProjection(
      [party("1", "Labour", 337), party("2", "Conservative", 290)],
      326,
      "westminster"
    );
    expect(projection.kind).toBe("majority");
    expect(projection.partyName).toBe("Labour");
    expect(projection.margin).toBe(12); // 337 - 326 + 1
  });

  it("calls a hung parliament in westminster style", () => {
    const projection = computeNationalProjection(
      [party("1", "Labour", 320), party("2", "Conservative", 310)],
      326,
      "westminster"
    );
    expect(projection.kind).toBe("hung");
    expect(projection.partyName).toBe("Labour");
  });

  it("reports largest party for generic chambers without a majority", () => {
    const projection = computeNationalProjection(
      [party("1", "GOP", 215), party("2", "Dems", 210)],
      218,
      "generic"
    );
    expect(projection.kind).toBe("largest");
    expect(projection.margin).toBe(5);
  });

  it("is tooEarly when nothing is counted", () => {
    expect(computeNationalProjection([party("1", "A", 0)], 10, "westminster").kind).toBe(
      "tooEarly"
    );
  });
});
