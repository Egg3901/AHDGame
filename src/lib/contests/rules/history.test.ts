import { describe, expect, it } from "vitest";
import {
  contestAchievementSlugs,
  contestAchievementMilestones,
  type ContestPlacing,
} from "./history";
const win = (roundNumber: number, extra: Partial<ContestPlacing> = {}): ContestPlacing => ({
  kind: "influence_gain",
  iterationKey: "Beta:2",
  rank: 1,
  roundNumber,
  ...extra,
});
describe("contest achievements", () => {
  it("distinguishes an awarded podium from a win", () => {
    expect(contestAchievementSlugs([])).toEqual([]);
    expect(contestAchievementSlugs([win(1, { rank: 3 })])).toEqual(["contest_podium"]);
    expect(contestAchievementSlugs([win(1)])).toContain("contest_first_win");
  });
  it("requires consecutive rounds of the same kind and iteration for a streak", () => {
    expect(contestAchievementSlugs([win(1), win(2), win(3)])).toContain("contest_winning_streak");
    for (const entries of [
      [win(1), win(2), win(4)],
      [win(1), win(2), win(3, { iterationKey: "Beta:3" })],
      [win(1), win(2), win(3, { kind: "wealth_growth" })],
      [win(1), win(2), win(3, { iterationKey: undefined })],
    ])
      expect(contestAchievementSlugs(entries)).not.toContain("contest_winning_streak");
  });
  it("awards repeat, diverse and cross-iteration wins independently", () => {
    const slugs = contestAchievementSlugs([
      win(1),
      win(2, { kind: "wealth_growth" }),
      win(3, { kind: "party_growth", iterationKey: "Beta:3" }),
    ]);
    expect(slugs).toContain("contest_repeat_winner");
    expect(slugs).toContain("contest_versatile_winner");
    expect(slugs).toContain("contest_cross_iteration");
    expect(slugs).not.toContain("contest_winning_streak");
  });
});

describe("contest achievement provenance", () => {
  it("uses the first qualifying character for each achievement, across character changes", () => {
    const milestones = contestAchievementMilestones([
      { ...win(1, { rank: 3 }), characterId: "first-podium" },
      { ...win(2), characterId: "first-winner" },
      { ...win(3, { kind: "wealth_growth" }), characterId: "second-winner" },
      { ...win(4, { kind: "party_growth", iterationKey: "Beta:3" }), characterId: "third-winner" },
    ]);
    expect(milestones.find((m) => m.slug === "contest_podium")?.characterId).toBe("first-podium");
    expect(milestones.find((m) => m.slug === "contest_first_win")?.characterId).toBe(
      "first-winner"
    );
    expect(milestones.find((m) => m.slug === "contest_repeat_winner")?.characterId).toBe(
      "third-winner"
    );
  });
});
