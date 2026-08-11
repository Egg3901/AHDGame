import { describe, expect, it } from "vitest";
import { pickTier } from "@/lib/events/substrate/tiers";
import { lotteryWinHandler } from "./lotteryWin";

describe("lotteryWin handler", () => {
  it("registers four options with full outcome coverage", () => {
    expect(lotteryWinHandler.options).toHaveLength(4);
    for (const option of lotteryWinHandler.options) {
      expect(option.outcomeTable).toHaveLength(3);
      expect(pickTier(option.outcomeTable, 1)).toBeDefined();
      expect(pickTier(option.outcomeTable, 50)).toBeDefined();
      expect(pickTier(option.outcomeTable, 100)).toBeDefined();
    }
  });

  it("defaults to ignore on timeout", () => {
    expect(lotteryWinHandler.defaultOptionId).toBe("ignore");
  });
});
