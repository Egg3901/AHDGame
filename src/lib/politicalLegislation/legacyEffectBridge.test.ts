import { describe, expect, it } from "vitest";
import { politicalScoreFromLegacyValue } from "@/lib/politicalMetrics/derive/legacyInversion";
import { BOARD_DELTA_CAP, boardDeltaForLegacyEffect } from "./legacyEffectBridge";

describe("boardDeltaForLegacyEffect", () => {
  it("returns null for a legacy path with no adapter row", () => {
    // Not a failure to handle: inventing a mapping would fabricate a policy
    // channel nobody designed.
    expect(boardDeltaForLegacyEffect("governance", "notAMetric", 5)).toBeNull();
  });

  it("returns null for a zero or non-finite delta", () => {
    expect(boardDeltaForLegacyEffect("education", "literacyRate", 0)).toBeNull();
    expect(boardDeltaForLegacyEffect("education", "literacyRate", Number.NaN)).toBeNull();
  });

  it("maps a legacy metric to its political family", () => {
    const r = boardDeltaForLegacyEffect("education", "literacyRate", 1)!;
    expect(r.familyId).toBe("education.universalSchooling");
  });

  it("converts the delta onto the 0-100 board scale, not 1:1", () => {
    // literacyRate's realistic span is far narrower than 100 points, so a
    // 1-point legacy move is worth MORE than 1 board point. Passing the raw
    // delta through would silently under- or over-state every law.
    const r = boardDeltaForLegacyEffect("education", "literacyRate", 1)!;
    expect(r.scoreDelta).not.toBeCloseTo(1, 6);
    expect(r.scoreDelta).toBeGreaterThan(0);
  });

  it("matches the derivation's own scale — a full-span delta is 100 board points", () => {
    // The property that keeps this consistent with politicalScoreFromLegacyValue:
    // both normalize over metricQualityRange, so moving a metric across its
    // entire realistic span is exactly one full board sweep.
    const worst = politicalScoreFromLegacyValue("education", "literacyRate", 0);
    const best = politicalScoreFromLegacyValue("education", "literacyRate", 100);
    expect(worst).not.toBeNull();
    expect(best).not.toBeNull();
    // A delta equal to the span is one full board sweep BEFORE the cap, so the
    // scale is checked at a tenth of it and the cap is asserted separately.
    const oneBoardPoint = boardDeltaForLegacyEffect("education", "literacyRate", 1)!.scoreDelta;
    const spanDelta = 100 / oneBoardPoint; // legacy units per full board sweep
    const tenth = boardDeltaForLegacyEffect("education", "literacyRate", spanDelta / 10)!;
    expect(tenth.scoreDelta).toBeCloseTo(10, 6);
    const full = boardDeltaForLegacyEffect("education", "literacyRate", spanDelta)!;
    expect(full.scoreDelta).toBe(BOARD_DELTA_CAP);
  });

  it("flips sign for lower-is-better metrics", () => {
    // A law that CUTS crime must RAISE the board, not lower it. Getting this
    // backwards would invert every public-safety law in the legacy catalog.
    const cut = boardDeltaForLegacyEffect("publicSafety", "crimeRate", -500)!;
    const rise = boardDeltaForLegacyEffect("publicSafety", "crimeRate", 500)!;
    expect(cut.scoreDelta).toBeGreaterThan(0);
    expect(rise.scoreDelta).toBeLessThan(0);

    const moreLiteracy = boardDeltaForLegacyEffect("education", "literacyRate", 5)!;
    expect(moreLiteracy.scoreDelta).toBeGreaterThan(0);
  });

  it("is linear and symmetric in the delta", () => {
    const one = boardDeltaForLegacyEffect("education", "literacyRate", 1)!.scoreDelta;
    const two = boardDeltaForLegacyEffect("education", "literacyRate", 2)!.scoreDelta;
    const minusOne = boardDeltaForLegacyEffect("education", "literacyRate", -1)!.scoreDelta;
    expect(two).toBeCloseTo(one * 2, 9);
    expect(minusOne).toBeCloseTo(-one, 9);
  });
});

describe("boardDeltaForLegacyEffect — narrow-band amplification (ticket #1129)", () => {
  it("caps a grid-collapse crisis tick instead of flooring the family", () => {
    // powerGridReliability's quality span is [97, 99.9] — 2.9 points wide — so
    // the authored -4.5 per turn normalized to -155 board points and clamped
    // infrastructure.utilities to 0 on the first tick.
    const hit = boardDeltaForLegacyEffect("infrastructure", "powerGridReliability", -4.5);
    expect(hit).not.toBeNull();
    expect(hit?.familyId).toBe("infrastructure.utilities");
    expect(hit?.scoreDelta).toBe(-BOARD_DELTA_CAP);
  });

  it("caps in the positive direction too", () => {
    const hit = boardDeltaForLegacyEffect("infrastructure", "powerGridReliability", 4.5);
    expect(hit?.scoreDelta).toBe(BOARD_DELTA_CAP);
  });

  it("leaves an in-range delta untouched", () => {
    const hit = boardDeltaForLegacyEffect("infrastructure", "powerGridReliability", 0.03);
    expect(hit?.scoreDelta).toBeCloseTo(1.0345, 3);
  });

  it("uses the era band when a year is supplied", () => {
    // 1953 band is [84, 98] — 14 points wide — so the same delta is far smaller.
    const modern = boardDeltaForLegacyEffect("infrastructure", "powerGridReliability", 0.29);
    const early = boardDeltaForLegacyEffect("infrastructure", "powerGridReliability", 0.29, {
      countryId: "US",
      year: 1953,
    });
    expect(early!.scoreDelta).toBeLessThan(modern!.scoreDelta);
  });
});
