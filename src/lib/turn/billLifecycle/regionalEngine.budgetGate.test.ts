/**
 * Audit S6 — state budget hard gate.
 *
 * Every state enactment path (governor sign, auto-sign on deadline, auto-enact
 * with no seated executive, veto override) funnels through
 * finalizeStateBillEnactment, so these tests pin the choke-point behavior:
 * a bill the state cannot fund flips to "failed" with a budgetRejection record
 * instead of enacting, and no legislation effects fire.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import type { StateBill } from "@/lib/db/types";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/notifications", () => ({
  createNotification: vi.fn(),
  createNotifications: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/legislationEffects", () => ({
  applyLegislationEffect: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/billEnactment", () => ({ onBillEnacted: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/gameState", () => ({
  getGameState: vi.fn().mockResolvedValue({ currentTurn: 10 }),
}));
vi.mock("@/lib/budget/validation", () => ({
  validateStateBudgetImpact: vi.fn(),
}));

import { validateStateBudgetImpact } from "@/lib/budget/validation";
import { applyLegislationEffect } from "@/lib/legislationEffects";
import { onBillEnacted } from "@/lib/billEnactment";
import { createNotifications } from "@/lib/notifications";

const REJECTED = {
  allowed: false,
  error: "INSUFFICIENT_FUNDS" as const,
  costAmount: 5_000_000_000,
  newTotalSpending: 25_000_000_000,
  shortfall: 3_000_000_000,
};
const ALLOWED = {
  allowed: true,
  costAmount: 1_000_000,
  newTotalSpending: 21_000_000,
  newBalance: 500_000,
};

function makeStateBill(overrides: Partial<StateBill> = {}): StateBill {
  return {
    _id: new ObjectId(),
    stateId: "TX",
    countryId: "US",
    title: "Big Spend Act",
    summary: "spend",
    sponsorId: new ObjectId(),
    sponsorName: "Sponsor",
    status: "passed",
    votesFor: 10,
    votesAgainst: 2,
    votesAbstain: 0,
    votes: {},
    legislationTypeId: "education_funding",
    effectDirection: 1,
    proposedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as StateBill;
}

describe("finalizeStateBillEnactment — state budget hard gate", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("stateBills");
    db.collection("characters");
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  it("rejects an unfundable bill: flips to failed with budgetRejection, applies no effects", async () => {
    vi.mocked(validateStateBudgetImpact).mockResolvedValue(REJECTED);
    db.collectionMocks["characters"]!.findOne.mockResolvedValue({
      _id: new ObjectId(),
      userId: new ObjectId(),
    });

    const bill = makeStateBill();
    const { finalizeStateBillEnactment } = await import("./regionalEngine");
    const outcome = await finalizeStateBillEnactment(db as unknown as Db, bill, 10);

    expect(outcome.enacted).toBe(false);
    expect(outcome.rejection?.error).toBe("INSUFFICIENT_FUNDS");
    expect(validateStateBudgetImpact).toHaveBeenCalledWith(
      expect.anything(),
      "TX",
      "US",
      expect.objectContaining({ _id: bill._id })
    );

    const updateCall = db.collectionMocks["stateBills"]!.updateOne.mock.calls[0];
    expect(updateCall[0]).toEqual({ _id: bill._id });
    expect(updateCall[1].$set.status).toBe("failed");
    expect(updateCall[1].$set.budgetRejection).toMatchObject({
      error: "INSUFFICIENT_FUNDS",
      costAmount: REJECTED.costAmount,
      shortfall: REJECTED.shortfall,
    });

    expect(applyLegislationEffect).not.toHaveBeenCalled();
    expect(onBillEnacted).not.toHaveBeenCalled();

    // Sponsor was told the bill was blocked.
    const batched = vi.mocked(createNotifications).mock.calls.flatMap((c) => c[0]);
    expect(batched).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "bill_failed_chamber" })])
    );
  });

  it("enacts a fundable bill normally", async () => {
    vi.mocked(validateStateBudgetImpact).mockResolvedValue(ALLOWED);
    const bill = makeStateBill();
    const { finalizeStateBillEnactment } = await import("./regionalEngine");
    const outcome = await finalizeStateBillEnactment(db as unknown as Db, bill, 10);

    expect(outcome.enacted).toBe(true);
    expect(applyLegislationEffect).toHaveBeenCalled();
    expect(onBillEnacted).toHaveBeenCalledWith(expect.anything(), bill, 10);
    // No failure transition was written.
    for (const call of db.collectionMocks["stateBills"]!.updateOne.mock.calls) {
      expect(call[1]?.$set?.status).not.toBe("failed");
    }
  });

  it("fails OPEN when the validator itself throws", async () => {
    vi.mocked(validateStateBudgetImpact).mockRejectedValue(new Error("db down"));
    const bill = makeStateBill();
    const { finalizeStateBillEnactment } = await import("./regionalEngine");
    const outcome = await finalizeStateBillEnactment(db as unknown as Db, bill, 10);

    expect(outcome.enacted).toBe(true);
    expect(onBillEnacted).toHaveBeenCalled();
  });

  it("skips validation for bills with no fiscal content", async () => {
    const bill = makeStateBill({ legislationTypeId: undefined, effectDirection: undefined });
    const { finalizeStateBillEnactment } = await import("./regionalEngine");
    const outcome = await finalizeStateBillEnactment(db as unknown as Db, bill, 10);

    expect(outcome.enacted).toBe(true);
    expect(validateStateBudgetImpact).not.toHaveBeenCalled();
  });
});

describe("processStateBillTimers — auto-sign path runs the gate", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("stateBills");
    db.collection("characters");
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  it("auto-sign (governor deadline expired) rejects an unfundable bill", async () => {
    vi.mocked(validateStateBudgetImpact).mockResolvedValue(REJECTED);
    const bill = makeStateBill({ governorActionDeadlineOnTurn: 5 });

    // findOneAndUpdate: return the claimed bill for the "passed" (auto-sign)
    // query once; null for everything else (active-vote and override loops).
    let claimed = false;
    db.collectionMocks["stateBills"]!.findOneAndUpdate.mockImplementation(
      (filter: Record<string, unknown>) => {
        if (filter.status === "passed" && !claimed) {
          claimed = true;
          return Promise.resolve(bill);
        }
        return Promise.resolve(null);
      }
    );

    const { processStateBillTimers } = await import("./regionalEngine");
    const result = await processStateBillTimers(new Date());

    expect(result.billsProcessed).toBe(1);
    expect(validateStateBudgetImpact).toHaveBeenCalled();
    // The gate flipped the claimed-enacted bill to failed.
    const failedWrite = db.collectionMocks["stateBills"]!.updateOne.mock.calls.find(
      (c) => c[1]?.$set?.status === "failed"
    );
    expect(failedWrite).toBeDefined();
    expect(failedWrite![1].$set.budgetRejection.error).toBe("INSUFFICIENT_FUNDS");
    expect(onBillEnacted).not.toHaveBeenCalled();
  });
});
