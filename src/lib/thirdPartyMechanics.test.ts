/**
 * Tests for third-party / FPTP / party-org mechanics
 *
 * Covers:
 *  1. FPTP vote-splitting (spoiler effect) in distributeVotesByGroupLevelAllocation
 *  2. Org decay math (consecutive-loss trigger)
 *
 * FPTP model — vote-splitting / spoiler effect:
 *   In FPTP states, FPTP_SPOILER_RATE × the third party's own group-level
 *   allocation is transferred FROM the nearest major party TO the third party.
 *   This models the real-world spoiler dynamic: a nearby third party bleeds
 *   coalition voters from the ideologically similar major party, potentially
 *   handing the seat to the other major party.  In RCV states no adjustment
 *   is made — ranked choice eliminates the spoiler dynamic entirely.
 */
import { describe, it, expect } from "vitest";
import { distributeVotesByGroupLevelAllocation } from "@/lib/electionEngine";
import type { EnrichedCandidate, DistributeVotesOptions } from "@/lib/electionEngine";
import type { StateDemographics, DemographicCategory } from "@/lib/db/types";

// ─── FPTP vote-splitting (spoiler effect) ────────────────────────────────────
//
// We need a minimal StateDemographics / DemographicCategory setup.
// One category, one group, population 100%, turnout 100%, neutral lean (0,0).

function makeDemographics(): {
  demographics: StateDemographics;
  categories: DemographicCategory[];
} {
  const demographics: StateDemographics = {
    _id: "TX",
    stateId: "TX",
    categoryWeights: { ideology: 100 },
    groups: {
      moderate: { population: 100, economicLean: 0, socialLean: 0, turnout: 100 },
    },
  } as unknown as StateDemographics;

  const categories: DemographicCategory[] = [
    {
      _id: "ideology",
      name: "Ideology",
      groups: [
        {
          id: "moderate",
          name: "Moderate",
          defaultEconomicLean: 0,
          defaultSocialLean: 0,
          defaultTurnout: 100,
        },
      ],
    } as unknown as DemographicCategory,
  ];

  return { demographics, categories };
}

function makeCandidate(id: string, party: string, econ: number, social: number): EnrichedCandidate {
  return {
    candidateId: id,
    characterId: id,
    characterName: id,
    party,
    isNPP: true,
    charEP: econ,
    charSP: social,
    favorability: 100, // full approval — no approval penalty
    politicalInfluence: 100, // high influence so reach ≈ 1
    nationalInfluence: 100,
  };
}

