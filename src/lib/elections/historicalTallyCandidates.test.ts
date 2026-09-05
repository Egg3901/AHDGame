import { describe, it, expect } from "vitest";
import { appendHistoricalTallyCandidates } from "./historicalTallyCandidates";
import type { EnrichedCandidate } from "./candidateEnrichment";

/**
 * A finished election is a historical record. When a character or NPP is
 * deleted afterwards — e.g. the turn-651 Liberal/SDP merge removed every
 * Liberal NPP — their `electionCandidates` doc goes with them, and the results
 * page silently dropped them from the field. That changed the vote denominator
 * under players' feet and left seats unaccounted for. Results must stay static.
 */

const party = (id: string) => ({
  name: id === "6" ? "Liberal Party" : `Party ${id}`,
  color: "#abcdef",
  econ: 0,
  social: 0,
});

function candidate(id: string, name: string, partyId: string): EnrichedCandidate {
  return {
    id,
    characterId: `char-${id}`,
    characterName: name,
    party: partyId,
    partyName: `Party ${partyId}`,
    partyColor: "#123456",
    partyEcon: 0,
    partySocial: 0,
    isNPP: false,
    nppId: null,
    economicPosition: 0,
    socialPosition: 0,
    favorability: 50,
    politicalInfluence: 0,
    nationalInfluence: 0,
    primaryScore: 0,
    sharePct: 0,
    enteredAt: new Date(0),
    endorsements: [],
    isYou: false,
  };
}

describe("appendHistoricalTallyCandidates", () => {
  const survivors = [candidate("a", "Peter Wood", "2"), candidate("b", "David Brown", "1")];
  const tally = {
    totalVotes: { a: 808931, b: 533035, gone: 320910 },
    candidateNames: { a: "Peter Wood", b: "David Brown", gone: "Tom Marshall" },
    candidateParties: { a: "2", b: "1", gone: "6" },
  };

  it("restores a candidate whose record was deleted after the election", () => {
    const out = appendHistoricalTallyCandidates(survivors, tally, party);
    expect(out).toHaveLength(3);
    const restored = out.find((c) => c.id === "gone")!;
    expect(restored.characterName).toBe("Tom Marshall");
    expect(restored.party).toBe("6");
    expect(restored.partyName).toBe("Liberal Party");
  });

  it("leaves surviving candidates untouched and keeps them first", () => {
    const out = appendHistoricalTallyCandidates(survivors, tally, party);
    expect(out.slice(0, 2)).toEqual(survivors);
  });

  it("is a no-op when every tally candidate still has a record", () => {
    const complete = {
      totalVotes: { a: 10, b: 5 },
      candidateNames: { a: "Peter Wood", b: "David Brown" },
      candidateParties: { a: "2", b: "1" },
    };
    expect(appendHistoricalTallyCandidates(survivors, complete, party)).toEqual(survivors);
  });

  it("ignores deleted candidates who drew no votes", () => {
    const withZero = {
      totalVotes: { a: 10, b: 5, ghost: 0 },
      candidateNames: { a: "Peter Wood", b: "David Brown", ghost: "Never Ran" },
      candidateParties: { a: "2", b: "1", ghost: "3" },
    };
    expect(appendHistoricalTallyCandidates(survivors, withZero, party)).toEqual(survivors);
  });

  it("carries the historical vote share rather than zero", () => {
    const out = appendHistoricalTallyCandidates(survivors, tally, party);
    const restored = out.find((c) => c.id === "gone")!;
    // 320,910 of 1,662,876 cast.
    expect(restored.sharePct).toBeCloseTo((320910 / 1662876) * 100, 6);
  });

  it("marks restored rows so callers can tell them apart", () => {
    const out = appendHistoricalTallyCandidates(survivors, tally, party);
    const restored = out.find((c) => c.id === "gone")!;
    expect(restored.characterId).toBeNull();
    expect(restored.isYou).toBe(false);
  });

  it("handles a missing tally", () => {
    expect(appendHistoricalTallyCandidates(survivors, null, party)).toEqual(survivors);
    expect(appendHistoricalTallyCandidates(survivors, undefined, party)).toEqual(survivors);
  });

  it("falls back to a placeholder name when the tally has none", () => {
    const nameless = {
      totalVotes: { a: 10, gone: 7 },
      candidateNames: { a: "Peter Wood" },
      candidateParties: { a: "2", gone: "6" },
    };
    const out = appendHistoricalTallyCandidates(survivors, nameless, party);
    const restored = out.find((c) => c.id === "gone")!;
    expect(restored.characterName).toBe("Former candidate");
  });
});
