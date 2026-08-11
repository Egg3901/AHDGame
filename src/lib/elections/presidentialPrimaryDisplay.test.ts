import { describe, expect, it } from "vitest";

import {
  applyProjectedDelegatePolling,
  applyProjectedDelegateShares,
  projectPrimaryDelegateTotals,
  summarizePrimaryProjection,
} from "./presidentialPrimaryDisplay";

describe("summarizePrimaryProjection — real-world default allocation", () => {
  it("uses GOP_DEFAULT_ALLOCATION (PR) for known PR states even without an override", () => {
    // CO is a pure-PR state for Republicans in real life; without an explicit
    // override the math should treat it as PR, not the old "WTA for any GOP
    // state" fallback.
    const summary = summarizePrimaryProjection({
      stateIds: ["CO"],
      family: "gop",
      candidateIds: ["a", "b", "c"],
      totalDelegates: 37,
      projectedVotesByState: {
        CO: { a: 60, b: 30, c: 10 },
      },
    });

    const co = summary.perState.find((s) => s.stateId === "CO")!;
    expect(co.allocationMethod).toBe("PR");
    // PR splits the delegates: leader doesn't sweep
    expect(co.projectedDelegatesByCandidate.a).toBeGreaterThan(0);
    expect(co.projectedDelegatesByCandidate.b).toBeGreaterThan(0);
    // c is below 15% viability → 0
    expect(co.projectedDelegatesByCandidate.c).toBe(0);
  });

  it("uses GOP_DEFAULT_ALLOCATION (WTA) for known WTA states", () => {
    const summary = summarizePrimaryProjection({
      stateIds: ["FL"],
      family: "gop",
      candidateIds: ["a", "b"],
      totalDelegates: 99,
      projectedVotesByState: {
        FL: { a: 51, b: 49 },
      },
    });

    const fl = summary.perState.find((s) => s.stateId === "FL")!;
    expect(fl.allocationMethod).toBe("WTA");
    // WTA: leader sweeps
    expect(fl.projectedDelegatesByCandidate.a).toBe(fl.delegatesAvailable);
    expect(fl.projectedDelegatesByCandidate.b).toBe(0);
  });

  it("respects explicit per-state override over the real-world default", () => {
    const summary = summarizePrimaryProjection({
      stateIds: ["FL"],
      family: "gop",
      candidateIds: ["a", "b"],
      totalDelegates: 99,
      projectedVotesByState: {
        FL: { a: 51, b: 49 },
      },
      // chair has overridden FL to PR
      allocationByState: { FL: "PR" },
    });

    expect(summary.perState[0].allocationMethod).toBe("PR");
  });

  it("uses PR for every Dem state regardless of stateId", () => {
    const summary = summarizePrimaryProjection({
      stateIds: ["FL", "TX", "CA", "WV"],
      family: "dem",
      candidateIds: ["a", "b"],
      totalDelegates: 200,
      projectedVotesByState: {
        FL: { a: 60, b: 40 },
        TX: { a: 60, b: 40 },
        CA: { a: 60, b: 40 },
        WV: { a: 60, b: 40 },
      },
    });

    for (const s of summary.perState) {
      expect(s.allocationMethod).toBe("PR");
    }
  });
});

