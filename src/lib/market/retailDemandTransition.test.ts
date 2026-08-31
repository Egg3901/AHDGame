import { describe, expect, it } from "vitest";
import {
  RETAIL_DEMAND_TRANSITION_DEFAULT_TURNS,
  retailCapacityExpansionPaused,
  retailDemandTransitionTurnsRemaining,
  retailLegacyDemandFactor,
} from "./retailDemandTransition";

describe("retail demand transition", () => {
  it("preserves legacy behavior until an operator explicitly starts it", () => {
    expect(retailLegacyDemandFactor(undefined, 500)).toBe(1);
    expect(retailCapacityExpansionPaused(undefined, 500)).toBe(false);
  });

  it("fades the legacy self-loop linearly to exactly zero", () => {
    const config = { retailDemandTransitionStartTurn: 500, retailDemandTransitionTurns: 200 };
    expect(retailLegacyDemandFactor(config, 499)).toBe(1);
    expect(retailLegacyDemandFactor(config, 500)).toBe(1);
    expect(retailLegacyDemandFactor(config, 550)).toBe(0.75);
    expect(retailLegacyDemandFactor(config, 600)).toBe(0.5);
    expect(retailLegacyDemandFactor(config, 700)).toBe(0);
    expect(retailLegacyDemandFactor(config, 900)).toBe(0);
  });

  it("uses the player-safe default window and pauses expansion only during it", () => {
    const config = { retailDemandTransitionStartTurn: 500 };
    expect(retailLegacyDemandFactor(config, 596)).toBe(0.5);
    expect(retailCapacityExpansionPaused(config, 500)).toBe(true);
    expect(retailCapacityExpansionPaused(config, 691)).toBe(true);
    expect(retailDemandTransitionTurnsRemaining(config, 691)).toBe(1);
    expect(
      retailCapacityExpansionPaused(config, 500 + RETAIL_DEMAND_TRANSITION_DEFAULT_TURNS)
    ).toBe(false);
    expect(retailDemandTransitionTurnsRemaining(config, 692)).toBe(0);
  });
});
