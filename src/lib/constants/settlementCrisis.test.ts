import { describe, expect, it } from "vitest";
import {
  SETTLEMENT_INSTITUTIONS,
  SETTLEMENT_SEATS,
  SETTLEMENT_PLAYS,
  TOTAL_INSTITUTION_WEIGHT,
  CARRY_THRESHOLD,
  LOCK_THRESHOLD,
  HUNDREDTHS,
  playsForSeat,
} from "./settlementCrisis";

describe("settlement crisis config", () => {
  it("institution weights sum to the declared total", () => {
    const sum = SETTLEMENT_INSTITUTIONS.reduce((s, i) => s + i.weight, 0);
    expect(sum).toBe(TOTAL_INSTITUTION_WEIGHT);
  });

  it("gives every institution a distinct id", () => {
    const ids = SETTLEMENT_INSTITUTIONS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps every play id distinct from every institution id", () => {
    // A play id colliding with an institution id makes target routing
    // ambiguous — this is why the source design's RU `garrison` play is
    // `pressure` here.
    const institutionIds = new Set<string>(SETTLEMENT_INSTITUTIONS.map((i) => i.id));
    for (const play of SETTLEMENT_PLAYS) {
      expect(institutionIds.has(play.id)).toBe(false);
    }
  });

  it("gives every play a globally distinct id", () => {
    const ids = SETTLEMENT_PLAYS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("targets every play at a real institution or at the settlement", () => {
    const institutionIds = new Set<string>(SETTLEMENT_INSTITUTIONS.map((i) => i.id));
    for (const play of SETTLEMENT_PLAYS) {
      if (play.target === null) continue; // settlement-level
      expect(institutionIds.has(play.target)).toBe(true);
    }
  });

  it("stores every magnitude unsigned and on the hundredths grid", () => {
    for (const play of SETTLEMENT_PLAYS) {
      expect(play.magnitude).toBeGreaterThan(0);
      expect(Number.isInteger(play.magnitude)).toBe(true);
    }
  });

  it("seeds institutions with anchors West of their opening", () => {
    // The user's balance ruling: Bonn's own politics resist reunification.
    for (const inst of SETTLEMENT_INSTITUTIONS) {
      expect(inst.anchor).toBeLessThan(inst.opening);
    }
  });

  it("puts the weighted anchor at exactly 35 points", () => {
    const weighted =
      SETTLEMENT_INSTITUTIONS.reduce((s, i) => s + i.anchor * i.weight, 0) /
      TOTAL_INSTITUTION_WEIGHT;
    expect(weighted).toBe(35 * HUNDREDTHS);
  });

  it("puts the weighted opening at 38.2 points", () => {
    const weighted =
      SETTLEMENT_INSTITUTIONS.reduce((s, i) => s + i.opening * i.weight, 0) /
      TOTAL_INSTITUTION_WEIGHT;
    expect(weighted).toBe(3820);
  });

  it("orders the thresholds sanely", () => {
    expect(LOCK_THRESHOLD).toBeLessThan(CARRY_THRESHOLD);
    expect(LOCK_THRESHOLD).toBe(1500);
    expect(CARRY_THRESHOLD).toBe(8500);
  });

  it("restricts personal plays to the street and the Bundestag", () => {
    for (const play of playsForSeat(null)) {
      expect(["street", "bundestag"]).toContain(play.target);
    }
  });

  it("gives each national seat only its own plays", () => {
    expect(
      playsForSeat("DD")
        .map((p) => p.id)
        .sort()
    ).toEqual(["aid", "border", "referendum", "terms"]);
    expect(
      playsForSeat("UK")
        .map((p) => p.id)
        .sort()
    ).toEqual(["broadcast", "fourpower", "rhine"]);
  });

  it("grants escalation authority to Washington and Moscow only", () => {
    const authority = SETTLEMENT_SEATS.filter((s) => s.authority)
      .map((s) => s.id)
      .sort();
    expect(authority).toEqual(["RU", "US"]);
  });
});
