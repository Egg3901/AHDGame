import { describe, expect, it } from "vitest";
import {
  DIVERGENT_TENURE_FLOOR_TURNS,
  DIVERGENT_TENURE_HAZARD_PER_TURN,
  divergentDeathChance,
  formatDivergentDeathChance,
  rollDivergentDeparture,
} from "./tenure";

describe("rollDivergentDeparture", () => {
  it("never departs before the floor, regardless of the random draw", () => {
    const seatedAtTurn = 100;
    for (const draw of [0, 0.0001, 0.5, 0.999]) {
      expect(rollDivergentDeparture(seatedAtTurn, seatedAtTurn, draw)).toBe(false);
      expect(
        rollDivergentDeparture(seatedAtTurn, seatedAtTurn + DIVERGENT_TENURE_FLOOR_TURNS - 1, draw)
      ).toBe(false);
    }
  });

  it("rolls the flat hazard once the floor has passed", () => {
    const seatedAtTurn = 100;
    const floorTurn = seatedAtTurn + DIVERGENT_TENURE_FLOOR_TURNS;
    // A draw just under the hazard departs; a draw just over does not.
    expect(
      rollDivergentDeparture(seatedAtTurn, floorTurn, DIVERGENT_TENURE_HAZARD_PER_TURN - 0.001)
    ).toBe(true);
    expect(
      rollDivergentDeparture(seatedAtTurn, floorTurn, DIVERGENT_TENURE_HAZARD_PER_TURN + 0.001)
    ).toBe(false);
  });

  it("is uncapped on the high end — stays a flat hazard arbitrarily far past the floor", () => {
    const seatedAtTurn = 0;
    const farFuture = seatedAtTurn + DIVERGENT_TENURE_FLOOR_TURNS + 100_000;
    expect(
      rollDivergentDeparture(seatedAtTurn, farFuture, DIVERGENT_TENURE_HAZARD_PER_TURN - 0.001)
    ).toBe(true);
  });

  it("accepts an explicit hazardStartsTurn override independent of seatedAtTurn + floor", () => {
    const result = rollDivergentDeparture(100, 150, 0.001, 150, 0.5);
    expect(result).toBe(true);
  });

  it("is deterministic for the same inputs", () => {
    const results = Array.from({ length: 10 }, () => rollDivergentDeparture(0, 1000, 0.001));
    expect(new Set(results).size).toBe(1);
  });
});

describe("divergentDeathChance", () => {
  const hazardStartsTurn = 100 + DIVERGENT_TENURE_FLOOR_TURNS;

  it("returns null when the seat has no hazard stamp", () => {
    expect(divergentDeathChance(200, null)).toBeNull();
    expect(divergentDeathChance(200, undefined)).toBeNull();
  });

  it("is 0% with remaining turns while the floor still holds", () => {
    expect(divergentDeathChance(hazardStartsTurn - 5, hazardStartsTurn)).toEqual({
      chancePerTurn: 0,
      turnsUntilActive: 5,
    });
  });

  it("is the live hazard once the floor has passed", () => {
    expect(divergentDeathChance(hazardStartsTurn, hazardStartsTurn)).toEqual({
      chancePerTurn: DIVERGENT_TENURE_HAZARD_PER_TURN,
      turnsUntilActive: 0,
    });
    expect(divergentDeathChance(hazardStartsTurn + 80, hazardStartsTurn)).toEqual({
      chancePerTurn: DIVERGENT_TENURE_HAZARD_PER_TURN,
      turnsUntilActive: 0,
    });
  });
});

describe("formatDivergentDeathChance", () => {
  it("names the live per-turn death chance", () => {
    expect(
      formatDivergentDeathChance({
        chancePerTurn: DIVERGENT_TENURE_HAZARD_PER_TURN,
        turnsUntilActive: 0,
      })
    ).toBe("1.5% death chance per turn");
  });

  it("says when the hazard starts during the floor", () => {
    expect(formatDivergentDeathChance({ chancePerTurn: 0, turnsUntilActive: 1 }, "compact")).toBe(
      "0% death chance (1 turn until 1.5%)"
    );
    expect(formatDivergentDeathChance({ chancePerTurn: 0, turnsUntilActive: 42 }, "full")).toBe(
      "No death chance yet. 1.5% per turn starts in 42 turns."
    );
  });
});
