import { describe, expect, it } from "vitest";
import {
  createLedgerSink,
  assembleNationalLedger,
  assertLedgerReconstructs,
  FACTOR_ORDER,
  type FactorKey,
} from "./factorLedger";
import { distributeVotesBySwingFlow } from "./voteDistributionSwingFlow";
import type { EnrichedCandidate } from "./types";
import type { DemographicCategory, StateDemographics } from "@/lib/db/types";

// Archetype ids the ledger must NEVER read or emit (buckets only).
const ARCHETYPE_IDS = [
  "urbanProfessionals",
  "ruralWorkers",
  "retirees",
  "youngVoters",
  "religiousConservatives",
  "suburbanFamilies",
];

/**
 * Drive the sink directly with known per-unit values, then run the full stage
 * pipeline the presidential engine records, so the waterfall math is tested in
 * isolation from the swing-flow.
 */
function feedUnit(
  sink: ReturnType<typeof createLedgerSink>,
  unitId: string,
  candidateId: string,
  cells: Array<{
    votes: number;
    demoEP: number;
    demoSP: number;
    base: number;
    reachDelta: number;
    fitDelta: number;
    restDelta: number;
    bucketWeights?: Record<string, number>;
  }>,
  finalize: { support: number; swingDelta: number; spoilerDelta: number },
  stages: {
    strengthMultiplier: number;
    referendum: number;
    independent: number;
    lean: number;
    campaign: number;
    finalVotes: number;
  }
) {
  for (const c of cells) {
    sink.recordCellAppeal(
      unitId,
      candidateId,
      c.votes,
      c.demoEP,
      c.demoSP,
      { base: c.base, reachDelta: c.reachDelta, fitDelta: c.fitDelta, restDelta: c.restDelta },
      c.bucketWeights
    );
  }
  sink.finalizeUnitCandidate(unitId, candidateId, finalize);
  sink.setUnitTurnout(unitId, stages.strengthMultiplier);
  sink.recordReferendum(unitId, candidateId, stages.referendum);
  sink.recordIndependentPenalty(unitId, candidateId, stages.independent);
  sink.recordLean(unitId, candidateId, stages.lean);
  sink.recordCampaign(unitId, candidateId, stages.campaign);
  sink.recordFinalVotes(unitId, candidateId, stages.finalVotes);
}

describe("factorLedger waterfall reconstruction", () => {
  it("reconstructs finalVotes: baseline + Σ voteDelta === finalVotes", () => {
    const sink = createLedgerSink();
    // Two cells, support 1.1, plus a referendum + lean + campaign stage.
    feedUnit(
      sink,
      "CA",
      "c1",
      [
        {
          votes: 1000,
          demoEP: -1,
          demoSP: 0,
          base: 700,
          reachDelta: 120,
          fitDelta: 100,
          restDelta: 80,
        },
        {
          votes: 500,
          demoEP: 1,
          demoSP: 0,
          base: 400,
          reachDelta: 40,
          fitDelta: 30,
          restDelta: 30,
        },
      ],
      { support: 1.1, swingDelta: 60, spoilerDelta: -20 },
      {
        strengthMultiplier: 1.2,
        referendum: 15,
        independent: 0,
        lean: 25,
        campaign: 40,
        finalVotes: 1893,
      }
    );

    const ledger = assembleNationalLedger(sink, 400);
    const cand = ledger.byCandidateNational.find((c) => c.candidateId === "c1")!;
    let sum = cand.nominalWeight;
    for (const f of cand.factors) sum += f.voteDelta;
    expect(sum).toBeCloseTo(cand.finalVotes, 6);
    expect(cand.finalVotes).toBe(1893);

    // The assertion helper must accept it against the engine total.
    expect(() => assertLedgerReconstructs(ledger, { c1: 1893 })).not.toThrow();
  });

  it("assertLedgerReconstructs throws when the engine total disagrees", () => {
    const sink = createLedgerSink();
    feedUnit(
      sink,
      "CA",
      "c1",
      [{ votes: 100, demoEP: 0, demoSP: 0, base: 100, reachDelta: 0, fitDelta: 0, restDelta: 0 }],
      { support: 1, swingDelta: 0, spoilerDelta: 0 },
      {
        strengthMultiplier: 1,
        referendum: 0,
        independent: 0,
        lean: 0,
        campaign: 0,
        finalVotes: 100,
      }
    );
    const ledger = assembleNationalLedger(sink, 1);
    expect(() => assertLedgerReconstructs(ledger, { c1: 999 })).toThrow(/drift/);
  });

  it("exposes exactly the nine ordered factor keys", () => {
    const sink = createLedgerSink();
    feedUnit(
      sink,
      "CA",
      "c1",
      [{ votes: 100, demoEP: 0, demoSP: 0, base: 100, reachDelta: 0, fitDelta: 0, restDelta: 0 }],
      { support: 1, swingDelta: 0, spoilerDelta: 0 },
      {
        strengthMultiplier: 1,
        referendum: 0,
        independent: 0,
        lean: 0,
        campaign: 0,
        finalVotes: 100,
      }
    );
    const ledger = assembleNationalLedger(sink, 1);
    const keys = ledger.byCandidateNational[0].factors.map((f) => f.key);
    expect(keys).toEqual(FACTOR_ORDER);
    const expected: FactorKey[] = [
      "stateBaseline",
      "candidateFit",
      "reach",
      "turnout",
      "swing",
      "spoiler",
      "nationalEnvironment",
      "campaign",
      "uncertainty",
    ];
    expect(new Set(keys)).toEqual(new Set(expected));
  });
});

