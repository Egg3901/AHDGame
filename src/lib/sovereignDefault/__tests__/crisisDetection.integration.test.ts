import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";

vi.mock("../snapshotLoader", () => ({
  loadCountrySovereignSnapshot: vi.fn(),
}));
vi.mock("../requiredIssuance", () => ({
  computeRequiredIssuance: vi.fn().mockResolvedValue(1_000_000_000),
}));
vi.mock("../crisisNews", () => ({
  emitAuctionUndersubscribedNews: vi.fn().mockResolvedValue(undefined),
  emitAuctionFailedNews: vi.fn().mockResolvedValue(undefined),
  emitCrisisFiredNews: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../npc/npcExecutiveAutoPropose", () => ({
  npcExecutiveAutoPropose: vi.fn().mockResolvedValue({ ok: false, reason: "player-controlled" }),
}));
vi.mock("../political/applyPopulistSurge", () => ({
  applyPopulistSurgeOnCrisis: vi.fn().mockResolvedValue({ npcsAffected: 0 }),
}));
// Phase 12 player-enabled gate. These integration scenarios exercise the
// fully-enabled path; the dedicated unit tests in crisisDetection.test.ts
// cover the gated path (status: "coming-soon").
vi.mock("@/lib/countryAccess", () => ({
  getCountryAccessFromDb: vi.fn().mockResolvedValue({
    enabledForPlayers: true,
    status: "active",
    economyPreview: false,
  }),
}));

import type { Db } from "mongodb";
import { evaluateSovereignAuctionForCountry } from "../crisisDetection";
import { loadCountrySovereignSnapshot } from "../snapshotLoader";

interface FakeBudgetRow {
  _id: string;
  countryId: string;
  sovereignCrisisState?: string;
  failedAuctionConsecutiveCount?: number;
  lastAuctionDemandRatio?: number;
  crisisFiredAt?: { turn: number; realtimeMs: number };
  crisisAutoActionAt?: { realtimeMs: number };
}

function makeStatefulMockDb(initial: FakeBudgetRow) {
  let row: FakeBudgetRow = { ...initial };
  const decisions: Array<Record<string, unknown>> = [];
  const db = {
    collection: vi.fn((name: string) => {
      if (name === "federalBudget") {
        return {
          findOne: vi.fn().mockImplementation(async () => row),
          updateOne: vi.fn(async (_filter, update: Record<string, unknown>) => {
            row = { ...row, ...(update.$set as object) };
            return { acknowledged: true, modifiedCount: 1, matchedCount: 1 };
          }),
        };
      }
      if (name === "sovereignCrisisDecisions") {
        return {
          insertOne: vi.fn(async (doc) => {
            decisions.push(doc as Record<string, unknown>);
            return { acknowledged: true, insertedId: new ObjectId() };
          }),
        };
      }
      throw new Error(`unexpected: ${name}`);
    }),
  } as unknown as Db;
  return { db, getRow: () => row, getDecisions: () => decisions };
}

const FAILING_SNAP = {
  countryCode: "US",
  currentTurn: 0,
  debtToGdp: 5.0,
  inflationRate: 0.5,
  trust: 0.0,
  sovereignCouponRate: 0.0,
  fxDepreciationRate10t: 0.8,
  turnsSinceLastDefault: null,
  entityHoldings: 0,
  requiredIssuance: 1_000_000_000,
};

const HEALTHY_SNAP = {
  ...FAILING_SNAP,
  debtToGdp: 0.4,
  inflationRate: 0.02,
  trust: 0.7,
  sovereignCouponRate: 4.0,
  fxDepreciationRate10t: 0,
};

beforeEach(() => {
  // Reset both call history AND queued implementations so leftover
  // `mockResolvedValueOnce` entries from a previous test don't leak.
  vi.mocked(loadCountrySovereignSnapshot).mockReset();
  vi.clearAllMocks();
});

