import { describe, expect, it } from "vitest";
import type { ElectionDetail, VoteTurnSnapshot } from "../../components/ElectionDetailTypes";
import { TIER_BANDS } from "../generalBlendViewModel";
import { classifyMarginTier } from "@/lib/elections/generalViewModel";
import { shadeColorForTier } from "@/lib/elections/marginTierShade";
import { BLEND } from "@/components/blend/tokens";
import {
  buildPresMapModel,
  computePollingChange,
  computeTrend,
  describeTrend,
  formatPollChange,
  pollChangeHint,
  sharesFromVotes,
} from "./presMapModel";

function snap(turn: number, a: number, b: number): VoteTurnSnapshot {
  return { turn, recordedAt: "", cumulativeVotes: { a, b }, sharesPct: {} };
}

const lookup = (id: string) => ({ id, name: id.toUpperCase(), color: "#123456" });

describe("sharesFromVotes", () => {
  it("returns percentages that sum to 100", () => {
    expect(sharesFromVotes({ a: 600, b: 400 })).toEqual({ a: 60, b: 40 });
  });
  it("is all zero with no votes", () => {
    expect(sharesFromVotes({ a: 0, b: 0 })).toEqual({ a: 0, b: 0 });
  });
});

describe("computePollingChange", () => {
  it("measures against the snapshot before the latest when the latest is the current figure", () => {
    const snaps = [snap(10, 500, 500), snap(11, 520, 480)];
    const change = computePollingChange({ a: 52, b: 48 }, snaps, 11);
    expect(change.changes.a).toBeCloseTo(2);
    expect(change.changes.b).toBeCloseTo(-2);
    expect(change.sinceTurn).toBe(10);
    expect(change.turnsAgo).toBe(1);
  });

  it("measures against the latest snapshot when the payload is newer", () => {
    const snaps = [snap(10, 500, 500), snap(11, 520, 480)];
    const change = computePollingChange({ a: 55, b: 45 }, snaps, 12);
    expect(change.changes.a).toBeCloseTo(3);
    expect(change.sinceTurn).toBe(11);
    expect(change.turnsAgo).toBe(1);
  });

  it("has no baseline with a single snapshot or none", () => {
    expect(computePollingChange({ a: 50, b: 50 }, [snap(10, 500, 500)], 10).sinceTurn).toBeNull();
    expect(computePollingChange({ a: 50, b: 50 }, undefined, 10).changes).toEqual({});
  });

  it("sorts unordered history", () => {
    const snaps = [snap(11, 520, 480), snap(10, 500, 500)];
    expect(computePollingChange({ a: 52, b: 48 }, snaps, 11).sinceTurn).toBe(10);
  });
});

describe("computeTrend", () => {
  it("names the candidate with the largest share gain over the window", () => {
    const snaps = [snap(1, 500, 500), snap(2, 495, 505), snap(3, 490, 510), snap(4, 480, 520)];
    const trend = computeTrend(snaps, lookup, ["a", "b"], 3);
    expect(trend.status).toBe("toward");
    expect(trend.candidateId).toBe("b");
    expect(trend.shiftPp).toBeCloseTo(2);
    expect(trend.windowTurns).toBe(3);
    expect(trend.series).toHaveLength(4);
  });

  it("falls back to the oldest snapshot when history is shorter than the window", () => {
    const trend = computeTrend([snap(8, 500, 500), snap(9, 510, 490)], lookup, ["a", "b"], 3);
    expect(trend.candidateId).toBe("a");
    expect(trend.windowTurns).toBe(1);
  });

  it("calls a negligible move steady", () => {
    const trend = computeTrend([snap(1, 5000, 5000), snap(2, 5001, 4999)], lookup, ["a", "b"]);
    expect(trend.status).toBe("steady");
  });

  it("has no direction with fewer than two snapshots", () => {
    expect(computeTrend([snap(1, 1, 1)], lookup, ["a", "b"]).status).toBe("none");
    expect(computeTrend(undefined, lookup, ["a", "b"]).status).toBe("none");
  });
});

