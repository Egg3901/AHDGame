import { describe, expect, it } from "vitest";
import { singleplayerNppTuning } from "./singleplayerDifficulty/rules";

describe("singleplayer NPP difficulty", () => {
  it("keeps normal at live parity", () => {
    expect(singleplayerNppTuning("normal")).toEqual({
      actionPointsPerTurn: 2,
      actionPointCap: 100,
      fundMultiplier: 1,
    });
  });

  it("changes both planning cadence and resource budget", () => {
    expect(singleplayerNppTuning("easy").actionPointsPerTurn).toBeLessThan(
      singleplayerNppTuning("hard").actionPointsPerTurn
    );
    expect(singleplayerNppTuning("easy").fundMultiplier).toBeLessThan(
      singleplayerNppTuning("hard").fundMultiplier
    );
  });
});
