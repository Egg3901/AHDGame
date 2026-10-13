import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { actingLane, nppActionLane, nppActsThisTurn, NPP_ACTION_INTERVAL } from "./actionCadence";

describe("NPP engine 6.0 action cadence", () => {
  it("assigns each NPP a stable lane inside the interval", () => {
    const id = new ObjectId();
    const lane = nppActionLane(id);
    expect(lane).toBeGreaterThanOrEqual(0);
    expect(lane).toBeLessThan(NPP_ACTION_INTERVAL);
    expect(nppActionLane(id.toString())).toBe(lane);
  });

  it("acts each NPP on exactly one turn of every interval", () => {
    for (let i = 0; i < 50; i++) {
      const id = new ObjectId();
      const turns = [100, 101, 102, 103].filter((turn) => nppActsThisTurn(id, turn));
      expect(turns).toHaveLength(1);
    }
  });

  it("spreads a population of ids across all lanes", () => {
    const counts = [0, 0, 0, 0];
    for (let i = 0; i < 2_000; i++) counts[nppActionLane(new ObjectId())]++;
    for (const count of counts) expect(count).toBeGreaterThan(350);
  });

  it("gives a non-ObjectId id a lane too", () => {
    expect(nppActionLane("fixture-npp")).toBe(nppActionLane("fixture-npp"));
    expect(nppActionLane("fixture-npp")).toBeLessThan(NPP_ACTION_INTERVAL);
  });

  it("maps turns onto lanes, including negative turns", () => {
    expect(actingLane(8)).toBe(0);
    expect(actingLane(11)).toBe(3);
    expect(actingLane(-1)).toBe(3);
  });
});