describe("summarizePrimaryProjection — overview / per-state consistency", () => {
  // Regression: when every state is projected ~50.3 / 49.7 the per-state pages
  // legitimately show ~50/50 votes, but WTA delegate allocation hands every
  // state to the leader → a national delegate share approaching 100%. Both the
  // overview (Del. share) and per-state pages (Vote %) must derive from the
  // same canonical source so users can see exactly how a tiny vote-share lead
  // amplifies into a delegate landslide. This test is the contract.
  it("derives both vote share AND delegate share from the same per-state projections", () => {
    const stateIds = ["IA", "NH", "NV"];
    const projectedVotesByState = {
      IA: { drake: 503, melania: 497 },
      NH: { drake: 504, melania: 496 },
      NV: { drake: 502, melania: 498 },
    };

    const summary = summarizePrimaryProjection({
      stateIds,
      family: "gop",
      candidateIds: ["drake", "melania"],
      totalDelegates: 100,
      projectedVotesByState,
      // No actual votes yet → projection drives both numbers
    });

    // National vote share is ~50/50 — small lead for Drake.
    expect(summary.nationalVoteSharePct.drake).toBeGreaterThan(50);
    expect(summary.nationalVoteSharePct.drake).toBeLessThan(51);
    expect(summary.nationalVoteSharePct.melania).toBeGreaterThan(49);
    expect(summary.nationalVoteSharePct.melania).toBeLessThan(50);
    // Vote shares sum to ~100%.
    expect(summary.nationalVoteSharePct.drake + summary.nationalVoteSharePct.melania).toBeCloseTo(
      100,
      0
    );

    // Per-state shares match the projection inputs exactly.
    for (const s of summary.perState) {
      const total =
        (projectedVotesByState as Record<string, Record<string, number>>)[s.stateId].drake +
        (projectedVotesByState as Record<string, Record<string, number>>)[s.stateId].melania;
      const expected =
        Math.round(
          ((projectedVotesByState as Record<string, Record<string, number>>)[s.stateId].drake /
            total) *
            1000
        ) / 10;
      expect(s.sharePctByCandidate.drake).toBeCloseTo(expected, 1);
      expect(s.voteSource).toBe("projected");
    }
  });

  it("explains 50/50 vote share + landslide delegate share via WTA amplification", () => {
    // Use real state IDs so getDelegatesForState returns real delegate counts.
    const stateIds = ["IA", "NH", "SC", "NV"];
    const projectedVotesByState = {
      IA: { drake: 51, melania: 49 },
      NH: { drake: 51, melania: 49 },
      SC: { drake: 51, melania: 49 },
      NV: { drake: 51, melania: 49 },
    };

    // totalDelegates is only used for sharePct math — set it to the total of
    // these four states so a clean sweep equals 100% delegate share.
    const stateDelegateCounts = { IA: 40, NH: 22, SC: 50, NV: 26 };
    const totalDelegates = Object.values(stateDelegateCounts).reduce((a, b) => a + b, 0);

    const summary = summarizePrimaryProjection({
      stateIds,
      family: "gop", // GOP family → WTA by default
      candidateIds: ["drake", "melania"],
      totalDelegates,
      projectedVotesByState,
      allocationByState: { IA: "WTA", NH: "WTA", SC: "WTA", NV: "WTA" },
    });

    // National vote share remains ~51/49.
    expect(summary.nationalVoteSharePct.drake).toBeCloseTo(51, 0);
    expect(summary.nationalVoteSharePct.melania).toBeCloseTo(49, 0);

    // Under WTA, Drake sweeps every state → all per-state delegates go to him.
    // The "84% overview vs 50/50 state pages" pattern: same canonical source,
    // very different aggregation metrics.
    expect(summary.delegatesByCandidate.drake).toBeGreaterThan(0);
    expect(summary.delegatesByCandidate.melania).toBe(0);

    // Delta (delegate share − vote share) flags the amplification.
    const drakeDelta = summary.nationalDelegateSharePct.drake - summary.nationalVoteSharePct.drake;
    expect(drakeDelta).toBeGreaterThan(40);
  });

  it("locks awarded delegates without re-projecting states that already voted", () => {
    const summary = summarizePrimaryProjection({
      stateIds: ["IA", "NH"],
      family: "gop",
      candidateIds: ["alice", "bob"],
      totalDelegates: 60,
      projectedVotesByState: {
        IA: { alice: 100, bob: 60 },
        NH: { alice: 30, bob: 70 },
      },
      actualVotesByState: { IA: { alice: 80, bob: 90 } }, // bob actually won IA
      awardedDelegatesByState: { IA: { bob: 30 } },
      allocationByState: { IA: "WTA", NH: "WTA" },
    });

    // IA — actual votes used for vote share; awarded delegates untouched.
    const ia = summary.perState.find((s) => s.stateId === "IA")!;
    expect(ia.voteSource).toBe("actual");
    expect(ia.sharePctByCandidate.bob).toBeGreaterThan(50);
    expect(ia.awardedDelegatesByCandidate).toEqual({ bob: 30 });

    // NH — projection only; bob projected to win → all NH delegates to bob.
    const nh = summary.perState.find((s) => s.stateId === "NH")!;
    expect(nh.voteSource).toBe("projected");
    expect(nh.winnerId).toBe("bob");
    expect(nh.projectedDelegatesByCandidate.bob).toBeGreaterThan(0);

    // Awarded IA delegates show up in totals.
    expect(summary.delegatesByCandidate.bob).toBeGreaterThanOrEqual(30);
  });

  it("flags missing-state projections instead of silently filling in 50/50", () => {
    const summary = summarizePrimaryProjection({
      stateIds: ["IA", "MISSING"],
      family: "gop",
      candidateIds: ["alice", "bob"],
      totalDelegates: 50,
      projectedVotesByState: {
        IA: { alice: 100, bob: 50 },
        // MISSING is absent — no projection generated for it
      },
    });

    const missing = summary.perState.find((s) => s.stateId === "MISSING")!;
    expect(missing.voteSource).toBe("none");
    expect(missing.totalVotes).toBe(0);
    expect(missing.winnerId).toBeNull();
    // Crucially, the missing state contributes 0 votes (not split 50/50)
    expect(missing.sharePctByCandidate.alice).toBe(0);
    expect(missing.sharePctByCandidate.bob).toBe(0);
  });

  it("reports per-candidate national vote totals matching the per-state sum", () => {
    const summary = summarizePrimaryProjection({
      stateIds: ["A", "B"],
      family: "dem",
      candidateIds: ["x", "y"],
      totalDelegates: 50,
      projectedVotesByState: {
        A: { x: 100, y: 200 },
        B: { x: 300, y: 100 },
      },
    });

    expect(summary.nationalVotesByCandidate.x).toBe(400);
    expect(summary.nationalVotesByCandidate.y).toBe(300);
    expect(summary.nationalVoteSharePct.x).toBeCloseTo(57.1, 1);
    expect(summary.nationalVoteSharePct.y).toBeCloseTo(42.9, 1);
  });
});

