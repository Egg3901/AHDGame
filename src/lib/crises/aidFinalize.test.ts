import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import {
  processCrisisAidResolutions,
  reverseCrisisAidPenalties,
  isResolvedBillStatus,
} from "./aidFinalize";
import type { CrisisAidCommitment } from "@/lib/db/types/crisisAid";
import { AID_FAILED_PENALTY, AID_PENALTY_TURNS } from "@/lib/constants/crises";

vi.mock("@/lib/wireEvent", () => ({ logWireEvent: vi.fn().mockResolvedValue(undefined) }));

// Mock applyEffectsForCrisis so we don't need to set up crisisInteractions in every test.
vi.mock("@/lib/crises/interactionEngine", () => ({
  applyEffectsForCrisis: vi.fn().mockResolvedValue(undefined),
}));

// Mock applyCrisisEffects — approval-only reversal; don't need real stateMetrics.
vi.mock("@/lib/crises/applyEffects", () => ({
  applyCrisisEffects: vi.fn().mockResolvedValue(undefined),
}));

// Mock creditTreasury so we don't need deriveFiscalState to be wired up.
vi.mock("@/lib/budget/treasurySpend", () => ({
  creditTreasury: vi.fn().mockResolvedValue({
    fromSurplus: 0,
    addedToDebt: 0,
    newTreasuryBalance: 110_000,
    newDebtPrincipal: 0,
  }),
  spendFromTreasury: vi.fn().mockResolvedValue({
    fromSurplus: 10_000,
    addedToDebt: 0,
    newTreasuryBalance: 90_000,
    newDebtPrincipal: 0,
  }),
}));

let db: MockDb;

function makeCommitment(over: Partial<CrisisAidCommitment> = {}): CrisisAidCommitment {
  return {
    _id: new ObjectId(),
    crisisId: new ObjectId(),
    billId: new ObjectId(),
    senderCountryId: "US",
    proposerCharacterId: new ObjectId(),
    proposerName: "P",
    amountLocal: 10_000,
    amountPctGdp: 0.01,
    recoveryEffects: [],
    senderEffects: [],
    treasuryDebited: 10_000,
    status: "pending",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

beforeEach(() => {
  db = createMockDb();
  // Pre-instantiate all collections the code touches.
  ["crisisAidCommitments", "bills", "federalBudget", "governmentApprovals"].forEach((c) =>
    db.collection(c)
  );
  vi.clearAllMocks();
});

// ── isResolvedBillStatus ──────────────────────────────────────────────────────

describe("isResolvedBillStatus", () => {
  it("classifies 'signed' as passed", () => {
    expect(isResolvedBillStatus("signed")).toBe("passed");
  });

  it("classifies 'failed' as failed", () => {
    expect(isResolvedBillStatus("failed")).toBe("failed");
  });

  it("classifies 'withdrawn' as failed", () => {
    expect(isResolvedBillStatus("withdrawn")).toBe("failed");
  });

  it("classifies 'override_failed' as failed", () => {
    expect(isResolvedBillStatus("override_failed")).toBe("failed");
  });

  it("returns null for 'active' (still in-flight)", () => {
    expect(isResolvedBillStatus("active")).toBeNull();
  });
});

// ── processCrisisAidResolutions — PASSED path ────────────────────────────────

describe("processCrisisAidResolutions — passed", () => {
  it("marks a commitment as passed when its bill is signed", async () => {
    const c = makeCommitment();

    // Drive find() → pending list
    db.collectionMocks["crisisAidCommitments"]!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([c]),
    });

    // Drive bills.findOne → signed bill
    db.collectionMocks["bills"]!.findOne.mockResolvedValue({
      _id: c.billId,
      status: "signed",
      crisisAidId: c._id,
    });

    const res = await processCrisisAidResolutions(db as unknown as Db, 100);

    expect(res).toEqual({ passed: 1, failed: 0 });

    // commitment updated to "passed"
    const updateCalls = db.collectionMocks["crisisAidCommitments"]!.updateOne.mock.calls;
    const passedCall = updateCalls.find(
      (call) => (call[1] as { $set?: Record<string, unknown> })?.$set?.status === "passed"
    );
    expect(passedCall).toBeDefined();
  });
});

