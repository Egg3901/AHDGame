import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Db } from "mongodb";

vi.mock("../../crisisNews", () => ({
  emitRecoveryCompleteNews: vi.fn().mockResolvedValue(undefined),
}));

import { processSovereignRecoveryTurn } from "../recoveryTurn";
import { emitRecoveryCompleteNews } from "../../crisisNews";
import { RECOVERY_FLOOR_TURNS, RECOVERY_DISCIPLINE_REQUIRED_STREAK } from "../../constants";

interface FakeBudget {
  _id: string;
  countryId: string;
  sovereignCrisisState: string;
  recoveryStartedAt?: { turn: number } | null;
  recoveryFiscalDisciplineStreak?: number;
  recoveryGdpPenaltyTurnsRemaining?: number | null;
  recoveryGdpPenaltyPercent?: number | null;
  marketAccessLockedUntilTurn?: number | null;
  failedAuctionConsecutiveCount?: number;
  revenue?: { total: number };
  spending?: { total: number; debtInterest: number };
}

function makeDb(rows: FakeBudget[]) {
  let active = [...rows];
  const sets: Array<{ id: string; $set: Record<string, unknown> }> = [];
  const db = {
    collection: vi.fn(() => ({
      find: vi.fn().mockReturnValue({
        toArray: vi
          .fn()
          .mockImplementation(async () =>
            active.filter((r) => r.sovereignCrisisState === "recovering")
          ),
      }),
      updateOne: vi.fn(async (filter: { _id: string }, u: Record<string, unknown>) => {
        sets.push({ id: filter._id, $set: u.$set as Record<string, unknown> });
        active = active.map((r) => (r._id === filter._id ? { ...r, ...(u.$set as object) } : r));
        return { acknowledged: true, modifiedCount: 1 };
      }),
    })),
  } as unknown as Db;
  return { db, sets };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("processSovereignRecoveryTurn", () => {
  it("evaluates only countries in recovering state", async () => {
    const { db, sets } = makeDb([
      {
        _id: "federal",
        countryId: "US",
        sovereignCrisisState: "recovering",
        recoveryStartedAt: { turn: 100 },
        recoveryFiscalDisciplineStreak: 0,
        revenue: { total: 1000 },
        spending: { total: 1500, debtInterest: 600 },
      },
      {
        _id: "UK",
        countryId: "UK",
        sovereignCrisisState: "normal",
        revenue: { total: 800 },
        spending: { total: 900, debtInterest: 100 },
      },
    ]);
    const r = await processSovereignRecoveryTurn(db, 105);
    expect(r.countriesEvaluated).toBe(1);
    expect(sets).toHaveLength(1);
    expect(sets[0].id).toBe("federal");
  });

  it("increments streak when in good standing", async () => {
    const { db, sets } = makeDb([
      {
        _id: "federal",
        countryId: "US",
        sovereignCrisisState: "recovering",
        recoveryStartedAt: { turn: 100 },
        recoveryFiscalDisciplineStreak: 2,
        revenue: { total: 1000 },
        spending: { total: 900, debtInterest: 200 },
      },
    ]);
    await processSovereignRecoveryTurn(db, 110);
    expect(sets[0].$set.recoveryFiscalDisciplineStreak).toBe(3);
  });

  it("resets streak when not in good standing", async () => {
    const { db, sets } = makeDb([
      {
        _id: "federal",
        countryId: "US",
        sovereignCrisisState: "recovering",
        recoveryStartedAt: { turn: 100 },
        recoveryFiscalDisciplineStreak: 4,
        revenue: { total: 500 },
        spending: { total: 1500, debtInterest: 100 },
      },
    ]);
    await processSovereignRecoveryTurn(db, 110);
    expect(sets[0].$set.recoveryFiscalDisciplineStreak).toBe(0);
  });

  it("exits recovery and emits news when both floor and streak satisfied", async () => {
    const { db, sets } = makeDb([
      {
        _id: "federal",
        countryId: "US",
        sovereignCrisisState: "recovering",
        recoveryStartedAt: { turn: 100 },
        recoveryFiscalDisciplineStreak: RECOVERY_DISCIPLINE_REQUIRED_STREAK - 1,
        revenue: { total: 1000 },
        spending: { total: 900, debtInterest: 200 },
      },
    ]);
    await processSovereignRecoveryTurn(db, 100 + RECOVERY_FLOOR_TURNS);
    expect(sets[0].$set.sovereignCrisisState).toBe("normal");
    expect(emitRecoveryCompleteNews).toHaveBeenCalledWith("US", 100 + RECOVERY_FLOOR_TURNS);
  });

  it("returns empty report when no countries are recovering", async () => {
    const { db } = makeDb([{ _id: "federal", countryId: "US", sovereignCrisisState: "normal" }]);
    const r = await processSovereignRecoveryTurn(db, 100);
    expect(r.countriesEvaluated).toBe(0);
    expect(r.countriesExited).toEqual([]);
  });
});