describe("crisisDetection — multi-fiscal-year scenarios", () => {
  it("3 consecutive failed auctions fires the crisis exactly once", async () => {
    const { db, getRow, getDecisions } = makeStatefulMockDb({
      _id: "federal",
      countryId: "US",
      sovereignCrisisState: "normal",
      failedAuctionConsecutiveCount: 0,
    });

    vi.mocked(loadCountrySovereignSnapshot).mockResolvedValue({ ...FAILING_SNAP });

    const turns = [40, 80, 120];
    const realtime = 1_700_000_000_000;
    const results = [];
    for (const turn of turns) {
      results.push(
        await evaluateSovereignAuctionForCountry(db, "US", turn, realtime + turn * 1000)
      );
    }

    expect(results.map((r) => r!.outcome)).toEqual(["failed", "failed", "failed"]);
    expect(results.map((r) => r!.firedThisEvaluation)).toEqual([false, false, true]);
    expect(results.map((r) => r!.nextState)).toEqual(["warning", "warning", "crisisPending"]);
    expect(getRow().failedAuctionConsecutiveCount).toBe(3);
    expect(getDecisions()).toHaveLength(1);
    expect(getRow().crisisFiredAt).toEqual({
      turn: 120,
      realtimeMs: realtime + 120 * 1000,
    });
  });

  it("a healthy auction between two failures resets the counter", async () => {
    const { db, getRow, getDecisions } = makeStatefulMockDb({
      _id: "federal",
      countryId: "US",
      sovereignCrisisState: "normal",
      failedAuctionConsecutiveCount: 0,
    });

    vi.mocked(loadCountrySovereignSnapshot)
      .mockResolvedValueOnce({ ...FAILING_SNAP })
      .mockResolvedValueOnce({ ...HEALTHY_SNAP })
      .mockResolvedValueOnce({ ...FAILING_SNAP });

    await evaluateSovereignAuctionForCountry(db, "US", 40, 1_700_000_000_000);
    await evaluateSovereignAuctionForCountry(db, "US", 80, 1_700_000_000_000);
    await evaluateSovereignAuctionForCountry(db, "US", 120, 1_700_000_000_000);

    expect(getRow().failedAuctionConsecutiveCount).toBe(1);
    expect(getRow().sovereignCrisisState).toBe("warning");
    expect(getDecisions()).toHaveLength(0);
  });

  it("once in crisisPending, further evaluations are no-ops", async () => {
    const { db, getRow, getDecisions } = makeStatefulMockDb({
      _id: "federal",
      countryId: "US",
      sovereignCrisisState: "warning",
      failedAuctionConsecutiveCount: 2,
    });

    vi.mocked(loadCountrySovereignSnapshot)
      .mockResolvedValueOnce({ ...FAILING_SNAP })
      .mockResolvedValueOnce({ ...HEALTHY_SNAP });

    await evaluateSovereignAuctionForCountry(db, "US", 40, 1_700_000_000_000);
    expect(getRow().sovereignCrisisState).toBe("crisisPending");

    const noopResult = await evaluateSovereignAuctionForCountry(db, "US", 80, 1_700_000_000_000);
    expect(noopResult).toBeNull();
    expect(getRow().sovereignCrisisState).toBe("crisisPending");
    expect(getDecisions()).toHaveLength(1);
  });

  it("an undersubscribed auction between failures resets the counter", async () => {
    const { db, getRow } = makeStatefulMockDb({
      _id: "federal",
      countryId: "US",
      sovereignCrisisState: "normal",
      failedAuctionConsecutiveCount: 0,
    });

    // Calibrated to land in [0.7, 1.0): debtToGdp drops some demand, but
    // moderate inflation and entity holdings prop it back into the
    // 'undersubscribed' band rather than 'failed'.
    const UNDERSUBSCRIBED_SNAP = {
      ...FAILING_SNAP,
      debtToGdp: 1.5,
      inflationRate: 0.05,
      trust: 0.5,
      sovereignCouponRate: 4.0,
      fxDepreciationRate10t: 0.05,
      entityHoldings: 0,
    };

    vi.mocked(loadCountrySovereignSnapshot)
      .mockResolvedValueOnce({ ...FAILING_SNAP })
      .mockResolvedValueOnce(UNDERSUBSCRIBED_SNAP)
      .mockResolvedValueOnce({ ...FAILING_SNAP });

    const r1 = await evaluateSovereignAuctionForCountry(db, "US", 40, 1_700_000_000_000);
    const r2 = await evaluateSovereignAuctionForCountry(db, "US", 80, 1_700_000_000_000);
    const r3 = await evaluateSovereignAuctionForCountry(db, "US", 120, 1_700_000_000_000);

    expect(r1!.outcome).toBe("failed");
    expect(r2!.outcome).toBe("undersubscribed");
    expect(r3!.outcome).toBe("failed");
    expect(getRow().failedAuctionConsecutiveCount).toBe(1);
  });
});
