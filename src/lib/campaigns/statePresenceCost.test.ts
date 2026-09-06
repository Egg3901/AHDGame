import { describe, expect, it } from "vitest";
import { formatStatePresenceCost, statePresenceNextCost } from "./statePresenceCost";
import { STATE_ORG_COST_FUNDS, stateOrgLevelCost } from "@/lib/electionEngine/constants";

describe("statePresenceNextCost", () => {
  it("is the base price for a state nobody has built in", () => {
    expect(statePresenceNextCost(0, 1)).toBe(STATE_ORG_COST_FUNDS);
  });

  it("escalates with the level, rather than staying at the base toll", () => {
    // The per-state primary page quoted the flat base constant, which is right
    // only at level 0. A level-5 state costs more than three times it.
    expect(statePresenceNextCost(5, 1)).toBeGreaterThan(STATE_ORG_COST_FUNDS * 3);
  });

  it("converts into the campaign's currency", () => {
    // stateOrgLevelCost is anchor-denominated and the treasury is not. The
    // Political Operations tab quoted the unconverted figure, which is a number
    // the build route never charges.
    expect(statePresenceNextCost(3, 2)).toBe(stateOrgLevelCost(3) * 2);
  });

  it("tracks the engine's own ladder rather than a copy of it", () => {
    for (const level of [0, 1, 4, 9, 17]) {
      expect(statePresenceNextCost(level, 1)).toBe(stateOrgLevelCost(level));
    }
  });
});

describe("formatStatePresenceCost", () => {
  it("writes the price one way", () => {
    expect(formatStatePresenceCost(250_000)).toBe("$250,000");
  });

  it("rounds rather than showing fractional units of currency", () => {
    expect(formatStatePresenceCost(820_312.4)).toBe("$820,312");
  });
});
