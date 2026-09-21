import { describe, expect, it } from "vitest";
import {
  SURPRISE_CASE_SPAWN_PROBABILITY_PER_TURN,
  rollSurpriseCaseSpawn,
} from "./surpriseCaseSpawn";

describe("rollSurpriseCaseSpawn", () => {
  it("spawns when the draw is below the probability", () => {
    expect(rollSurpriseCaseSpawn(SURPRISE_CASE_SPAWN_PROBABILITY_PER_TURN - 0.0001)).toBe(true);
    expect(rollSurpriseCaseSpawn(0)).toBe(true);
  });

  it("does not spawn when the draw is at or above the probability", () => {
    expect(rollSurpriseCaseSpawn(SURPRISE_CASE_SPAWN_PROBABILITY_PER_TURN)).toBe(false);
    expect(rollSurpriseCaseSpawn(SURPRISE_CASE_SPAWN_PROBABILITY_PER_TURN + 0.0001)).toBe(false);
    expect(rollSurpriseCaseSpawn(0.5)).toBe(false);
    expect(rollSurpriseCaseSpawn(0.999)).toBe(false);
  });

  it("remains a low per-turn probability", () => {
    expect(SURPRISE_CASE_SPAWN_PROBABILITY_PER_TURN).toBeGreaterThan(0);
    expect(SURPRISE_CASE_SPAWN_PROBABILITY_PER_TURN).toBeLessThan(0.01);
  });

  it("accepts an explicit probability override", () => {
    expect(rollSurpriseCaseSpawn(0.3, 0.5)).toBe(true);
    expect(rollSurpriseCaseSpawn(0.6, 0.5)).toBe(false);
  });

  it("is deterministic for the same inputs", () => {
    const results = Array.from({ length: 10 }, () => rollSurpriseCaseSpawn(0.001));
    expect(new Set(results).size).toBe(1);
  });
});
