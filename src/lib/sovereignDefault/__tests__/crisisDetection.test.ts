import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";

vi.mock("../snapshotLoader", () => ({
  loadCountrySovereignSnapshot: vi.fn(),
}));
vi.mock("../requiredIssuance", () => ({
  computeRequiredIssuance: vi.fn(),
}));
vi.mock("../crisisNews", () => ({
  emitAuctionUndersubscribedNews: vi.fn().mockResolvedValue(undefined),
  emitAuctionFailedNews: vi.fn().mockResolvedValue(undefined),
  emitCrisisFiredNews: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../npc/npcExecutiveAutoPropose", () => ({
  // Default to no-op so existing crisisDetection tests don't need to mock the
  // characters/npps lookup chain. The auto-propose path has its own dedicated
  // tests in src/lib/sovereignDefault/npc/__tests__/.
  npcExecutiveAutoPropose: vi.fn().mockResolvedValue({ ok: false, reason: "player-controlled" }),
}));
vi.mock("../political/applyPopulistSurge", () => ({
  applyPopulistSurgeOnCrisis: vi.fn().mockResolvedValue({ npcsAffected: 0 }),
}));
// Default to player-enabled so the existing crisis-detection tests keep their
// pre-Phase-12-guard behavior. Specific tests below override this to `false`
// for the player-enabled gate.
vi.mock("@/lib/countryAccess", () => ({
  getCountryAccessFromDb: vi.fn().mockResolvedValue({
    enabledForPlayers: true,
    status: "active",
    economyPreview: false,
    registered: true,
    econOnly: false,
    nppGoverned: false,
  }),
}));

import type { Db } from "mongodb";
import { evaluateSovereignAuctionForCountry } from "../crisisDetection";
import { loadCountrySovereignSnapshot } from "../snapshotLoader";
import { computeRequiredIssuance } from "../requiredIssuance";
import {
  emitAuctionUndersubscribedNews,
  emitAuctionFailedNews,
  emitCrisisFiredNews,
} from "../crisisNews";
import { getCountryAccessFromDb } from "@/lib/countryAccess";

interface BudgetRow {
  _id: string;
  countryId: string;
  sovereignCrisisState?: string;
  failedAuctionConsecutiveCount?: number;
}

function makeMockDb(initialBudget: BudgetRow | null) {
  const budgetSetCalls: Array<Record<string, unknown>> = [];
  const decisionInserts: Array<Record<string, unknown>> = [];
  let currentBudget = initialBudget ? { ...initialBudget } : null;

  const db = {
    collection: vi.fn((name: string) => {
      if (name === "federalBudget") {
        return {
          findOne: vi.fn().mockResolvedValue(currentBudget),
          updateOne: vi.fn(async (_filter, update: Record<string, unknown>) => {
            budgetSetCalls.push(update.$set as Record<string, unknown>);
            if (currentBudget) {
              currentBudget = { ...currentBudget, ...(update.$set as Record<string, unknown>) };
            }
            return { acknowledged: true, modifiedCount: 1, matchedCount: 1 };
          }),
        };
      }
      if (name === "sovereignCrisisDecisions") {
        return {
          insertOne: vi.fn(async (doc) => {
            decisionInserts.push(doc as Record<string, unknown>);
            return { acknowledged: true, insertedId: new ObjectId() };
          }),
        };
      }
      throw new Error(`unexpected collection: ${name}`);
    }),
  } as unknown as Db;

  return { db, budgetSetCalls, decisionInserts };
}

beforeEach(() => {
  // Reset queued `mockResolvedValueOnce` entries so an early-return path in
  // one test doesn't leak unconsumed values to the next.
  vi.mocked(loadCountrySovereignSnapshot).mockReset();
  vi.mocked(computeRequiredIssuance).mockReset();
  vi.mocked(getCountryAccessFromDb).mockReset();
  // Re-apply the default-enabled return so the bulk of crisis-detection
  // tests don't have to set it per case. Disabled-gate tests below override
  // via `mockResolvedValueOnce`.
  vi.mocked(getCountryAccessFromDb).mockResolvedValue({
    enabledForPlayers: true,
    status: "active",
    economyPreview: false,
    registered: true,
    econOnly: false,
    nppGoverned: false,
  });
  vi.clearAllMocks();
});