describe("distributeVotesByGroupLevelAllocation — FPTP vote-splitting (spoiler effect)", () => {
  const { demographics, categories } = makeDemographics();
  const partyOrgByParty = new Map([
    ["democrat", 100],
    ["republican", 100],
    ["green", 100],
  ]);
  const population = 1_000_000;
  const totalPool = 1_000_000;
  const effectiveTurnPool = 1_000_000;

  it("does NOT apply FPTP spoiler outside general election (primary phase)", () => {
    const dem = makeCandidate("dem1", "democrat", -2, -2);
    const green = makeCandidate("grn1", "green", -1, -1);

    const opts: DistributeVotesOptions = {
      votingSystem: "fptp",
      isGeneralElection: false, // still in primary
    };

    const { votesPerCandidate } = distributeVotesByGroupLevelAllocation(
      [dem, green],
      effectiveTurnPool,
      totalPool,
      population,
      demographics,
      categories,
      partyOrgByParty,
      opts
    );

    // No spoiler adjustment in primaries — both get approximately equal votes
    const greenShare =
      votesPerCandidate["grn1"] / (votesPerCandidate["dem1"] + votesPerCandidate["grn1"]);
    // Green should have close to 50% (no spoiler boost)
    expect(greenShare).toBeGreaterThan(0.4);
  });

  it("applies FPTP spoiler in general election: third-party gains votes drawn from nearest major party", () => {
    const dem = makeCandidate("dem1", "democrat", -2, -2);
    const rep = makeCandidate("rep1", "republican", 2, 2);
    // Green candidate is ideologically closest to Democrats
    const green = makeCandidate("grn1", "green", -1.5, -1.5);

    const optsFPTP: DistributeVotesOptions = {
      votingSystem: "fptp",
      isGeneralElection: true,
    };
    const optsRCV: DistributeVotesOptions = {
      votingSystem: "rcv",
      isGeneralElection: true,
    };

    const { votesPerCandidate: fptp } = distributeVotesByGroupLevelAllocation(
      [dem, rep, green],
      effectiveTurnPool,
      totalPool,
      population,
      demographics,
      categories,
      partyOrgByParty,
      optsFPTP
    );
    const { votesPerCandidate: rcv } = distributeVotesByGroupLevelAllocation(
      [dem, rep, green],
      effectiveTurnPool,
      totalPool,
      population,
      demographics,
      categories,
      partyOrgByParty,
      optsRCV
    );

    // Under FPTP (spoiler effect), Green gains votes drawn from the nearest major party (Dem)
    expect(fptp["grn1"]).toBeGreaterThan(rcv["grn1"]);

    // Democrat loses votes to the Green spoiler in FPTP
    expect(fptp["dem1"]).toBeLessThan(rcv["dem1"]);

    // Republican is NOT the nearest to Green, so Republican is unaffected
    expect(fptp["rep1"]).toBeCloseTo(rcv["rep1"], -2); // within ~100 votes
  });

  it("votes are drawn from the nearest major party by ideology (spoiler effect)", () => {
    // Green is close to Dem; Libertarian is close to Rep
    const dem = makeCandidate("dem1", "democrat", -3, -3);
    const rep = makeCandidate("rep1", "republican", 3, 3);
    const green = makeCandidate("grn1", "green", -2.5, -2.5); // closer to Dem
    const lib = makeCandidate("lib1", "libertarian", 2.5, 2.5); // closer to Rep

    // Phase 5a delta: under the legacy `partyOrgScalar` formula, parties
    // missing from the Org map were treated as neutral (1.0× scalar) so the
    // libertarian got non-zero baseline votes for FPTP to peel onto. Under
    // Phase 5a's normalized share formula, a party with no entry in the Org
    // map has 0 share → 0 votes, which correctly represents "no state
    // presence" but means FPTP can't peel anything to lib1 (0 × rate = 0).
    // Tests that exercise FPTP spoiler dynamics on a third party MUST list
    // the party in the Org map. Plan §"Phase 5a — D5" backward-compat.
    const orgWithLib = new Map(partyOrgByParty);
    orgWithLib.set("libertarian", 100);

    const opts: DistributeVotesOptions = {
      votingSystem: "fptp",
      isGeneralElection: true,
    };

    const { votesPerCandidate: fptp } = distributeVotesByGroupLevelAllocation(
      [dem, rep, green, lib],
      effectiveTurnPool,
      totalPool,
      population,
      demographics,
      categories,
      orgWithLib,
      opts
    );
    const { votesPerCandidate: rcv } = distributeVotesByGroupLevelAllocation(
      [dem, rep, green, lib],
      effectiveTurnPool,
      totalPool,
      population,
      demographics,
      categories,
      orgWithLib,
      { votingSystem: "rcv", isGeneralElection: true }
    );

    // Both third parties gain votes under FPTP (drawn from nearest major party)
    expect(fptp["grn1"]).toBeGreaterThan(rcv["grn1"]);
    expect(fptp["lib1"]).toBeGreaterThan(rcv["lib1"]);

    // Dem loses votes — Green is the spoiler for Dem
    const demLoss = rcv["dem1"] - fptp["dem1"];
    // Rep loses votes — Lib is the spoiler for Rep
    const repLoss = rcv["rep1"] - fptp["rep1"];
    expect(demLoss).toBeGreaterThan(0);
    expect(repLoss).toBeGreaterThan(0);

    // Dem is NOT harmed by Libertarian (far-right third party, not Dem's nearest)
    // Rep is NOT harmed by Green (far-left third party, not Rep's nearest)
    // Dem's loss comes from Green; Rep's loss comes from Lib
    expect(demLoss).toBeGreaterThan(repLoss * 0.5); // rough proportionality check
  });

  it("does NOT apply FPTP if no major party is present (third-party-only race)", () => {
    const green = makeCandidate("grn1", "green", -1, -1);
    const lib = makeCandidate("lib1", "libertarian", 1, 1);

    const opts: DistributeVotesOptions = {
      votingSystem: "fptp",
      isGeneralElection: true,
    };

    const { votesPerCandidate: fptp } = distributeVotesByGroupLevelAllocation(
      [green, lib],
      effectiveTurnPool,
      totalPool,
      population,
      demographics,
      categories,
      partyOrgByParty,
      opts
    );
    const { votesPerCandidate: rcv } = distributeVotesByGroupLevelAllocation(
      [green, lib],
      effectiveTurnPool,
      totalPool,
      population,
      demographics,
      categories,
      partyOrgByParty,
      { votingSystem: "rcv", isGeneralElection: true }
    );

    // No major party to defect to → results should be identical
    expect(fptp["grn1"]).toBeCloseTo(rcv["grn1"], 0);
    expect(fptp["lib1"]).toBeCloseTo(rcv["lib1"], 0);
  });

  it("RCV gives same results regardless of general/primary flag", () => {
    const dem = makeCandidate("dem1", "democrat", -2, -2);
    const green = makeCandidate("grn1", "green", -1, -1);

    const optsGeneral: DistributeVotesOptions = { votingSystem: "rcv", isGeneralElection: true };
    const optsPrimary: DistributeVotesOptions = { votingSystem: "rcv", isGeneralElection: false };

    const { votesPerCandidate: general } = distributeVotesByGroupLevelAllocation(
      [dem, green],
      effectiveTurnPool,
      totalPool,
      population,
      demographics,
      categories,
      partyOrgByParty,
      optsGeneral
    );
    const { votesPerCandidate: primary } = distributeVotesByGroupLevelAllocation(
      [dem, green],
      effectiveTurnPool,
      totalPool,
      population,
      demographics,
      categories,
      partyOrgByParty,
      optsPrimary
    );

    expect(general["dem1"]).toBeCloseTo(primary["dem1"], 0);
    expect(general["grn1"]).toBeCloseTo(primary["grn1"], 0);
  });
});

