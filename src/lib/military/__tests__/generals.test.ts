import { describe, it, expect } from "vitest";
import {
  GENRANK,
  GENLVLXP,
  rank,
  levelGeneral,
  POINTS_PER_PROMOTION,
  POST_FM_POINT_CAP,
  TENURE_POINT_TURNS,
  TENURE_POINT_CAP,
  accrueTenurePoints,
} from "../generals";

describe("generals data", () => {
  it("defines the rank ladder and level thresholds", () => {
    expect(GENRANK).toHaveLength(5);
    expect(GENLVLXP).toEqual([0, 100, 250, 460, 740]);
  });
});

describe("rank", () => {
  it("maps level to rank title", () => {
    expect(rank(1)).toBe("Brigadier");
    expect(rank(5)).toBe("Field Marshal");
    expect(rank(99)).toBe("Field Marshal");
  });
});

describe("levelGeneral", () => {
  it("levels up when xp crosses the threshold and grants a promotion's points", () => {
    const ng = levelGeneral({ level: 1, xp: 0, pts: 0 }, 100); // reaches level 2 (GENLVLXP[1]=100)
    expect(ng.level).toBe(2);
    expect(ng.pts).toBe(POINTS_PER_PROMOTION);
  });

  // Level caps at 5 (Field Marshal), so a career yields exactly four promotions, and
  // beyond that the post-FM track keeps a maxed general earning — but only up to
  // POST_FM_POINT_CAP. Uncapped, a late-game commander eventually holds every node in
  // the tree, which is exactly what playtest feedback asked us to prevent.
  it("grants promotions then capped post-Field-Marshal points", () => {
    const ng = levelGeneral({ level: 1, xp: 0, pts: 0 }, 10_000);
    expect(ng.level).toBe(5);
    expect(ng.pts).toBe(4 * POINTS_PER_PROMOTION + POST_FM_POINT_CAP);
  });

  it("preserves extra profile fields (gtraits) when leveling", () => {
    const ng = levelGeneral({ level: 1, xp: 0, pts: 0, gtraits: ["ar1"] }, 100);
    expect(ng.gtraits).toEqual(["ar1"]);
  });
});

// Battles were the ONLY source of skill points, which left a peacetime officer
// permanently undeveloped — "how else do you get skill points? seems slow".
// Commissioned service now accrues a point a day on its own, up to a career ceiling.
describe("accrueTenurePoints", () => {
  it("grants nothing before a full interval has elapsed", () => {
    const g = { level: 1, xp: 0, pts: 0, lastTenurePointTurn: 100 };
    expect(accrueTenurePoints(g, 100 + TENURE_POINT_TURNS - 1)).toBeNull();
  });

  it("grants one point after a full interval of service", () => {
    const g = { level: 1, xp: 0, pts: 0, lastTenurePointTurn: 100 };
    const next = accrueTenurePoints(g, 100 + TENURE_POINT_TURNS)!;
    expect(next.pts).toBe(1);
    expect(next.lastTenurePointTurn).toBe(100 + TENURE_POINT_TURNS);
  });

  // A skipped tick — a cron stall, a paused world — must not silently swallow the
  // points that were owed, nor pay them twice on the catch-up tick.
  it("pays every whole interval owed and advances the marker by exactly those", () => {
    const g = { level: 1, xp: 0, pts: 2, lastTenurePointTurn: 0 };
    const at = TENURE_POINT_TURNS * 3 + 5;
    const next = accrueTenurePoints(g, at)!;
    expect(next.pts).toBe(5);
    expect(next.lastTenurePointTurn).toBe(TENURE_POINT_TURNS * 3);
    // Immediately re-running the accrual pays nothing more.
    expect(accrueTenurePoints(next, at)).toBeNull();
  });

  // A general with no marker yet (every profile predating this) starts accruing
  // from now rather than being back-paid for the whole war.
  it("starts the clock instead of back-paying a general with no marker", () => {
    const next = accrueTenurePoints({ level: 1, xp: 0, pts: 0 }, 500)!;
    expect(next.pts).toBe(0);
    expect(next.lastTenurePointTurn).toBe(500);
  });

  it("never moves the marker backwards on a clock that went the wrong way", () => {
    const g = { level: 1, xp: 0, pts: 0, lastTenurePointTurn: 500 };
    expect(accrueTenurePoints(g, 100)).toBeNull();
  });

  // Without a ceiling a long season makes waiting strictly better than campaigning:
  // at this rate an uncapped century of service finishes the whole tree without the
  // general ever fighting.
  describe("lifetime cap", () => {
    it("stops paying once the career ceiling is reached", () => {
      const g = {
        level: 1,
        xp: 0,
        pts: 3,
        lastTenurePointTurn: 0,
        tenurePointsEarned: TENURE_POINT_CAP,
      };
      expect(accrueTenurePoints(g, 100_000)).toBeNull();
    });

    it("pays only the balance remaining under the ceiling", () => {
      const g = {
        level: 1,
        xp: 0,
        pts: 0,
        lastTenurePointTurn: 0,
        tenurePointsEarned: TENURE_POINT_CAP - 3,
      };
      const next = accrueTenurePoints(g, TENURE_POINT_TURNS * 100)!;
      expect(next.pts).toBe(3);
      expect(next.tenurePointsEarned).toBe(TENURE_POINT_CAP);
      // Marker advanced by the intervals actually PAID, not by the elapsed span —
      // a capped general must not bank credit that pays out in a lump later.
      expect(next.lastTenurePointTurn).toBe(TENURE_POINT_TURNS * 3);
    });

    it("counts tenure separately from points already spent on traits", () => {
      const g = { level: 1, xp: 0, pts: 0, lastTenurePointTurn: 0, tenurePointsEarned: 10 };
      const next = accrueTenurePoints(g, TENURE_POINT_TURNS * 2)!;
      expect(next.pts).toBe(2);
      expect(next.tenurePointsEarned).toBe(12);
    });

    it("reaches the ceiling after TENURE_POINT_CAP intervals of service", () => {
      let g: ReturnType<typeof accrueTenurePoints> = {
        level: 1,
        xp: 0,
        pts: 0,
        lastTenurePointTurn: 0,
        tenurePointsEarned: 0,
      };
      g = accrueTenurePoints(g!, TENURE_POINT_TURNS * TENURE_POINT_CAP);
      expect(g!.pts).toBe(TENURE_POINT_CAP);
      expect(accrueTenurePoints(g!, TENURE_POINT_TURNS * 10_000)).toBeNull();
    });
  });
});