describe("evaluateSovereignAuctionForCountry — early returns", () => {
  it("returns null when federal budget is missing", async () => {
    const { db } = makeMockDb(null);
    const result = await evaluateSovereignAuctionForCountry(db, "US", 600, 1_700_000_000_000);
    expect(result).toBeNull();
  });

  it("returns null and writes nothing when state is crisisPending", async () => {
    const { db, budgetSetCalls } = makeMockDb({
      _id: "federal",
      countryId: "US",
      sovereignCrisisState: "crisisPending",
    });
    const result = await evaluateSovereignAuctionForCountry(db, "US", 600, 1_700_000_000_000);
    expect(result).toBeNull();
    expect(budgetSetCalls).toHaveLength(0);
    expect(loadCountrySovereignSnapshot).not.toHaveBeenCalled();
  });

  it("returns null and writes nothing when state is crisisResolving", async () => {
    const { db, budgetSetCalls } = makeMockDb({
      _id: "federal",
      countryId: "US",
      sovereignCrisisState: "crisisResolving",
    });
    const result = await evaluateSovereignAuctionForCountry(db, "US", 600, 1_700_000_000_000);
    expect(result).toBeNull();
    expect(budgetSetCalls).toHaveLength(0);
  });

  it("returns null and writes nothing when state is recovering", async () => {
    const { db, budgetSetCalls } = makeMockDb({
      _id: "federal",
      countryId: "US",
      sovereignCrisisState: "recovering",
    });
    const result = await evaluateSovereignAuctionForCountry(db, "US", 600, 1_700_000_000_000);
    expect(result).toBeNull();
    expect(budgetSetCalls).toHaveLength(0);
  });

  it("returns null and writes nothing when there is no required issuance", async () => {
    const { db, budgetSetCalls } = makeMockDb({
      _id: "federal",
      countryId: "US",
      sovereignCrisisState: "normal",
    });
    vi.mocked(computeRequiredIssuance).mockResolvedValueOnce(0);

    const result = await evaluateSovereignAuctionForCountry(db, "US", 600, 1_700_000_000_000);
    expect(result).toBeNull();
    expect(budgetSetCalls).toHaveLength(0);
  });

  it("returns null when snapshot loader returns null", async () => {
    const { db, budgetSetCalls } = makeMockDb({
      _id: "federal",
      countryId: "US",
      sovereignCrisisState: "normal",
    });
    vi.mocked(computeRequiredIssuance).mockResolvedValueOnce(1_000_000_000);
    vi.mocked(loadCountrySovereignSnapshot).mockResolvedValueOnce(null);

    const result = await evaluateSovereignAuctionForCountry(db, "US", 600, 1_700_000_000_000);
    expect(result).toBeNull();
    expect(budgetSetCalls).toHaveLength(0);
  });
});