// ── processCrisisAidResolutions — FAILED path ────────────────────────────────

describe("processCrisisAidResolutions — failed", () => {
  it("claws back and applies penalty when the bill fails", async () => {
    const c = makeCommitment(); // recoveryEffects:[], senderEffects:[] → no-ops

    // Drive find() → pending list
    db.collectionMocks["crisisAidCommitments"]!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([c]),
    });

    // Drive bills.findOne → failed bill
    db.collectionMocks["bills"]!.findOne.mockResolvedValue({
      _id: c.billId,
      status: "failed",
      crisisAidId: c._id,
    });

    const res = await processCrisisAidResolutions(db as unknown as Db, 100);

    expect(res).toEqual({ passed: 0, failed: 1 });

    // governmentApprovals.updateOne called with $inc.approvalRating === -AID_FAILED_PENALTY
    const approvalCalls = db.collectionMocks["governmentApprovals"]!.updateOne.mock.calls;
    const penaltyCall = approvalCalls.find(
      (call) =>
        (call[1] as { $inc?: Record<string, unknown> })?.$inc?.approvalRating ===
        -AID_FAILED_PENALTY
    );
    expect(penaltyCall).toBeDefined();

    // crisisAidCommitments.updateOne called with status:"failed"
    const commitmentCalls = db.collectionMocks["crisisAidCommitments"]!.updateOne.mock.calls;
    const failedCall = commitmentCalls.find(
      (call) => (call[1] as { $set?: Record<string, unknown> })?.$set?.status === "failed"
    );
    expect(failedCall).toBeDefined();

    // approvalPenaltyExpiresTurn > currentTurn (100)
    const expiresTurn = (failedCall![1] as { $set?: Record<string, unknown> })?.$set
      ?.approvalPenaltyExpiresTurn as number;
    expect(expiresTurn).toBe(100 + AID_PENALTY_TURNS);
  });
});

// ── reverseCrisisAidPenalties ─────────────────────────────────────────────────

describe("reverseCrisisAidPenalties", () => {
  it("reverses the penalty for expired commitments and returns the count", async () => {
    const c = makeCommitment({
      status: "failed",
      approvalPenaltyExpiresTurn: 100,
      penaltyReversed: false,
    });

    // Drive find() → one due commitment
    db.collectionMocks["crisisAidCommitments"]!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([c]),
    });

    const n = await reverseCrisisAidPenalties(db as unknown as Db, 100);

    expect(n).toBe(1);

    // governmentApprovals.updateOne called with $inc.approvalRating === +AID_FAILED_PENALTY
    const approvalCalls = db.collectionMocks["governmentApprovals"]!.updateOne.mock.calls;
    const reversalCall = approvalCalls.find(
      (call) =>
        (call[1] as { $inc?: Record<string, unknown> })?.$inc?.approvalRating === AID_FAILED_PENALTY
    );
    expect(reversalCall).toBeDefined();

    // crisisAidCommitments.updateOne sets penaltyReversed:true
    const commitmentCalls = db.collectionMocks["crisisAidCommitments"]!.updateOne.mock.calls;
    const reversedCall = commitmentCalls.find(
      (call) => (call[1] as { $set?: Record<string, unknown> })?.$set?.penaltyReversed === true
    );
    expect(reversedCall).toBeDefined();
  });

  it("returns 0 when no commitments are due", async () => {
    // find() → empty list (nothing expired yet)
    db.collectionMocks["crisisAidCommitments"]!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });

    const n = await reverseCrisisAidPenalties(db as unknown as Db, 99);
    expect(n).toBe(0);
    expect(db.collectionMocks["governmentApprovals"]!.updateOne).not.toHaveBeenCalled();
  });
});