describe("factorLedger bucket aggregation", () => {
  it("aggregates per-cell appeal to census buckets and normalizes shares", () => {
    const sink = createLedgerSink();
    // Cell A is entirely white/senior; cell B is entirely nonwhite/young.
    feedUnit(
      sink,
      "CA",
      "c1",
      [
        {
          votes: 300,
          demoEP: -2,
          demoSP: -1,
          base: 300,
          reachDelta: 0,
          fitDelta: 0,
          restDelta: 0,
          bucketWeights: { "race:white": 1, "age:senior": 1 },
        },
        {
          votes: 100,
          demoEP: 2,
          demoSP: 1,
          base: 100,
          reachDelta: 0,
          fitDelta: 0,
          restDelta: 0,
          bucketWeights: { "race:nonwhite": 1, "age:young": 1 },
        },
      ],
      { support: 1, swingDelta: 0, spoilerDelta: 0 },
      {
        strengthMultiplier: 1,
        referendum: 0,
        independent: 0,
        lean: 0,
        campaign: 0,
        finalVotes: 400,
      }
    );
    const ledger = assembleNationalLedger(sink, 1);
    const cand = ledger.byCandidateNational[0];
    const buckets = cand.bucketAppeal!;
    const totalShare = buckets.reduce((s, b) => s + b.appealShare, 0);
    // race:white + age:senior (300 each) + race:nonwhite + age:young (100 each)
    // total appeal-weighted votes = 800; each share is votes/800.
    expect(totalShare).toBeCloseTo(1, 6);
    const white = buckets.find((b) => b.bucket === "race:white")!;
    expect(white.appealShare).toBeCloseTo(300 / 800, 6);
    expect(white.demoEP).toBeCloseTo(-2, 6);
    expect(white.demoSP).toBeCloseTo(-1, 6);
  });

  it("emits no bucket appeal when the substrate provides no bucketWeights", () => {
    const sink = createLedgerSink();
    feedUnit(
      sink,
      "CA",
      "c1",
      [{ votes: 100, demoEP: 0, demoSP: 0, base: 100, reachDelta: 0, fitDelta: 0, restDelta: 0 }],
      { support: 1, swingDelta: 0, spoilerDelta: 0 },
      {
        strengthMultiplier: 1,
        referendum: 0,
        independent: 0,
        lean: 0,
        campaign: 0,
        finalVotes: 100,
      }
    );
    const ledger = assembleNationalLedger(sink, 1);
    expect(ledger.byCandidateNational[0].bucketAppeal).toBeUndefined();
  });
});