describe("evaluateSovereignAuctionForCountry — happy paths", () => {
  it("on fullySubscribed: resets counter, state stays normal, no news", async () => {
    const { db, budgetSetCalls, decisionInserts } = makeMockDb({
      _id: "federal",
      countryId: "US",
      sovereignCrisisState: "warning",
      failedAuctionConsecutiveCount: 2,
    });
    vi.mocked(computeRequiredIssuance).mockResolvedValueOnce(1_000_000_000);
    vi.mocked(loadCountrySovereignSnapshot).mockResolvedValueOnce({
      countryCode: "US",
      currentTurn: 600,
      debtToGdp: 0.5,
      inflationRate: 0.02,
      trust: 0.6,
      sovereignCouponRate: 4.0,
      fxDepreciationRate10t: 0,
      turnsSinceLastDefault: null,
      entityHoldings: 600_000_000,
      requiredIssuance: 1_000_000_000,
    });

    const result = await evaluateSovereignAuctionForCountry(db, "US", 600, 1_700_000_000_000);
    expect(result).not.toBeNull();
    expect(result!.outcome).toBe("fullySubscribed");
    expect(result!.firedThisEvaluation).toBe(false);
    expect(budgetSetCalls).toHaveLength(1);
    expect(budgetSetCalls[0].sovereignCrisisState).toBe("normal");
    expect(budgetSetCalls[0].failedAuctionConsecutiveCount).toBe(0);
    expect(decisionInserts).toHaveLength(0);
    expect(emitAuctionUndersubscribedNews).not.toHaveBeenCalled();
    expect(emitAuctionFailedNews).not.toHaveBeenCalled();
    expect(emitCrisisFiredNews).not.toHaveBeenCalled();
  });

  it("on undersubscribed: state -> warning, counter resets, undersubscribed news emitted", async () => {
    const { db, budgetSetCalls } = makeMockDb({
      _id: "federal",
      countryId: "US",
      sovereignCrisisState: "normal",
      failedAuctionConsecutiveCount: 0,
    });
    vi.mocked(computeRequiredIssuance).mockResolvedValueOnce(1_000_000_000);
    vi.mocked(loadCountrySovereignSnapshot).mockResolvedValueOnce({
      countryCode: "US",
      currentTurn: 600,
      debtToGdp: 1.5,
      inflationRate: 0.06,
      trust: 0.4,
      sovereignCouponRate: 4.0,
      fxDepreciationRate10t: 0.1,
      turnsSinceLastDefault: null,
      entityHoldings: 0,
      requiredIssuance: 1_000_000_000,
    });

    const result = await evaluateSovereignAuctionForCountry(db, "US", 600, 1_700_000_000_000);
    expect(result!.outcome).toBe("undersubscribed");
    expect(budgetSetCalls[0].sovereignCrisisState).toBe("warning");
    expect(budgetSetCalls[0].failedAuctionConsecutiveCount).toBe(0);
    expect(emitAuctionUndersubscribedNews).toHaveBeenCalledTimes(1);
  });

  it("on first failed auction: state -> warning, counter -> 1, failed news emitted", async () => {
    const { db, budgetSetCalls } = makeMockDb({
      _id: "federal",
      countryId: "US",
      sovereignCrisisState: "normal",
      failedAuctionConsecutiveCount: 0,
    });
    vi.mocked(computeRequiredIssuance).mockResolvedValueOnce(1_000_000_000);
    vi.mocked(loadCountrySovereignSnapshot).mockResolvedValueOnce({
      countryCode: "US",
      currentTurn: 600,
      debtToGdp: 3.0,
      inflationRate: 0.15,
      trust: 0.2,
      sovereignCouponRate: 4.0,
      fxDepreciationRate10t: 0.4,
      turnsSinceLastDefault: null,
      entityHoldings: 0,
      requiredIssuance: 1_000_000_000,
    });

    const result = await evaluateSovereignAuctionForCountry(db, "US", 600, 1_700_000_000_000);
    expect(result!.outcome).toBe("failed");
    expect(result!.firedThisEvaluation).toBe(false);
    expect(budgetSetCalls[0].sovereignCrisisState).toBe("warning");
    expect(budgetSetCalls[0].failedAuctionConsecutiveCount).toBe(1);
    expect(emitAuctionFailedNews).toHaveBeenCalledWith("US", expect.any(Number), 1);
  });

  it("on third consecutive failed auction: state -> crisisPending, FIRES, decision row inserted, crisisFired news emitted", async () => {
    const { db, budgetSetCalls, decisionInserts } = makeMockDb({
      _id: "federal",
      countryId: "US",
      sovereignCrisisState: "warning",
      failedAuctionConsecutiveCount: 2,
    });
    vi.mocked(computeRequiredIssuance).mockResolvedValueOnce(1_000_000_000);
    vi.mocked(loadCountrySovereignSnapshot).mockResolvedValueOnce({
      countryCode: "US",
      currentTurn: 600,
      debtToGdp: 3.0,
      inflationRate: 0.2,
      trust: 0.1,
      sovereignCouponRate: 4.0,
      fxDepreciationRate10t: 0.5,
      turnsSinceLastDefault: null,
      entityHoldings: 0,
      requiredIssuance: 1_000_000_000,
    });

    const result = await evaluateSovereignAuctionForCountry(db, "US", 600, 1_700_000_000_000);
    expect(result!.outcome).toBe("failed");
    expect(result!.firedThisEvaluation).toBe(true);
    expect(budgetSetCalls[0].sovereignCrisisState).toBe("crisisPending");
    expect(budgetSetCalls[0].failedAuctionConsecutiveCount).toBe(3);
    expect(budgetSetCalls[0].crisisFiredAt).toEqual({ turn: 600, realtimeMs: 1_700_000_000_000 });
    // 12-turn deadline (turn-first) + the 12h wall-clock fallback after fire
    expect(budgetSetCalls[0].crisisAutoActionAt).toEqual({
      turn: 600 + 12,
      realtimeMs: 1_700_000_000_000 + 12 * 60 * 60 * 1000,
    });
    expect(decisionInserts).toHaveLength(1);
    expect(decisionInserts[0]).toMatchObject({
      countryCode: "US",
      state: "open",
      firedAtTurn: 600,
      firedAtRealtimeMs: 1_700_000_000_000,
      executiveChoice: null,
    });
    expect(emitCrisisFiredNews).toHaveBeenCalledTimes(1);
    expect(emitAuctionFailedNews).not.toHaveBeenCalled();
  });
});

