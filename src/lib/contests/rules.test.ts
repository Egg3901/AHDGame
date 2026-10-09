import { describe, expect, it } from "vitest";
import type { ContestStanding } from "@/lib/db/types/contestRound";
import {
  approvalEntryEligible,
  altPairKey,
  contestPrizeAnchor,
  CONTEST_PRIZES_MODERN,
  corpGrowthScore,
  countWeeklyReferrals,
  iterationChanged,
  gainScore,
  pickPlacings,
  placePrizeAnchor,
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

describe("rankStandings and pickPlacings", () => {
  it("orders by score, ties by subject id, and places the top three", () => {
    const ranked = rankStandings([
      standing("b", 5),
      standing("a", 5),
      standing("c", 9),
      standing("d", 2),
    ]);
    expect(ranked.map((s) => s.subjectId)).toEqual(["c", "a", "b", "d"]);
    expect(pickPlacings("influence_gain", ranked).map((s) => s.subjectId)).toEqual(["c", "a", "b"]);
  });

  it("places only the leader in government approval", () => {
    const ranked = rankStandings([standing("a", 4), standing("b", 3)]);
    expect(pickPlacings("approval_gain", ranked).map((s) => s.subjectId)).toEqual(["a"]);
  });

  it("places only positive scores", () => {
    expect(
      pickPlacings("influence_gain", rankStandings([standing("a", 3), standing("b", 0)]))
    ).toEqual([expect.objectContaining({ subjectId: "a" })]);
    expect(
      pickPlacings("influence_gain", rankStandings([standing("a", 0), standing("b", -3)]))
    ).toEqual([]);
    expect(pickPlacings("influence_gain", [])).toEqual([]);
  });
});

describe("placePrizeAnchor", () => {
  it("splits the prize 50/30/20", () => {
    const prize = contestPrizeAnchor("corp_growth_small");
    expect(placePrizeAnchor("corp_growth_small", 1)).toBe(Math.round(prize * 0.5));
    expect(placePrizeAnchor("corp_growth_small", 2)).toBe(Math.round(prize * 0.3));
    expect(placePrizeAnchor("corp_growth_small", 3)).toBe(Math.round(prize * 0.2));
    expect(placePrizeAnchor("corp_growth_small", 4)).toBe(0);
  });

  it("pays government approval winner takes all", () => {
    expect(placePrizeAnchor("approval_gain", 1)).toBe(contestPrizeAnchor("approval_gain"));
    expect(placePrizeAnchor("approval_gain", 2)).toBe(0);
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
  it("pays 7.5M for the growth contests and 10M for weekly referrals at modern scale", () => {
    expect(contestPrizeAnchor("influence_gain")).toBe(7_500_000);
    expect(contestPrizeAnchor("corp_growth_small")).toBe(7_500_000);
    expect(contestPrizeAnchor("referrals_weekly")).toBe(10_000_000);
  });

  it("scales to the world's era", () => {
    const early = contestPrizeAnchor("referrals_weekly", "1953-default");
    expect(early).toBeGreaterThan(0);
    expect(early).toBeLessThan(CONTEST_PRIZES_MODERN.referrals_weekly);
    // 1991 money is modern money.
    expect(contestPrizeAnchor("referrals_weekly", "1991-default")).toBe(10_000_000);
  });
});

describe("countWeeklyReferrals", () => {
  const players = new Set(["alice", "bob"]);

  it("counts each new player once for an eligible referrer", () => {
    const counts = countWeeklyReferrals(
      [
        { refereeUserId: "n1", referrerUserId: "alice", refereeBanned: false },
        { refereeUserId: "n2", referrerUserId: "alice", refereeBanned: false },
        { refereeUserId: "n2", referrerUserId: "alice", refereeBanned: false },
        { refereeUserId: "n3", referrerUserId: "bob", refereeBanned: false },
      ],
      players,
      new Set()
    );
    expect(Object.fromEntries(counts)).toEqual({ alice: 2, bob: 1 });
  });

  it("drops banned referees, strong alt links, self referrals and referrers who are not players", () => {
    const counts = countWeeklyReferrals(
      [
        { refereeUserId: "banned", referrerUserId: "alice", refereeBanned: true },
        { refereeUserId: "alt", referrerUserId: "alice", refereeBanned: false },
        { refereeUserId: "alice", referrerUserId: "alice", refereeBanned: false },
        { refereeUserId: "n9", referrerUserId: "ghost", refereeBanned: false },
        { refereeUserId: "real", referrerUserId: "alice", refereeBanned: false },
      ],
      players,
      new Set([altPairKey("alice", "alt")])
    );
    expect(Object.fromEntries(counts)).toEqual({ alice: 1 });
  });

  it("orders alt pair keys so either direction matches", () => {
    expect(altPairKey("b", "a")).toBe(altPairKey("a", "b"));
  });
});

describe("iterationChanged", () => {
  it("fires only when both iterations are known and differ", () => {
    expect(iterationChanged("Beta:2", "Beta:3")).toBe(true);
    expect(iterationChanged("Beta:2", "Beta:2")).toBe(false);
    expect(iterationChanged(undefined, "Beta:3")).toBe(false);
    expect(iterationChanged("Beta:2", undefined)).toBe(false);
  });
});

describe("referralGrantDecision", () => {
  const now = 1_000;

  it("grants to a non-supporter, a lapsed one, or an earlier contest winner", () => {
    expect(referralGrantDecision({ tier: null, expiresAtMs: null, provider: null }, now)).toBe(
      "grant"
    );
    expect(
      referralGrantDecision({ tier: "supporter", expiresAtMs: 500, provider: "patreon" }, now)
    ).toBe("grant");
    expect(
      referralGrantDecision({ tier: "supporter", expiresAtMs: null, provider: "contest" }, now)
    ).toBe("grant");
  });

  it("never touches a paying supporter", () => {
    expect(
      referralGrantDecision({ tier: "supporter", expiresAtMs: null, provider: "patreon" }, now)
    ).toBe("already_supporter");
    expect(
      referralGrantDecision({ tier: "supporter-plus", expiresAtMs: 2_000, provider: "stripe" }, now)
    ).toBe("already_supporter");
  });
});
