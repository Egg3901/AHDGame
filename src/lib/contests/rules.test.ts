import { describe, expect, it } from "vitest";
import type { ContestStanding } from "@/lib/db/types/contestRound";
import {
  approvalEntryEligible,
  contestPrizeAnchor,
  CONTEST_PRIZE_MODERN,
  corpGrowthScore,
  gainScore,
  pickWinner,
  rankReferralWinners,
  rankStandings,
  referralGrantDecision,
  roundBelongsToEarlierWorld,
  roundIsDue,
  splitCorpTiers,
  type CorpOpening,
} from "./rules";

function opening(id: string, capAnchor: number): CorpOpening {
  return { corporationId: id, characterId: `c-${id}`, capLocal: capAnchor * 2, capAnchor };
}

function standing(subjectId: string, score: number): ContestStanding {
  return {
    subjectId,
    subjectName: subjectId,
    characterId: `c-${subjectId}`,
    characterName: `C ${subjectId}`,
    baseline: 100,
    current: 100 + score,
    score,
  };
}

describe("splitCorpTiers", () => {
  it("splits at the median so the giants race each other", () => {
    const split = splitCorpTiers(
      [opening("a", 1_000), opening("b", 5_000), opening("c", 2_000), opening("d", 90_000)],
      500
    );
    expect(split.boundaryAnchor).toBe(5_000);
    expect(split.small.map((o) => o.corporationId)).toEqual(["a", "c"]);
    expect(split.large.map((o) => o.corporationId)).toEqual(["b", "d"]);
  });

  it("drops shells below the floor and corporations with no value", () => {
    const split = splitCorpTiers(
      [opening("tiny", 10), opening("ok", 1_000), { ...opening("zero", 2_000), capLocal: 0 }],
      500
    );
    expect([...split.small, ...split.large].map((o) => o.corporationId)).toEqual(["ok"]);
  });

  it("returns empty tiers when nobody qualifies", () => {
    expect(splitCorpTiers([], 500)).toEqual({ boundaryAnchor: 0, small: [], large: [] });
  });
});

describe("corpGrowthScore", () => {
  it("is percent growth", () => {
    expect(corpGrowthScore(1_000, 1_250, 0)).toBe(25);
  });

  it("takes injected capital off the closing value", () => {
    // Grew 1,000 to 1,500 but 400 of that was the owner's cash.
    expect(corpGrowthScore(1_000, 1_500, 400)).toBeCloseTo(10);
  });

  it("adds back capital moved out to a subsidiary", () => {
    expect(corpGrowthScore(1_000, 900, -200)).toBeCloseTo(10);
  });

  it("has no score without a positive baseline", () => {
    expect(corpGrowthScore(0, 500, 0)).toBeNull();
    expect(corpGrowthScore(1_000, Number.NaN, 0)).toBeNull();
  });
});

describe("gainScore", () => {
  it("is the absolute change", () => {
    expect(gainScore(40, 46.5)).toBe(6.5);
    expect(gainScore(50, 45)).toBe(-5);
  });
});

describe("approvalEntryEligible", () => {
  it("needs the same head of government as at the opening", () => {
    expect(approvalEntryEligible("x", "x")).toBe(true);
    expect(approvalEntryEligible("x", "y")).toBe(false);
    expect(approvalEntryEligible("x", null)).toBe(false);
  });
});

describe("rankStandings and pickWinner", () => {
  it("orders by score, ties by subject id", () => {
    const ranked = rankStandings([standing("b", 5), standing("a", 5), standing("c", 9)]);
    expect(ranked.map((s) => s.subjectId)).toEqual(["c", "a", "b"]);
    expect(pickWinner(ranked)?.subjectId).toBe("c");
  });

  it("pays nobody when the leader did not grow", () => {
    expect(pickWinner(rankStandings([standing("a", 0), standing("b", -3)]))).toBeNull();
    expect(pickWinner([])).toBeNull();
  });
});

describe("round timing", () => {
  it("is due once the end time passes", () => {
    expect(roundIsDue(1_000, 999)).toBe(false);
    expect(roundIsDue(1_000, 1_000)).toBe(true);
  });

  it("treats a round opened at a later turn as a previous world's round", () => {
    expect(roundBelongsToEarlierWorld(400, 12)).toBe(true);
    expect(roundBelongsToEarlierWorld(12, 40)).toBe(false);
  });
});

describe("contestPrizeAnchor", () => {
  it("is the modern prize in the modern era and smaller in earlier eras", () => {
    expect(contestPrizeAnchor()).toBe(CONTEST_PRIZE_MODERN);
    const early = contestPrizeAnchor("1953-default");
    expect(early).toBeGreaterThan(0);
    expect(early).toBeLessThan(CONTEST_PRIZE_MODERN);
  });
});

describe("rankReferralWinners", () => {
  it("takes the top three unbanned referrers by count then username", () => {
    const winners = rankReferralWinners([
      { userId: "1", username: "zed", count: 4, banned: false },
      { userId: "2", username: "amy", count: 4, banned: false },
      { userId: "3", username: "bad", count: 9, banned: true },
      { userId: "4", username: "bob", count: 2, banned: false },
      { userId: "5", username: "cat", count: 1, banned: false },
      { userId: "6", username: "dan", count: 0, banned: false },
    ]);
    expect(winners.map((w) => w.username)).toEqual(["amy", "zed", "bob"]);
  });
});

describe("referralGrantDecision", () => {
  const now = 1_000;
  const until = 5_000;

  it("grants to a non-supporter or a lapsed one", () => {
    expect(
      referralGrantDecision({ tier: null, expiresAtMs: null, provider: null }, now, until)
    ).toBe("grant");
    expect(
      referralGrantDecision(
        { tier: "supporter", expiresAtMs: 500, provider: "patreon" },
        now,
        until
      )
    ).toBe("grant");
  });

  it("never touches a paying supporter", () => {
    expect(
      referralGrantDecision(
        { tier: "supporter", expiresAtMs: null, provider: "patreon" },
        now,
        until
      )
    ).toBe("already_supporter");
    expect(
      referralGrantDecision(
        { tier: "supporter-plus", expiresAtMs: 2_000, provider: "stripe" },
        now,
        until
      )
    ).toBe("already_supporter");
  });

  it("extends an earlier contest award that ends sooner", () => {
    expect(
      referralGrantDecision(
        { tier: "supporter", expiresAtMs: 2_000, provider: "contest" },
        now,
        until
      )
    ).toBe("extend");
    expect(
      referralGrantDecision(
        { tier: "supporter", expiresAtMs: 9_000, provider: "contest" },
        now,
        until
      )
    ).toBe("already_supporter");
  });
});