describe("evaluateSovereignAuctionForCountry — defensive defaults", () => {
  it("treats undefined sovereignCrisisState as 'normal'", async () => {
    const { db, budgetSetCalls } = makeMockDb({
      _id: "federal",
      countryId: "US",
      // sovereignCrisisState intentionally undefined
    });
    vi.mocked(computeRequiredIssuance).mockResolvedValueOnce(1_000_000_000);
    vi.mocked(loadCountrySovereignSnapshot).mockResolvedValueOnce({
      countryCode: "US",
      currentTurn: 600,
      debtToGdp: 0.5,
      inflationRate: 0.02,
      trust: 0.6,
      sovereignCouponRate: 4.0,
      fxDepreciationRate10t: 0,
      turnsSinceLastDefault: null,
      entityHoldings: 0,
      requiredIssuance: 1_000_000_000,
    });

    const result = await evaluateSovereignAuctionForCountry(db, "US", 600, 1_700_000_000_000);
    // demand here resolves to >= 1.0 → fullySubscribed path
    expect(result!.outcome).toBe("fullySubscribed");
    expect(budgetSetCalls[0].sovereignCrisisState).toBe("normal");
  });

  it("treats undefined failedAuctionConsecutiveCount as 0", async () => {
    const { db, budgetSetCalls } = makeMockDb({
      _id: "federal",
      countryId: "US",
      sovereignCrisisState: "normal",
      // failedAuctionConsecutiveCount undefined
    });
    vi.mocked(computeRequiredIssuance).mockResolvedValueOnce(1_000_000_000);
    vi.mocked(loadCountrySovereignSnapshot).mockResolvedValueOnce({
      countryCode: "US",
      currentTurn: 600,
      debtToGdp: 5.0,
      inflationRate: 0.5,
      trust: 0.0,
      sovereignCouponRate: 0.0,
      fxDepreciationRate10t: 0.8,
      turnsSinceLastDefault: null,
      entityHoldings: 0,
      requiredIssuance: 1_000_000_000,
    });

    const result = await evaluateSovereignAuctionForCountry(db, "US", 600, 1_700_000_000_000);
    expect(result!.outcome).toBe("failed");
    expect(result!.newConsecutiveFailedCount).toBe(1);
    expect(budgetSetCalls[0].failedAuctionConsecutiveCount).toBe(1);
  });
});