// ─── Org decay math ───────────────────────────────────────────────────────────
//
// We test the consecutive-loss trigger logic in isolation (pure math, no DB).

describe("org decay consecutive-loss trigger", () => {
  const DECAY_TRIGGER_LOSSES = 3;
  const ORG_DECAY_PER_TRIGGER = 3;

  function decayAmount(newLosses: number): number {
    return Math.floor(newLosses / DECAY_TRIGGER_LOSSES) >
      Math.floor((newLosses - 1) / DECAY_TRIGGER_LOSSES)
      ? ORG_DECAY_PER_TRIGGER
      : 0;
  }

  it("no decay at 1 or 2 consecutive losses", () => {
    expect(decayAmount(1)).toBe(0);
    expect(decayAmount(2)).toBe(0);
  });

  it("triggers decay exactly at 3 consecutive losses", () => {
    expect(decayAmount(3)).toBe(ORG_DECAY_PER_TRIGGER);
  });

  it("no decay at 4 or 5 consecutive losses (between triggers)", () => {
    expect(decayAmount(4)).toBe(0);
    expect(decayAmount(5)).toBe(0);
  });

  it("triggers again at 6 consecutive losses", () => {
    expect(decayAmount(6)).toBe(ORG_DECAY_PER_TRIGGER);
  });

  it("triggers at every multiple of DECAY_TRIGGER_LOSSES", () => {
    for (const n of [3, 6, 9, 12]) {
      expect(decayAmount(n)).toBe(ORG_DECAY_PER_TRIGGER);
    }
  });

  it("no decay at non-multiples", () => {
    for (const n of [1, 2, 4, 5, 7, 8, 10, 11]) {
      expect(decayAmount(n)).toBe(0);
    }
  });
});
