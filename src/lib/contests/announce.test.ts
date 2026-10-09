import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import type { ContestStanding } from "@/lib/db/types/contestRound";
import {
  contestResultNotifications,
  contestResultsPost,
  type SettledRoundResult,
} from "./announce";

const entry = (id: string, name: string, score: number): ContestStanding => ({
  subjectId: id,
  subjectName: name,
  characterId: `char-${id}`,
  characterName: `Owner ${id}`,
  baseline: 0,
  current: score,
  score,
});

const corp: SettledRoundResult = {
  kind: "corp_growth_small",
  roundNumber: 4,
  standings: [
    entry("a", "Acme", 42.15),
    entry("b", "Bolt", 20),
    entry("c", "Crane", 5),
    entry("d", "Dune", 2),
    entry("e", "Echo", 0),
  ],
  winners: [
    { ...entry("a", "Acme", 42.15), rank: 1, prizeAnchor: 500_000 },
    { ...entry("b", "Bolt", 20), rank: 2, prizeAnchor: 300_000 },
    { ...entry("c", "Crane", 5), rank: 3, prizeAnchor: 200_000 },
  ],
};
const approval: SettledRoundResult = {
  kind: "approval_gain",
  roundNumber: 4,
  standings: [],
  winners: [],
};

describe("contestResultsPost", () => {
  it("lists every contest's places, scores and prizes", () => {
    const post = contestResultsPost([corp, approval]);
    expect(post).toContain("Small Business Growth, round 4");
    expect(post).toContain("1st: Acme (Owner a), +42.2%, wins ₳500,000");
    expect(post).toContain("3rd: Crane (Owner c), +5%, wins ₳200,000");
    expect(post).toContain("Government Approval, round 4\nNo entry finished ahead this week.");
  });
});

describe("contestResultNotifications", () => {
  it("notifies ranked entrants who did not place, skipping idle entries", () => {
    const userIds = new Map(
      ["a", "b", "c", "d", "e"].map((id) => [`char-${id}`, new ObjectId()] as const)
    );
    const notes = contestResultNotifications([corp], userIds);
    expect(notes).toHaveLength(1);
    expect(notes[0].userId).toBe(userIds.get("char-d"));
    expect(notes[0].message).toContain("Small Business Growth: #4 of 5 (+2%)");
  });
});
