import { describe, expect, it } from "vitest";
import {
  recruitmentCooldownRemainingTurns,
  recruitmentCooldownSet,
  recruitmentCooldownReadyFilter,
  recruitmentCooldownUntilIso,
  RECRUITMENT_COOLDOWN_TURNS,
} from "./recruitmentCooldown";
import { MS_PER_TURN } from "@/lib/constants/turnTime";

const realNow = new Date("2026-05-30T16:00:00Z").getTime();

describe("recruitmentCooldownRemainingTurns — turn-first", () => {
  it("returns remaining turns when within the window", () => {
    expect(
      recruitmentCooldownRemainingTurns({ nppRecruitmentCooldownUntilTurn: 124 }, 110, realNow)
    ).toBe(14);
  });
  it("returns 0 when at/past the end turn", () => {
    expect(
      recruitmentCooldownRemainingTurns({ nppRecruitmentCooldownUntilTurn: 124 }, 124, realNow)
    ).toBe(0);
    expect(
      recruitmentCooldownRemainingTurns({ nppRecruitmentCooldownUntilTurn: 124 }, 130, realNow)
    ).toBe(0);
  });
  it("turn field wins over the legacy Date", () => {
    const ancient = new Date(realNow - 999 * MS_PER_TURN);
    expect(
      recruitmentCooldownRemainingTurns(
        { nppRecruitmentCooldownUntilTurn: 124, nppRecruitmentCooldownUntil: ancient },
        110,
        realNow
      )
    ).toBe(14);
  });
});

describe("recruitmentCooldownRemainingTurns — Date fallback", () => {
  it("computes remaining turns from the Date when no turn field", () => {
    const until = new Date(realNow + 10 * MS_PER_TURN);
    expect(
      recruitmentCooldownRemainingTurns({ nppRecruitmentCooldownUntil: until }, 0, realNow)
    ).toBe(10);
  });
  it("returns 0 when the Date has passed", () => {
    const until = new Date(realNow - MS_PER_TURN);
    expect(
      recruitmentCooldownRemainingTurns({ nppRecruitmentCooldownUntil: until }, 0, realNow)
    ).toBe(0);
  });
  it("returns 0 for an empty doc or null", () => {
    expect(recruitmentCooldownRemainingTurns({}, 5, realNow)).toBe(0);
    expect(recruitmentCooldownRemainingTurns(null, 5, realNow)).toBe(0);
  });
});

describe("recruitmentCooldownSet", () => {
  it("writes both the end turn and the projected end Date", () => {
    const set = recruitmentCooldownSet(100, realNow);
    expect(set.nppRecruitmentCooldownUntilTurn).toBe(124);
    expect(set.nppRecruitmentCooldownUntil.getTime()).toBe(
      realNow + RECRUITMENT_COOLDOWN_TURNS * MS_PER_TURN
    );
  });
});

describe("recruitmentCooldownReadyFilter", () => {
  it("is turn-first with a Date fallback for legacy docs", () => {
    const gameNow = new Date(realNow);
    const filter = recruitmentCooldownReadyFilter(110, gameNow);
    expect(filter).toEqual({
      $or: [
        { nppRecruitmentCooldownUntilTurn: { $lte: 110 } },
        {
          nppRecruitmentCooldownUntilTurn: { $exists: false },
          $or: [
            { nppRecruitmentCooldownUntil: { $exists: false } },
            { nppRecruitmentCooldownUntil: { $lte: gameNow } },
          ],
        },
      ],
    });
  });
});

describe("recruitmentCooldownUntilIso", () => {
  it("projects from real time, or null when not on cooldown", () => {
    expect(recruitmentCooldownUntilIso(14, realNow)).toBe(
      new Date(realNow + 14 * MS_PER_TURN).toISOString()
    );
    expect(recruitmentCooldownUntilIso(0, realNow)).toBeNull();
  });
});