describe("evaluateSovereignAuctionForCountry — player-enabled gate (Phase 12)", () => {
  it("a Coming-Soon country with a failed auction stays out of the trigger pipeline", async () => {
    vi.mocked(getCountryAccessFromDb).mockResolvedValueOnce({
      enabledForPlayers: false,
      status: "coming-soon",
      economyPreview: false,
      registered: true,
      econOnly: true,
      nppGoverned: false,
    });
    const { db, budgetSetCalls, decisionInserts } = makeMockDb({
      _id: "federal",
      countryId: "NG",
      sovereignCrisisState: "normal",
      failedAuctionConsecutiveCount: 0,
    });
    vi.mocked(computeRequiredIssuance).mockResolvedValue(1_000_000_000);
    vi.mocked(loadCountrySovereignSnapshot).mockResolvedValue({
      countryCode: "NG",
      currentTurn: 600,
      debtToGdp: 2.5,
      inflationRate: 0.4,
      trust: 0.0,
      sovereignCouponRate: 0.0,
      fxDepreciationRate10t: 0.8,
      turnsSinceLastDefault: null,
      entityHoldings: 0,
      requiredIssuance: 1_000_000_000,
    });

    const result = await evaluateSovereignAuctionForCountry(db, "NG", 600, 1_700_000_000_000);

    expect(result).not.toBeNull();
    expect(result!.firedThisEvaluation).toBe(false);
    expect(result!.nextState).toBe("normal");
    // Counter must NOT increment while the country is disabled — toggling
    // Players Enabled later shouldn't replay accumulated failed auctions.
    expect(result!.newConsecutiveFailedCount).toBe(0);
    // Demand ratio is still persisted so DSA / Sovereign Debt Watch can score
    // the country.
    expect(budgetSetCalls).toHaveLength(1);
    expect(budgetSetCalls[0].lastAuctionDemandRatio).toBeDefined();
    expect(budgetSetCalls[0].failedAuctionConsecutiveCount).toBeUndefined();
    expect(budgetSetCalls[0].sovereignCrisisState).toBeUndefined();
    expect(decisionInserts).toHaveLength(0);
    expect(emitCrisisFiredNews).not.toHaveBeenCalled();
  });

  it("a disabled country sitting on 2 prior failed auctions does not tip into crisisPending on the third", async () => {
    vi.mocked(getCountryAccessFromDb).mockResolvedValueOnce({
      enabledForPlayers: false,
      status: "coming-soon",
      economyPreview: false,
      registered: true,
      econOnly: true,
      nppGoverned: false,
    });
    const { db, budgetSetCalls, decisionInserts } = makeMockDb({
      _id: "federal",
      countryId: "NG",
      sovereignCrisisState: "warning",
      // 2 prior failed auctions accumulated before the player-enabled flag was
      // flipped off — the third must NOT fire while disabled.
      failedAuctionConsecutiveCount: 2,
    });
    vi.mocked(computeRequiredIssuance).mockResolvedValue(1_000_000_000);
    vi.mocked(loadCountrySovereignSnapshot).mockResolvedValue({
      countryCode: "NG",
      currentTurn: 600,
      debtToGdp: 2.5,
      inflationRate: 0.4,
      trust: 0.0,
      sovereignCouponRate: 0.0,
      fxDepreciationRate10t: 0.8,
      turnsSinceLastDefault: null,
      entityHoldings: 0,
      requiredIssuance: 1_000_000_000,
    });

    const result = await evaluateSovereignAuctionForCountry(db, "NG", 600, 1_700_000_000_000);

    expect(result!.firedThisEvaluation).toBe(false);
    expect(result!.newConsecutiveFailedCount).toBe(2);
    expect(decisionInserts).toHaveLength(0);
    // Counter is preserved on the budget — neither incremented nor reset.
    expect(budgetSetCalls[0].failedAuctionConsecutiveCount).toBeUndefined();
  });

  it("a player-enabled country fires normally on the third failed auction", async () => {
    // Default mock returns enabledForPlayers=true; this is the regression
    // baseline ensuring the gate doesn't break the happy path.
    const { db, decisionInserts } = makeMockDb({
      _id: "federal",
      countryId: "US",
      sovereignCrisisState: "warning",
      failedAuctionConsecutiveCount: 2,
    });
    vi.mocked(computeRequiredIssuance).mockResolvedValue(1_000_000_000);
    vi.mocked(loadCountrySovereignSnapshot).mockResolvedValue({
      countryCode: "US",
      currentTurn: 600,
      debtToGdp: 2.5,
      inflationRate: 0.4,
      trust: 0.0,
      sovereignCouponRate: 0.0,
      fxDepreciationRate10t: 0.8,
      turnsSinceLastDefault: null,
      entityHoldings: 0,
      requiredIssuance: 1_000_000_000,
    });

    const result = await evaluateSovereignAuctionForCountry(db, "US", 600, 1_700_000_000_000);

    expect(result!.firedThisEvaluation).toBe(true);
    expect(result!.nextState).toBe("crisisPending");
    expect(result!.newConsecutiveFailedCount).toBe(3);
    expect(decisionInserts).toHaveLength(1);
  });
});

