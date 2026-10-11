import { describe, it, expect } from "vitest";
import {
  applyConfidenceEvent,
  confidenceErosionScale,
  tickConfidence,
  isDissolutionTriggered,
  CONFIDENCE_START,
  CONFIDENCE_HITS,
  GREAT_OFFICE_MULTIPLIER,
  CONFIDENCE_MIN,
  CONFIDENCE_MAX,
} from "@/lib/countries/uk/confidence/confidenceGauge";

describe("applyConfidenceEvent", () => {
  it("passing the annual Budget restores confidence", () => {
    expect(applyConfidenceEvent(50, { kind: "budgetPass" })).toBe(60);
  });
  it("budget defeat is the biggest single hit", () => {
    const budget =
      CONFIDENCE_START - applyConfidenceEvent(CONFIDENCE_START, { kind: "budgetDefeat" });
    const keyVote =
      CONFIDENCE_START - applyConfidenceEvent(CONFIDENCE_START, { kind: "lostKeyVote" });
    const vonc = CONFIDENCE_START - applyConfidenceEvent(CONFIDENCE_START, { kind: "lostVonc" });
    expect(budget).toBeGreaterThan(vonc);
    expect(vonc).toBeGreaterThan(keyVote);
    expect(budget).toBe(CONFIDENCE_HITS.budgetDefeat);
  });

  it("great-office departures hit harder", () => {
    const junior =
      CONFIDENCE_START - applyConfidenceEvent(CONFIDENCE_START, { kind: "ministerResigned" });
    const great =
      CONFIDENCE_START -
      applyConfidenceEvent(CONFIDENCE_START, { kind: "ministerResigned", greatOffice: true });
    expect(great).toBe(junior * GREAT_OFFICE_MULTIPLIER);
  });

  it("resignations sum toward collapse and clamp at the floor", () => {
    let g = CONFIDENCE_START;
    for (let i = 0; i < 20; i++) g = applyConfidenceEvent(g, { kind: "ministerResigned" });
    expect(g).toBe(CONFIDENCE_MIN);
    expect(isDissolutionTriggered(g)).toBe(true);
  });

  it("never exceeds the ceiling or floor", () => {
    expect(applyConfidenceEvent(CONFIDENCE_MAX, { kind: "lostKeyVote" })).toBeLessThan(
      CONFIDENCE_MAX
    );
    expect(applyConfidenceEvent(5, { kind: "budgetDefeat" })).toBe(CONFIDENCE_MIN);
  });
});

describe("tickConfidence", () => {
  it("high approval recovers the gauge", () => {
    expect(tickConfidence(50, { approval: 100 })).toBeGreaterThan(50);
  });
  it("low approval erodes it", () => {
    expect(tickConfidence(50, { approval: 0 })).toBeLessThan(50);
  });
  it("scales approval erosion through the head of government's honeymoon", () => {
    const takeOfficeScale = confidenceErosionScale(40, 40, 10);
    const midRampScale = confidenceErosionScale(40, 45, 10);
    const fullRampScale = confidenceErosionScale(40, 50, 10);

    expect(takeOfficeScale).toBe(0);
    expect(midRampScale).toBe(0.5);
    expect(fullRampScale).toBe(1);
    expect(tickConfidence(50, { approval: 0, erosionScale: takeOfficeScale })).toBe(50);
    expect(tickConfidence(50, { approval: 0, erosionScale: midRampScale })).toBe(49);
    expect(tickConfidence(50, { approval: 0, erosionScale: fullRampScale })).toBe(48);
  });
  it("keeps full erosion when the head's start turn is unknown", () => {
    expect(confidenceErosionScale(null, 45, 10)).toBe(1);
    expect(tickConfidence(50, { approval: 0 })).toBe(48);
  });
  it("scales only approval erosion, not recovery or broken-promise bleed", () => {
    expect(tickConfidence(50, { approval: 100, erosionScale: 0 })).toBe(55);
    expect(tickConfidence(50, { approval: 0, erosionScale: 0, brokenPromiseMeter: 0 })).toBe(47);
  });
  it("pivot approval is neutral (no drift)", () => {
    expect(tickConfidence(50, { approval: 50 })).toBe(50);
  });
  it("a fired-minister hit heals over time when approval is high", () => {
    let g = applyConfidenceEvent(CONFIDENCE_START, { kind: "ministerFired" });
    expect(g).toBeLessThan(CONFIDENCE_START);
    for (let i = 0; i < 5; i++) g = tickConfidence(g, { approval: 100 });
    expect(g).toBe(CONFIDENCE_MAX); // fully recovered
  });
  it("broken promises bleed the gauge continuously", () => {
    const withoutBreak = tickConfidence(50, { approval: 60 });
    const withBreak = tickConfidence(50, { approval: 60, brokenPromiseMeter: 0 }); // all broken
    expect(withBreak).toBeLessThan(withoutBreak);
  });
  it("a fully-kept manifesto adds no bleed", () => {
    expect(tickConfidence(50, { approval: 60, brokenPromiseMeter: 1 })).toBe(
      tickConfidence(50, { approval: 60 })
    );
  });
});

describe("isDissolutionTriggered", () => {
  it("only at the floor", () => {
    expect(isDissolutionTriggered(1)).toBe(false);
    expect(isDissolutionTriggered(0)).toBe(true);
  });
});