describe("projectPrimaryDelegateTotals", () => {
  it("keeps awarded delegates fixed while projecting the remaining states", () => {
    const totals = projectPrimaryDelegateTotals({
      stateIds: ["IA", "NH", "NV"],
      family: "gop",
      candidateIds: ["alice", "bob"],
      projectedVotesByState: {
        IA: { alice: 100, bob: 90 },
        NH: { alice: 120, bob: 80 },
        NV: { alice: 70, bob: 130 },
      },
      actualVotesByState: {
        IA: { alice: 95, bob: 105 },
      },
      awardedDelegatesByState: {
        IA: { bob: 40 },
      },
      // Pin allocation to WTA for every state so this test is independent of
      // the real-world default-allocation map (NH = PR by 2024 GOP rules).
      allocationByState: { IA: "WTA", NH: "WTA", NV: "WTA" },
    });

    expect(totals).toEqual({
      alice: 22,
      bob: 65,
    });
  });
});

describe("applyProjectedDelegateShares", () => {
  it("reorders candidates by projected delegates and rewrites their displayed share", () => {
    const updated = applyProjectedDelegateShares(
      {
        partyId: "republican",
        partyName: "Republican Party",
        partyColor: "#ff0000",
        countryId: "US",
        partyEcon: 2,
        partySocial: 2,
        hasCompetitivePrimary: true,
        candidates: [
          {
            id: "alice",
            characterId: "alice-char",
            characterName: "Alice",
            party: "republican",
            partyName: "Republican Party",
            partyColor: "#ff0000",
            partyEcon: 2,
            partySocial: 2,
            isNPP: false,
            nppId: null,
            economicPosition: 2,
            socialPosition: 2,
            favorability: 55,
            politicalInfluence: 40,
            nationalInfluence: 60,
            primaryScore: 90,
            sharePct: 60,
            enteredAt: new Date("2026-04-01"),
            endorsements: [],
            isYou: false,
            travelState: null,
          },
          {
            id: "bob",
            characterId: "bob-char",
            characterName: "Bob",
            party: "republican",
            partyName: "Republican Party",
            partyColor: "#ff0000",
            partyEcon: 2,
            partySocial: 2,
            isNPP: false,
            nppId: null,
            economicPosition: 1,
            socialPosition: 1,
            favorability: 52,
            politicalInfluence: 38,
            nationalInfluence: 58,
            primaryScore: 80,
            sharePct: 40,
            enteredAt: new Date("2026-04-01"),
            endorsements: [],
            isYou: false,
            travelState: null,
          },
        ],
      },
      { alice: 22, bob: 65 },
      87
    );

    expect(updated.candidates.map((candidate) => candidate.id)).toEqual(["bob", "alice"]);
    expect(updated.candidates[0].sharePct).toBe(74.7);
    expect(updated.candidates[1].sharePct).toBe(25.3);
  });

  // #3022: the delegate winner must also lead every primaryScore-sorted surface.
  const makeCandidate = (id: string, primaryScore: number) => ({
    id,
    characterId: `${id}-char`,
    characterName: id,
    party: "republican",
    partyName: "Republican Party",
    partyColor: "#ff0000",
    partyEcon: 2,
    partySocial: 2,
    isNPP: false,
    nppId: null,
    economicPosition: 2,
    socialPosition: 2,
    favorability: 50,
    politicalInfluence: 40,
    nationalInfluence: 60,
    primaryScore,
    sharePct: 0,
    enteredAt: new Date("2026-04-01"),
    endorsements: [],
    isYou: false,
    travelState: null,
  });
  const makeGroup = (candidates: ReturnType<typeof makeCandidate>[]) => ({
    partyId: "republican",
    partyName: "Republican Party",
    partyColor: "#ff0000",
    countryId: "US" as const,
    partyEcon: 2,
    partySocial: 2,
    hasCompetitivePrimary: true,
    candidates,
  });

  it("overwrites primaryScore with delegate-first standing when a votes map is supplied", () => {
    // Cara has the LOWEST ideology primaryScore but wins the vote engine
    // (most delegates) — she must end up first with the highest primaryScore.
    const updated = applyProjectedDelegateShares(
      makeGroup([makeCandidate("dan", 95), makeCandidate("cara", 10)]),
      { dan: 12, cara: 40 },
      100,
      { dan: 2000, cara: 9000 }
    );
    expect(updated.candidates.map((c) => c.id)).toEqual(["cara", "dan"]);
    // standing = delegates + national vote share (fraction). Total votes = 11000.
    expect(updated.candidates[0].primaryScore).toBeCloseTo(40 + 9000 / 11000, 6);
    expect(updated.candidates[1].primaryScore).toBeCloseTo(12 + 2000 / 11000, 6);
    // Ranking by the overwritten primaryScore matches the delegate ranking.
    expect(updated.candidates[0].primaryScore).toBeGreaterThan(updated.candidates[1].primaryScore);
    // Standing stays display-sane (delegate count in the integer part).
    expect(updated.candidates[0].primaryScore).toBeLessThan(41);
  });

  it("breaks equal-delegate ties by projected national votes", () => {
    const updated = applyProjectedDelegateShares(
      makeGroup([makeCandidate("ed", 88), makeCandidate("fay", 88)]),
      { ed: 20, fay: 20 },
      100,
      { ed: 500, fay: 1500 }
    );
    expect(updated.candidates.map((c) => c.id)).toEqual(["fay", "ed"]);
  });

  it("leaves primaryScore untouched when no votes map is supplied (non-presidential callers)", () => {
    const updated = applyProjectedDelegateShares(
      makeGroup([makeCandidate("gil", 70), makeCandidate("hana", 90)]),
      { gil: 10, hana: 5 },
      100
    );
    // Delegates still reorder + set sharePct, but primaryScore is preserved.
    expect(updated.candidates.map((c) => c.id)).toEqual(["gil", "hana"]);
    expect(updated.candidates.find((c) => c.id === "gil")?.primaryScore).toBe(70);
    expect(updated.candidates.find((c) => c.id === "hana")?.primaryScore).toBe(90);
  });
});