describe("evaluateSovereignAuctionForCountry — autonomous NPP-governed eligibility (refs #3236)", () => {
  // Snapshot fundamentals bad enough to fail the auction regardless of the
  // debt band (inflation 40%, FX -80%, trust 0), so the debtToGdp knob alone
  // decides gate eligibility in these tests.
  const distressedSnapshot = (debtToGdp: number) => ({
    countryCode: "DD",
    currentTurn: 600,
    debtToGdp,
    inflationRate: 0.4,
    trust: 0.0,
    sovereignCouponRate: 0.0,
    fxDepreciationRate10t: 0.8,
    turnsSinceLastDefault: null,
    entityHoldings: 0,
    requiredIssuance: 1_000_000_000,
  });

  const nppGovernedAccess = {
    enabledForPlayers: false,
    status: "coming-soon" as const,
    economyPreview: false,
    registered: true,
    econOnly: true,
    nppGoverned: true,
  };

  it("an NPP-governed country at extreme debt/GDP increments the failed-auction counter", async () => {
    vi.mocked(getCountryAccessFromDb).mockResolvedValueOnce(nppGovernedAccess);
    const { db, budgetSetCalls, decisionInserts } = makeMockDb({
      _id: "DD",
      countryId: "DD",
      sovereignCrisisState: "normal",
      failedAuctionConsecutiveCount: 0,
    });
    vi.mocked(computeRequiredIssuance).mockResolvedValue(1_000_000_000);
    vi.mocked(loadCountrySovereignSnapshot).mockResolvedValue(distressedSnapshot(3.0));

    const result = await evaluateSovereignAuctionForCountry(db, "DD", 600, 1_700_000_000_000);

    expect(result!.outcome).toBe("failed");
    expect(result!.newConsecutiveFailedCount).toBe(1);
    expect(result!.nextState).toBe("warning");
    expect(budgetSetCalls[0].failedAuctionConsecutiveCount).toBe(1);
    // First fail only counts — no crisis yet.
    expect(decisionInserts).toHaveLength(0);
  });

  it("an NPP-governed country at extreme debt/GDP fires the crisis on the third consecutive fail", async () => {
    vi.mocked(getCountryAccessFromDb).mockResolvedValueOnce(nppGovernedAccess);
    const { db, budgetSetCalls, decisionInserts } = makeMockDb({
      _id: "DD",
      countryId: "DD",
      sovereignCrisisState: "warning",
      failedAuctionConsecutiveCount: 2,
    });
    vi.mocked(computeRequiredIssuance).mockResolvedValue(1_000_000_000);
    vi.mocked(loadCountrySovereignSnapshot).mockResolvedValue(distressedSnapshot(3.0));

    const result = await evaluateSovereignAuctionForCountry(db, "DD", 600, 1_700_000_000_000);

    expect(result!.firedThisEvaluation).toBe(true);
    expect(result!.nextState).toBe("crisisPending");
    expect(result!.newConsecutiveFailedCount).toBe(3);
    expect(budgetSetCalls[0].sovereignCrisisState).toBe("crisisPending");
    expect(decisionInserts).toHaveLength(1);
    expect(emitCrisisFiredNews).toHaveBeenCalled();
  });

  it("an NPP-governed country BELOW the extreme band keeps the old disabled-country skip", async () => {
    vi.mocked(getCountryAccessFromDb).mockResolvedValueOnce(nppGovernedAccess);
    const { db, budgetSetCalls, decisionInserts } = makeMockDb({
      _id: "DD",
      countryId: "DD",
      sovereignCrisisState: "normal",
      failedAuctionConsecutiveCount: 0,
    });
    vi.mocked(computeRequiredIssuance).mockResolvedValue(1_000_000_000);
    // 190% debt/GDP + awful fundamentals would fail the auction, but the
    // country is under AUTONOMOUS_CRISIS_MIN_DEBT_TO_GDP — no counter movement.
    vi.mocked(loadCountrySovereignSnapshot).mockResolvedValue(distressedSnapshot(1.9));

    const result = await evaluateSovereignAuctionForCountry(db, "DD", 600, 1_700_000_000_000);

    expect(result!.firedThisEvaluation).toBe(false);
    expect(result!.newConsecutiveFailedCount).toBe(0);
    expect(result!.nextState).toBe("normal");
    expect(budgetSetCalls).toHaveLength(1);
    expect(budgetSetCalls[0].failedAuctionConsecutiveCount).toBeUndefined();
    expect(budgetSetCalls[0].sovereignCrisisState).toBeUndefined();
    expect(budgetSetCalls[0].lastAuctionDemandRatio).toBeDefined();
    expect(decisionInserts).toHaveLength(0);
  });

  it("a disabled country WITHOUT NPP governance stays skipped even at extreme debt/GDP", async () => {
    vi.mocked(getCountryAccessFromDb).mockResolvedValueOnce({
      ...nppGovernedAccess,
      nppGoverned: false,
    });
    const { db, budgetSetCalls, decisionInserts } = makeMockDb({
      _id: "DD",
      countryId: "DD",
      sovereignCrisisState: "normal",
      failedAuctionConsecutiveCount: 0,
    });
    vi.mocked(computeRequiredIssuance).mockResolvedValue(1_000_000_000);
    vi.mocked(loadCountrySovereignSnapshot).mockResolvedValue(distressedSnapshot(3.0));

    const result = await evaluateSovereignAuctionForCountry(db, "DD", 600, 1_700_000_000_000);

    expect(result!.firedThisEvaluation).toBe(false);
    expect(result!.newConsecutiveFailedCount).toBe(0);
    expect(budgetSetCalls[0].failedAuctionConsecutiveCount).toBeUndefined();
    expect(decisionInserts).toHaveLength(0);
  });

  it("guard: an NPP-governed country with healthy ratios produces zero state change", async () => {
    vi.mocked(getCountryAccessFromDb).mockResolvedValueOnce(nppGovernedAccess);
    const { db, budgetSetCalls, decisionInserts } = makeMockDb({
      _id: "DD",
      countryId: "DD",
      sovereignCrisisState: "normal",
      failedAuctionConsecutiveCount: 0,
    });
    vi.mocked(computeRequiredIssuance).mockResolvedValue(1_000_000_000);
    vi.mocked(loadCountrySovereignSnapshot).mockResolvedValue({
      countryCode: "DD",
      currentTurn: 600,
      debtToGdp: 0.5,
      inflationRate: 0.02,
      trust: 0.5,
      sovereignCouponRate: 5.0,
      fxDepreciationRate10t: 0,
      turnsSinceLastDefault: null,
      entityHoldings: 0,
      requiredIssuance: 1_000_000_000,
    });

    const result = await evaluateSovereignAuctionForCountry(db, "DD", 600, 1_700_000_000_000);

    expect(result!.firedThisEvaluation).toBe(false);
    expect(result!.newConsecutiveFailedCount).toBe(0);
    expect(result!.nextState).toBe("normal");
    expect(budgetSetCalls[0].failedAuctionConsecutiveCount).toBeUndefined();
    expect(budgetSetCalls[0].sovereignCrisisState).toBeUndefined();
    expect(decisionInserts).toHaveLength(0);
  });
});
