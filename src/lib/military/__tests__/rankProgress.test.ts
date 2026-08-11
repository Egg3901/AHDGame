import { describe, it, expect } from "vitest";
import { rankProgress, levelGeneral, GENLVLXP, GENRANK, type General } from "../generals";

describe("rankProgress", () => {
  it("starts a fresh general at the bottom of the first rank", () => {
    const p = rankProgress(1, 0);
    expect(p.rank).toBe("Brigadier");
    expect(p.nextRank).toBe("Major General");
    expect(p.xpIntoRank).toBe(0);
    expect(p.xpForRank).toBe(100);
    expect(p.pct).toBe(0);
  });

  it("measures progress across the current rank, not from zero", () => {
    // xp is cumulative, so a level-2 general on 175 xp is 75 into a 150-xp rank.
    const p = rankProgress(2, 175);
    expect(p.xpIntoRank).toBe(75);
    expect(p.xpForRank).toBe(150);
    expect(p.pct).toBeCloseTo(0.5, 5);
  });

  it("reports the ceiling honestly at Field Marshal", () => {
    const p = rankProgress(5, 9999);
    expect(p.rank).toBe("Field Marshal");
    expect(p.nextRank).toBeNull();
    expect(p.xpForRank).toBeNull();
    expect(p.pct).toBe(1);
  });

  it("agrees with levelGeneral about where each threshold falls", () => {
    // The display must not claim a promotion the engine has not granted.
    for (let lvl = 1; lvl < 5; lvl++) {
      const atThreshold = GENLVLXP[lvl];
      const base = { level: lvl, xp: atThreshold - 1, pts: 0 } as unknown as General;
      const g = levelGeneral(base, 1);
      expect(g.level).toBe(lvl + 1);
      expect(rankProgress(lvl, atThreshold - 1).pct).toBeCloseTo(
        (atThreshold - 1 - GENLVLXP[lvl - 1]) / (atThreshold - GENLVLXP[lvl - 1]),
        5
      );
    }
  });

  it("clamps a level outside the ladder rather than reading off the end", () => {
    expect(rankProgress(0, 0).rank).toBe(GENRANK[0]);
    expect(rankProgress(99, 0).nextRank).toBeNull();
  });
});
