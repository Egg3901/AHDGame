import { describe, it, expect } from "vitest";
import { getStrategyAvailability } from "./strategyAvailability";
import { sectorNodeId } from "./nodes";
import type { TechCorpView } from "./selectors";

const baseCorp: TechCorpView = { type: "energy", unlockedTechNodeIds: [] };
const renewables = { id: "renewables", minDecade: "1999", requiresTechUnlock: true };
const standard = { id: "standard" };

describe("getStrategyAvailability", () => {
  it("is always available when the feature is off", () => {
    expect(getStrategyAvailability(baseCorp, renewables, 1980, false)).toEqual({ locked: false });
  });

  it("ungated strategies are always available", () => {
    expect(getStrategyAvailability(baseCorp, standard, 2020, true)).toEqual({ locked: false });
  });

  it("locks by era before the strategy's decade", () => {
    expect(getStrategyAvailability(baseCorp, renewables, 1985, true)).toMatchObject({
      locked: true,
      reason: "era",
    });
  });

  it("locks by tech when the era is reached but the corp hasn't unlocked it", () => {
    expect(getStrategyAvailability(baseCorp, renewables, 2005, true)).toMatchObject({
      locked: true,
      reason: "tech",
    });
  });

  it("unlocks once the corp owns the unlockStrategy node and the era is reached", () => {
    const unlocked: TechCorpView = {
      type: "energy",
      unlockedTechNodeIds: [sectorNodeId("energy", "1999", 3)], // Renewables R&D
    };
    expect(getStrategyAvailability(unlocked, renewables, 2005, true)).toEqual({ locked: false });
  });
});
