import { describe, expect, it } from "vitest";
import { HISTORICAL_CRISIS_SHOWCASE } from "./historicalCrisisShowcase";

describe("HISTORICAL_CRISIS_SHOWCASE", () => {
  it("is stable, chronological, and spans the Cold War", () => {
    expect(HISTORICAL_CRISIS_SHOWCASE).toHaveLength(14);
    expect(new Set(HISTORICAL_CRISIS_SHOWCASE.map((entry) => entry.id)).size).toBe(
      HISTORICAL_CRISIS_SHOWCASE.length
    );
    expect(HISTORICAL_CRISIS_SHOWCASE.map((entry) => entry.year)).toEqual(
      [...HISTORICAL_CRISIS_SHOWCASE].map((entry) => entry.year).sort((a, b) => a - b)
    );
    expect(HISTORICAL_CRISIS_SHOWCASE.at(0)?.year).toBe(1953);
    expect(HISTORICAL_CRISIS_SHOWCASE.at(-1)?.year).toBe(1991);
  });

  it("keeps every target and card suitable for the globe", () => {
    for (const entry of HISTORICAL_CRISIS_SHOWCASE) {
      expect(entry.lonLat[0]).toBeGreaterThanOrEqual(-180);
      expect(entry.lonLat[0]).toBeLessThanOrEqual(180);
      expect(entry.lonLat[1]).toBeGreaterThanOrEqual(-90);
      expect(entry.lonLat[1]).toBeLessThanOrEqual(90);
      expect(entry.title.length).toBeGreaterThan(3);
      expect(entry.description.length).toBeGreaterThan(40);
    }
  });
});