describe("applyProjectedDelegatePolling", () => {
  it("rewrites primary polling percentages to match projected delegate display order", () => {
    const updated = applyProjectedDelegatePolling(
      {
        leaderId: "alice",
        leaderName: "Alice",
        leaderParty: "democrat",
        sharesPct: { alice: 60, bob: 40 },
        candidateNames: { alice: "Alice", bob: "Bob" },
        candidateParties: { alice: "democrat", bob: "democrat" },
        candidatePartyNames: { alice: "Democratic Party", bob: "Democratic Party" },
        candidatePartyColors: { alice: "#0000ff", bob: "#6666ff" },
        source: "primary",
      },
      [
        {
          partyId: "republican",
          partyName: "Republican Party",
          partyColor: "#ff0000",
          countryId: "US",
          partyEcon: 2,
          partySocial: 2,
          hasCompetitivePrimary: true,
          candidates: [
            {
              id: "bob",
              characterId: "bob-char",
              characterName: "Bob",
              party: "republican",
              partyName: "Republican Party",
              partyColor: "#ff0000",
              partyEcon: 2,
              partySocial: 2,
              isNPP: false,
              nppId: null,
              economicPosition: 1,
              socialPosition: 1,
              favorability: 52,
              politicalInfluence: 38,
              nationalInfluence: 58,
              primaryScore: 80,
              sharePct: 74.7,
              enteredAt: new Date("2026-04-01"),
              endorsements: [],
              isYou: false,
              travelState: null,
            },
            {
              id: "alice",
              characterId: "alice-char",
              characterName: "Alice",
              party: "republican",
              partyName: "Republican Party",
              partyColor: "#ff0000",
              partyEcon: 2,
              partySocial: 2,
              isNPP: false,
              nppId: null,
              economicPosition: 2,
              socialPosition: 2,
              favorability: 55,
              politicalInfluence: 40,
              nationalInfluence: 60,
              primaryScore: 90,
              sharePct: 25.3,
              enteredAt: new Date("2026-04-01"),
              endorsements: [],
              isYou: false,
              travelState: null,
            },
          ],
        },
      ]
    );

    expect(updated?.sharesPct).toEqual({ bob: 74.7, alice: 25.3 });
    expect(updated?.candidateParties).toEqual({ bob: "republican", alice: "republican" });
    expect(updated?.candidatePartyNames).toEqual({
      bob: "Republican Party",
      alice: "Republican Party",
    });
    expect(updated?.candidatePartyColors).toEqual({
      bob: "#ff0000",
      alice: "#ff0000",
    });
    expect(updated?.leaderId).toBe("bob");
    expect(updated?.leaderName).toBe("Bob");
    expect(updated?.leaderParty).toBe("republican");
  });
});