// ── Swing-flow integration: influence → reach, never candidateFit ────────────

function twoCandidates(nationalInfluenceC1: number): EnrichedCandidate[] {
  return [
    {
      candidateId: "c1",
      party: "dem",
      isNPP: false,
      politicalInfluence: 40,
      nationalInfluence: nationalInfluenceC1,
      favorability: 50,
      support: 50,
      charEP: -1,
      charSP: -1,
      partyEcon: -1,
      partySocial: -1,
      archetypeApprovals: {},
      infamy: 0,
    } as EnrichedCandidate,
    {
      candidateId: "c2",
      party: "rep",
      isNPP: false,
      politicalInfluence: 40,
      nationalInfluence: 40,
      favorability: 50,
      support: 50,
      charEP: 1,
      charSP: 1,
      partyEcon: 1,
      partySocial: 1,
      archetypeApprovals: {},
      infamy: 0,
    } as EnrichedCandidate,
  ];
}

function categories(): DemographicCategory[] {
  return [
    {
      _id: "income",
      name: "Income",
      groups: [
        {
          id: "low",
          name: "Low",
          defaultEconomicLean: -1,
          defaultSocialLean: 0,
          defaultTurnout: 60,
        },
        {
          id: "high",
          name: "High",
          defaultEconomicLean: 1,
          defaultSocialLean: 0,
          defaultTurnout: 60,
        },
      ],
    } as unknown as DemographicCategory,
  ];
}

function demographics(): StateDemographics {
  return {
    _id: "TS",
    categoryWeights: { income: 100 },
    groups: {
      low: { population: 50, turnout: 60, economicLean: -1, socialLean: 0 },
      high: { population: 50, turnout: 60, economicLean: 1, socialLean: 0 },
    },
  } as unknown as StateDemographics;
}

/** Neutral electorate (both groups lean 0) — so a uniform appeal makes the
 *  candidate-fit multiplier exactly influence-invariant. */
function neutralDemographics(): StateDemographics {
  return {
    _id: "TS",
    categoryWeights: { income: 100 },
    groups: {
      low: { population: 50, turnout: 60, economicLean: 0, socialLean: 0 },
      high: { population: 50, turnout: 60, economicLean: 0, socialLean: 0 },
    },
  } as unknown as StateDemographics;
}

/** Two centrist candidates differing only in c1's national influence. */
function centristCandidates(nationalInfluenceC1: number): EnrichedCandidate[] {
  const base = twoCandidates(nationalInfluenceC1);
  for (const ec of base) {
    ec.charEP = 0;
    ec.charSP = 0;
    ec.partyEcon = 0;
    ec.partySocial = 0;
  }
  return base;
}

/** Run one state through swing-flow with a ledger sink and finish the minimal
 *  post-swing-flow pipeline the presidential engine records (no shifts). */
function runWithLedger(enriched: EnrichedCandidate[], demo: StateDemographics = demographics()) {
  const sink = createLedgerSink();
  const cats = categories();
  // Census bucketWeights per group (cell) — the granular substrate supplies
  // these in production. Uses census dims only; never archetype ids.
  const bucketWeights = new Map<string, Record<string, number>>([
    ["low", { "race:white": 0.6, "race:nonwhite": 0.4 }],
    ["high", { "race:white": 0.8, "race:nonwhite": 0.2 }],
  ]);

  const { votesPerCandidate } = distributeVotesBySwingFlow(
    enriched,
    100_000,
    100_000,
    1_000_000,
    demo,
    cats,
    new Map(),
    {
      useAveragedPositions: true,
      partyPositionWeight: 1 / 3,
      includeInfluenceInAppeal: false,
      useNationalInfluenceForReach: true,
      isGeneralElection: true,
      votingSystem: "fptp",
      countryId: "US",
      ledgerSink: sink,
      ledgerUnitId: "TS",
      ledgerBucketWeightsByGroup: bucketWeights,
    }
  );

  // Minimal, neutral pipeline: no referendum/lean/campaign, strength 1.
  const engineVotes: Record<string, number> = {};
  for (const ec of enriched) {
    const votes = Math.round(votesPerCandidate[ec.candidateId] ?? 0);
    sink.setUnitTurnout("TS", 1);
    sink.recordReferendum("TS", ec.candidateId, 0);
    sink.recordIndependentPenalty("TS", ec.candidateId, 0);
    sink.recordLean("TS", ec.candidateId, 0);
    sink.recordCampaign("TS", ec.candidateId, 0);
    sink.recordFinalVotes("TS", ec.candidateId, votes);
    engineVotes[ec.candidateId] = votes;
  }
  return { sink, votesPerCandidate, engineVotes };
}

