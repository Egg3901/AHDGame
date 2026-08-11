import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";

vi.mock("@/lib/sovereignDefault/snapshotLoader", () => ({
  loadCountrySovereignSnapshot: vi.fn(),
}));
vi.mock("../getExecutiveLeaderProfile", () => ({
  getExecutiveLeaderProfile: vi.fn(),
}));

import { npcExecutiveAutoPropose } from "../npcExecutiveAutoPropose";
import { loadCountrySovereignSnapshot } from "@/lib/sovereignDefault/snapshotLoader";
import { getExecutiveLeaderProfile } from "../getExecutiveLeaderProfile";

function makeDb(opts: {
  budget?: Record<string, unknown> | null;
  decisionUpdateModified?: number;
}) {
  const decisionUpdates: Array<Record<string, unknown>> = [];
  const budgetUpdates: Array<Record<string, unknown>> = [];
  return {
    decisionUpdates,
    budgetUpdates,
    db: {
      collection: vi.fn((name: string) => {
        if (name === "federalBudget") {
          return {
            findOne: vi.fn().mockResolvedValue(opts.budget ?? null),
            updateOne: vi.fn(async (_f, u: Record<string, unknown>) => {
              budgetUpdates.push(u.$set as Record<string, unknown>);
              return { acknowledged: true, modifiedCount: 1 };
            }),
          };
        }
        if (name === "sovereignCrisisDecisions") {
          return {
            updateOne: vi.fn(async (_f, u: Record<string, unknown>) => {
              decisionUpdates.push(u.$set as Record<string, unknown>);
              return {
                acknowledged: true,
                modifiedCount: opts.decisionUpdateModified ?? 1,
              };
            }),
          };
        }
        throw new Error(`unexpected: ${name}`);
      }),
    } as never,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("npcExecutiveAutoPropose", () => {
  it("skips when executive is player-controlled", async () => {
    vi.mocked(getExecutiveLeaderProfile).mockResolvedValue({
      characterId: new ObjectId(),
      ideology: "centrist",
      governmentType: "democracy",
      kind: "player",
    });
    const { db, decisionUpdates } = makeDb({});
    const r = await npcExecutiveAutoPropose(db, {
      countryCode: "US",
      decisionId: new ObjectId(),
      currentTurn: 100,
      realtimeMs: Date.now(),
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("player-controlled");
    expect(decisionUpdates).toHaveLength(0);
  });

  it("auto-proposes when NPP-controlled", async () => {
    vi.mocked(getExecutiveLeaderProfile).mockResolvedValue({
      characterId: new ObjectId(),
      ideology: "centrist",
      governmentType: "democracy",
      kind: "npp",
    });
    vi.mocked(loadCountrySovereignSnapshot).mockResolvedValue({
      countryCode: "US",
      currentTurn: 100,
      debtToGdp: 0.6,
      inflationRate: 0.03,
      trust: 0.5,
      sovereignCouponRate: 0.04,
      fxDepreciationRate10t: 0,
      turnsSinceLastDefault: null,
      entityHoldings: 0,
      requiredIssuance: 1_000_000_000,
    } as never);
    const { db, decisionUpdates, budgetUpdates } = makeDb({
      budget: {
        _id: "federal",
        countryId: "US",
        currencyCode: "USD",
        economicFactors: { inflationRate: 3.0 },
      },
    });
    const r = await npcExecutiveAutoPropose(db, {
      countryCode: "US",
      decisionId: new ObjectId(),
      currentTurn: 100,
      realtimeMs: Date.now(),
    });
    expect(r.ok).toBe(true);
    expect(r.choice).toBeDefined();
    expect(decisionUpdates).toHaveLength(1);
    expect(decisionUpdates[0].state).toBe("executiveProposed");
    expect(budgetUpdates[0].sovereignCrisisState).toBe("crisisResolving");
  });

  it("auto-proposes when no leader at all (vacant office)", async () => {
    vi.mocked(getExecutiveLeaderProfile).mockResolvedValue({
      characterId: null,
      ideology: "centrist",
      governmentType: "democracy",
      kind: "none",
    });
    vi.mocked(loadCountrySovereignSnapshot).mockResolvedValue({
      countryCode: "US",
      currentTurn: 100,
      debtToGdp: 0.6,
      inflationRate: 0.03,
      trust: 0.5,
      sovereignCouponRate: 0.04,
      fxDepreciationRate10t: 0,
      turnsSinceLastDefault: null,
      entityHoldings: 0,
      requiredIssuance: 1_000_000_000,
    } as never);
    const { db, decisionUpdates } = makeDb({
      budget: {
        _id: "federal",
        countryId: "US",
        currencyCode: "USD",
        economicFactors: { inflationRate: 3.0 },
      },
    });
    const r = await npcExecutiveAutoPropose(db, {
      countryCode: "US",
      decisionId: new ObjectId(),
      currentTurn: 100,
      realtimeMs: Date.now(),
    });
    expect(r.ok).toBe(true);
    expect(decisionUpdates[0].state).toBe("executiveProposed");
  });

  it("returns no-budget when budget missing", async () => {
    vi.mocked(getExecutiveLeaderProfile).mockResolvedValue({
      characterId: null,
      ideology: "centrist",
      governmentType: "democracy",
      kind: "none",
    });
    const { db } = makeDb({ budget: null });
    const r = await npcExecutiveAutoPropose(db, {
      countryCode: "US",
      decisionId: new ObjectId(),
      currentTurn: 100,
      realtimeMs: Date.now(),
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("no-budget");
  });

  it("returns decision-not-open when decision already moved off open", async () => {
    vi.mocked(getExecutiveLeaderProfile).mockResolvedValue({
      characterId: null,
      ideology: "centrist",
      governmentType: "democracy",
      kind: "none",
    });
    vi.mocked(loadCountrySovereignSnapshot).mockResolvedValue({
      countryCode: "US",
      currentTurn: 100,
      debtToGdp: 0.6,
      inflationRate: 0.03,
      trust: 0.5,
      sovereignCouponRate: 0.04,
      fxDepreciationRate10t: 0,
      turnsSinceLastDefault: null,
      entityHoldings: 0,
      requiredIssuance: 1_000_000_000,
    } as never);
    const { db } = makeDb({
      budget: {
        _id: "federal",
        countryId: "US",
        currencyCode: "USD",
        economicFactors: { inflationRate: 3.0 },
      },
      decisionUpdateModified: 0,
    });
    const r = await npcExecutiveAutoPropose(db, {
      countryCode: "US",
      decisionId: new ObjectId(),
      currentTurn: 100,
      realtimeMs: Date.now(),
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("decision-not-open");
  });
});
