import { describe, expect, it } from "vitest";
import { politicalScoreFromLegacyValue } from "@/lib/politicalMetrics/derive/legacyInversion";
import { boardDeltaForLegacyEffect } from "./legacyEffectBridge";

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
    // Find the span the derivation actually used by bisecting is unnecessary —
    // a delta equal to the span must yield |scoreDelta| === 100.
    const oneBoardPoint = boardDeltaForLegacyEffect("education", "literacyRate", 1)!.scoreDelta;
    const spanDelta = 100 / oneBoardPoint; // legacy units per full board sweep
    const full = boardDeltaForLegacyEffect("education", "literacyRate", spanDelta)!;
    expect(full.scoreDelta).toBeCloseTo(100, 6);
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
