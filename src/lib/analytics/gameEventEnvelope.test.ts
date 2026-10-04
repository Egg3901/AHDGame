import { describe, expect, it } from "vitest";
import { gameEventEnvelope, gameIterationId } from "./gameEventEnvelope";

describe("shared game event envelope", () => {
  it("uses a stable iteration key and the supplied turn number", () => {
    expect(gameIterationId({ type: "Alpha", number: 3 })).toBe("alpha-3");
    expect(gameEventEnvelope({ type: "Beta", number: 2 }, 48)).toEqual({
      iteration_id: "beta-2",
      turn_number: 48,
    });
  });

  it("uses safe fallbacks for missing or invalid game state", () => {
    expect(gameIterationId({ type: "unknown" as never, number: 0 })).toBe("unknown");
    expect(gameIterationId({ type: undefined as never, number: 1 })).toBe("unknown");
    expect(gameEventEnvelope(null, Number.NaN)).toEqual({
      iteration_id: "unknown",
      turn_number: 0,
    });
  });
});