describe("poll change badge", () => {
  it("signs and rounds to one decimal", () => {
    expect(formatPollChange(1.24)).toEqual({ text: "+1.2%", tone: "up" });
    expect(formatPollChange(-0.86)).toEqual({ text: "-0.9%", tone: "down" });
  });
  it("reads a rounded zero as flat, never as a signed zero", () => {
    expect(formatPollChange(0.04)).toEqual({ text: "0.0%", tone: "flat" });
    expect(formatPollChange(-0.04)).toEqual({ text: "0.0%", tone: "flat" });
  });
  it("states the window in the hint", () => {
    expect(pollChangeHint(1, 10)).toContain("since last turn");
    expect(pollChangeHint(3, 8)).toContain("last 3 turns");
    expect(pollChangeHint(null, null)).toContain("No earlier turn");
  });
  it("never uses a dash character in copy", () => {
    const copy = [
      pollChangeHint(1, 10),
      pollChangeHint(null, null),
      describeTrend({
        status: "none",
        candidateId: null,
        name: null,
        color: null,
        shiftPp: 0,
        windowTurns: 0,
        series: [],
      }),
      describeTrend({
        status: "toward",
        candidateId: "a",
        name: "A",
        color: "#000",
        shiftPp: 1.5,
        windowTurns: 3,
        series: [],
      }),
    ];
    for (const s of copy) expect(s).not.toMatch(/[–—]/);
  });
});

describe("tier mapping", () => {
  it("covers every margin tier once, in order", () => {
    expect(TIER_BANDS.map((t) => t.tier)).toEqual(["safe", "likely", "lean", "tossup"]);
  });
  it("classifies on the same bands the legend prints", () => {
    expect(classifyMarginTier(20)).toBe("safe");
    expect(classifyMarginTier(12)).toBe("likely");
    expect(classifyMarginTier(7)).toBe("lean");
    expect(classifyMarginTier(2)).toBe("tossup");
  });
});

function election(): ElectionDetail {
  return {
    allCandidates: [
      { id: "a", characterName: "Ann", partyColor: "#2563eb" },
      { id: "b", characterName: "Ben", partyColor: "#dc2626" },
    ],
    gameState: { currentTurn: 11 },
    generalVotes: {
      totalVotes: { a: 2, b: 1 },
      electoralVotesByCandidate: { a: 20, b: 10 },
      evByState: { PA: 19, TX: 40 },
      stateVoteData: {
        PA: { votesByCandidate: { a: 520, b: 480 }, evByCandidate: { a: 19 } },
        TX: { votesByCandidate: { a: 300, b: 700 }, evByCandidate: { b: 40 } },
        WY: { votesByCandidate: { a: 100 }, evByCandidate: {} },
      },
      stateVotesOverTime: { PA: [snap(10, 500, 500), snap(11, 520, 480)] },
    },
  } as unknown as ElectionDetail;
}

describe("buildPresMapModel", () => {
  const model = buildPresMapModel(election());

  it("shades each state with the tile board's tier rule in the leader's colour", () => {
    const tx = model.states.TX;
    expect(tx.tier).toBe("safe");
    expect(tx.leaderId).toBe("b");
    expect(tx.fill).toBe(shadeColorForTier("#dc2626", "safe", BLEND.page));
    const pa = model.states.PA;
    expect(pa.tier).toBe("tossup");
    expect(pa.fill).toBe(shadeColorForTier("#2563eb", "tossup", BLEND.page));
  });

  it("carries EV, margin and per-candidate share with change", () => {
    const pa = model.states.PA;
    expect(pa.ev).toBe(19);
    expect(pa.margin).toBeCloseTo(4);
    expect(pa.shares[0].pct).toBeCloseTo(52);
    expect(pa.shares[0].changePp).toBeCloseTo(2);
    expect(pa.turnsAgo).toBe(1);
  });

  it("skips a state with fewer than two candidates drawing votes", () => {
    expect(model.states.WY).toBeUndefined();
  });

  it("legend ramps use the two candidates leading on electoral votes", () => {
    expect(model.legendCandidates.map((c) => c.id)).toEqual(["a", "b"]);
  });
});