describe("factorLedger swing-flow integration", () => {
  it("is byte-identical with and without a sink (no behavior change)", () => {
    const enriched = twoCandidates(90);
    const opts = {
      useAveragedPositions: true,
      partyPositionWeight: 1 / 3,
      includeInfluenceInAppeal: false,
      useNationalInfluenceForReach: true,
      isGeneralElection: true,
      votingSystem: "fptp" as const,
      countryId: "US" as const,
    };
    const withoutSink = distributeVotesBySwingFlow(
      twoCandidates(90),
      100_000,
      100_000,
      1_000_000,
      demographics(),
      categories(),
      new Map(),
      opts
    );
    const sink = createLedgerSink();
    const withSink = distributeVotesBySwingFlow(
      enriched,
      100_000,
      100_000,
      1_000_000,
      demographics(),
      categories(),
      new Map(),
      { ...opts, ledgerSink: sink, ledgerUnitId: "TS" }
    );
    expect(withSink.votesPerCandidate).toEqual(withoutSink.votesPerCandidate);
    expect(withSink.sharesPct).toEqual(withoutSink.sharesPct);
  });

  it("reconstructs the swing-flow race exactly", () => {
    const { sink, engineVotes } = runWithLedger(twoCandidates(70));
    const ledger = assembleNationalLedger(sink, 500);
    expect(() => assertLedgerReconstructs(ledger, engineVotes)).not.toThrow();
  });

  it("routes name recognition into reach, not candidateFit", () => {
    const low = assembleNationalLedger(
      runWithLedger(centristCandidates(20), neutralDemographics()).sink,
      1
    );
    const high = assembleNationalLedger(
      runWithLedger(centristCandidates(95), neutralDemographics()).sink,
      1
    );

    const reachLow = low.byCandidateNational
      .find((c) => c.candidateId === "c1")!
      .factors.find((f) => f.key === "reach")!;
    const reachHigh = high.byCandidateNational
      .find((c) => c.candidateId === "c1")!
      .factors.find((f) => f.key === "reach")!;
    // Higher national influence must lift the reach factor.
    expect(reachHigh.voteDelta).toBeGreaterThan(reachLow.voteDelta);

    // Candidate-fit's effective multiplier is the pure appeal term — invariant
    // to the influence change (fit is decomposed before reach).
    const fitLow = low.byCandidateNational
      .find((c) => c.candidateId === "c1")!
      .factors.find((f) => f.key === "candidateFit")!;
    const fitHigh = high.byCandidateNational
      .find((c) => c.candidateId === "c1")!
      .factors.find((f) => f.key === "candidateFit")!;
    expect(fitHigh.multiplier).toBeCloseTo(fitLow.multiplier ?? 0, 6);
  });

  it("never emits an archetype key as a factor or a bucket", () => {
    const { sink } = runWithLedger(twoCandidates(80));
    const ledger = assembleNationalLedger(sink, 1);
    for (const cand of ledger.byCandidateNational) {
      for (const f of cand.factors) {
        expect(ARCHETYPE_IDS).not.toContain(f.key as string);
      }
      for (const b of cand.bucketAppeal ?? []) {
        for (const archetype of ARCHETYPE_IDS) {
          expect(b.bucket).not.toContain(archetype);
        }
        // Buckets are always "dimension:key" census pairs.
        expect(b.bucket).toMatch(/^[a-z]+:[a-z]+$/i);
      }
    }
  });
});
