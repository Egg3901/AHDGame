/**
 * Phase 10 end-to-end integration scenarios.
 *
 * Validates the NPC pipeline composes correctly:
 *   - getExecutiveLeaderProfile → chooseResolution (executive choice)
 *   - npcExecutiveAutoPropose → decision moves to executiveProposed + budget
 *     to crisisResolving + lower-chamber phase opened
 *   - runNpcLegislatorAutoVote across NPP chamber → vote tallies update
 *
 * Heavy mock pattern: avoids MongoMemoryServer to match existing test
 * conventions. Each scenario stubs the DB collections it needs.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";

vi.mock("@/lib/sovereignDefault/snapshotLoader", () => ({
  loadCountrySovereignSnapshot: vi.fn(),
}));

import { npcExecutiveAutoPropose } from "../npc/npcExecutiveAutoPropose";
import { runNpcLegislatorAutoVote } from "../npc/npcLegislatorAutoVote";
import { loadCountrySovereignSnapshot } from "../snapshotLoader";
import { tallyChamberOutcome } from "../legislative/tallyChamberOutcome";
import type { SovereignCrisisDecision } from "@/lib/db/types/sovereignCrisisDecision";

interface ScenarioFixture {
  budget: Record<string, unknown>;
  characterExecutive?: Record<string, unknown> | null;
  nppExecutive?: Record<string, unknown> | null;
  chamberNpps: Array<Record<string, unknown>>;
}

function makeScenarioDb(fx: ScenarioFixture) {
  const decisionRow: Partial<SovereignCrisisDecision> & { _id: ObjectId } = {
    _id: new ObjectId(),
    countryCode: "US",
    state: "open",
    firedAtTurn: 100,
    firedAtRealtimeMs: Date.now(),
    executiveChoice: null,
    executiveProposedAtRealtimeMs: null,
    requiresLegislativeRatification: true,
    legislativeBillId: null,
    resolvedAt: null,
    resolvedReason: null,
    createdAt: new Date(),
  };
  let budget = { ...fx.budget };
  return {
    decisionRow,
    getDecision: () => decisionRow,
    getBudget: () => budget,
    db: {
      collection: vi.fn((name: string) => {
        if (name === "characters") {
          return {
            findOne: vi.fn().mockResolvedValue(fx.characterExecutive ?? null),
          };
        }
        if (name === "npps") {
          return {
            findOne: vi.fn().mockResolvedValue(fx.nppExecutive ?? null),
            find: vi.fn().mockReturnValue({
              toArray: vi.fn().mockResolvedValue(fx.chamberNpps),
            }),
          };
        }
        if (name === "federalBudget") {
          return {
            findOne: vi.fn().mockImplementation(async () => budget),
            updateOne: vi.fn(async (_f, u: Record<string, unknown>) => {
              budget = { ...budget, ...(u.$set as object) };
              return { acknowledged: true, modifiedCount: 1 };
            }),
          };
        }
        if (name === "sovereignCrisisDecisions") {
          return {
            updateOne: vi.fn(
              async (filter: { _id: ObjectId; state?: string }, u: Record<string, unknown>) => {
                if (filter.state && decisionRow.state !== filter.state) {
                  return { acknowledged: true, modifiedCount: 0 };
                }
                const $set = u.$set as Record<string, unknown> | undefined;
                const $inc = u.$inc as Record<string, unknown> | undefined;
                if ($set) {
                  for (const [k, v] of Object.entries($set)) {
                    // Handle dotted-path keys (votes map + counters)
                    if (k.includes(".")) {
                      // Constraint: dotted path on votes set must not already exist.
                      const parts = k.split(".");
                      // walk into decisionRow
                      let obj = decisionRow as unknown as Record<string, unknown>;
                      for (let i = 0; i < parts.length - 1; i++) {
                        const key = parts[i];
                        const next = obj[key];
                        if (typeof next !== "object" || next === null) {
                          // Index? skip simulation; treat as miss.
                          return { acknowledged: true, modifiedCount: 0 };
                        }
                        obj = next as Record<string, unknown>;
                      }
                      const last = parts[parts.length - 1];
                      // Atomic-no-overwrite filter from vote endpoint:
                      // updateOne filter has {[k]: { $exists: false }}. Honor it.
                      const filterAsObj = filter as unknown as Record<string, unknown>;
                      const fileFilter = filterAsObj[k] as { $exists?: boolean } | undefined;
                      if (fileFilter?.$exists === false && obj[last] !== undefined) {
                        return { acknowledged: true, modifiedCount: 0 };
                      }
                      obj[last] = v;
                    } else {
                      (decisionRow as Record<string, unknown>)[k] = v;
                    }
                  }
                }
                if ($inc) {
                  for (const [k, v] of Object.entries($inc)) {
                    const parts = k.split(".");
                    let obj = decisionRow as unknown as Record<string, unknown>;
                    for (let i = 0; i < parts.length - 1; i++) {
                      obj = obj[parts[i]] as Record<string, unknown>;
                    }
                    const last = parts[parts.length - 1];
                    obj[last] = ((obj[last] as number) ?? 0) + (v as number);
                  }
                }
                return { acknowledged: true, modifiedCount: 1 };
              }
            ),
          };
        }
        throw new Error(`unexpected collection: ${name}`);
      }),
    } as never,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Phase 10 E2E — NPC democracy with high inflation", () => {
  it("monetize gated → scoring picks bailout/restructure; NPP chamber auto-votes for; tally passes", async () => {
    vi.mocked(loadCountrySovereignSnapshot).mockResolvedValue({
      countryCode: "US",
      currentTurn: 100,
      debtToGdp: 0.8,
      inflationRate: 0.09, // 9% — gates monetize
      trust: 0.5,
      sovereignCouponRate: 0.04,
      fxDepreciationRate10t: 0,
      turnsSinceLastDefault: null,
      entityHoldings: 0,
      requiredIssuance: 1_000_000_000,
    } as never);
    const fx = makeScenarioDb({
      budget: {
        _id: "federal",
        countryId: "US",
        currencyCode: "USD",
        economicFactors: { inflationRate: 9.0 },
      },
      characterExecutive: null,
      nppExecutive: {
        _id: new ObjectId(),
        policies: { economic: 30, social: 0 }, // technocrat-leaning
        currentOffice: { type: "president" },
      },
      chamberNpps: [
        // 5 free-market NPPs (bailout-supporters)
        ...Array.from({ length: 5 }, () => ({
          _id: new ObjectId(),
          countryId: "US",
          currentOffice: { type: "house" },
          policies: { economic: 60, social: 0 },
          personality: { loyalty: 70, ambition: 50, stubbornness: 50 },
        })),
        // 1 populist NPP (against)
        {
          _id: new ObjectId(),
          countryId: "US",
          currentOffice: { type: "house" },
          policies: { economic: -70, social: 50 },
          personality: { loyalty: 30, ambition: 50, stubbornness: 50 },
        },
      ],
    });

    const propose = await npcExecutiveAutoPropose(fx.db, {
      countryCode: "US",
      decisionId: fx.decisionRow._id,
      currentTurn: 100,
      realtimeMs: Date.now(),
    });
    expect(propose.ok).toBe(true);
    // monetize must be excluded by the inflation gate
    expect(propose.choice).not.toBe("monetize");

    expect(fx.getDecision().state).toBe("executiveProposed");
    expect(fx.getBudget().sovereignCrisisState).toBe("crisisResolving");

    // Run NPC chamber auto-vote
    const decisionAfterPropose = fx.getDecision() as SovereignCrisisDecision;
    const voteReport = await runNpcLegislatorAutoVote(fx.db, {
      decision: decisionAfterPropose,
      chamberIndex: 0,
      countryCode: "US",
    });
    expect(voteReport.npcsVoted).toBe(6);

    // Tally now: 5 free-market NPPs likely vote "for" (bailout/restructure
    // alignment), 1 populist likely "against". Outcome: passed.
    const finalDecision = fx.getDecision() as SovereignCrisisDecision;
    const phase = finalDecision.legislativePhases![0];
    expect(phase.votesFor + phase.votesAgainst).toBe(6);
    expect(tallyChamberOutcome(phase)).toBe("passed");
  });
});

describe("Phase 10 E2E — NPC nationalist with extreme D/GDP", () => {
  it("scoring picks repudiate; populist-majority chamber auto-votes for", async () => {
    vi.mocked(loadCountrySovereignSnapshot).mockResolvedValue({
      countryCode: "US",
      currentTurn: 100,
      debtToGdp: 3.5, // very high
      inflationRate: 0.04,
      trust: 0.4,
      sovereignCouponRate: 0.06,
      fxDepreciationRate10t: 0,
      turnsSinceLastDefault: null,
      entityHoldings: 0,
      requiredIssuance: 1_000_000_000,
    } as never);
    const fx = makeScenarioDb({
      budget: {
        _id: "federal",
        countryId: "US",
        currencyCode: "USD",
        economicFactors: { inflationRate: 4.0 },
      },
      characterExecutive: null,
      nppExecutive: {
        _id: new ObjectId(),
        policies: { economic: 0, social: 70 }, // nationalist
        currentOffice: { type: "president" },
      },
      chamberNpps: Array.from({ length: 6 }, () => ({
        _id: new ObjectId(),
        countryId: "US",
        currentOffice: { type: "house" },
        policies: { economic: -60, social: 60 }, // populist-nationalist
        personality: { loyalty: 60, ambition: 50, stubbornness: 50 },
      })),
    });
    const propose = await npcExecutiveAutoPropose(fx.db, {
      countryCode: "US",
      decisionId: fx.decisionRow._id,
      currentTurn: 100,
      realtimeMs: Date.now(),
    });
    expect(propose.ok).toBe(true);
    expect(propose.choice).toBe("repudiate");

    const decisionAfterPropose = fx.getDecision() as SovereignCrisisDecision;
    const r = await runNpcLegislatorAutoVote(fx.db, {
      decision: decisionAfterPropose,
      chamberIndex: 0,
      countryCode: "US",
    });
    expect(r.npcsVoted).toBe(6);

    const finalPhase = (fx.getDecision() as SovereignCrisisDecision).legislativePhases![0];
    expect(tallyChamberOutcome(finalPhase)).toBe("passed");
  });
});

describe("Phase 10 E2E — Player executive skips auto-propose", () => {
  it("auto-propose returns player-controlled, decision stays open", async () => {
    const fx = makeScenarioDb({
      budget: {
        _id: "federal",
        countryId: "US",
        currencyCode: "USD",
        economicFactors: { inflationRate: 3.0 },
      },
      characterExecutive: {
        _id: new ObjectId(),
        countryId: "US",
        currentOffice: { type: "president" },
        policies: { economic: 0, social: 0 },
      },
      chamberNpps: [],
    });

    const propose = await npcExecutiveAutoPropose(fx.db, {
      countryCode: "US",
      decisionId: fx.decisionRow._id,
      currentTurn: 100,
      realtimeMs: Date.now(),
    });
    expect(propose.ok).toBe(false);
    expect(propose.reason).toBe("player-controlled");
    // Decision row should NOT have been mutated.
    expect(fx.getDecision().state).toBe("open");
    expect(fx.getBudget().sovereignCrisisState).toBeUndefined();
  });
});
