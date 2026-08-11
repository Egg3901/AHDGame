/**
 * Audit S6 — the governor sign action pre-checks the state budget gate and
 * refuses to sign a bill the state cannot fund.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";

vi.mock("@/lib/notifications", () => ({
  createNotification: vi.fn().mockResolvedValue(undefined),
  createNotifications: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/news", () => ({
  generateBillSignedNews: vi.fn().mockResolvedValue(undefined),
  generateBillVetoedNews: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/governorOffice/access", () => ({
  canManageOffice: vi.fn().mockResolvedValue(true),
}));
vi.mock("@/lib/turn/billLifecycle/regionalEngine", () => ({
  finalizeStateBillEnactment: vi.fn().mockResolvedValue({ enacted: true }),
}));
vi.mock("@/lib/budget/validation", () => ({
  validateStateBudgetImpact: vi.fn(),
}));

import { validateStateBudgetImpact } from "@/lib/budget/validation";
import { finalizeStateBillEnactment } from "@/lib/turn/billLifecycle/regionalEngine";
import { takeStateBillGovernorAction } from "./stateBillActions";
import type { AuthUserWithCharacter } from "@/lib/auth";

const CHAR_ID = new ObjectId();
const user = {
  character: { _id: CHAR_ID, name: "Gov", policies: {} },
} as unknown as AuthUserWithCharacter;

function makeBill(overrides: Record<string, unknown> = {}) {
  return {
    _id: new ObjectId(),
    stateId: "TX",
    countryId: "US",
    title: "Big Spend Act",
    status: "passed",
    sponsorId: null,
    sponsorName: "NPP",
    legislationTypeId: "education_funding",
    effectDirection: 1,
    ...overrides,
  };
}

describe("takeStateBillGovernorAction — sign with the budget gate", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("stateBills");
    db.collection("gameState");
    vi.mocked(finalizeStateBillEnactment).mockResolvedValue({ enacted: true });
  });

  it("returns 400 and does not enact when the state cannot fund the bill", async () => {
    const bill = makeBill();
    db.collectionMocks["stateBills"]!.findOne.mockResolvedValue(bill);
    vi.mocked(validateStateBudgetImpact).mockResolvedValue({
      allowed: false,
      error: "INSUFFICIENT_FUNDS",
      costAmount: 5e9,
      newTotalSpending: 2.5e10,
      shortfall: 3e9,
    });

    const result = await takeStateBillGovernorAction(
      db as unknown as Db,
      "US",
      "TX",
      bill._id.toString(),
      user,
      "signed"
    );

    expect(result.status).toBe(400);
    expect(String(result.body.error)).toContain("Cannot sign");
    expect(db.collectionMocks["stateBills"]!.updateOne).not.toHaveBeenCalled();
    expect(finalizeStateBillEnactment).not.toHaveBeenCalled();
  });

  it("signs and enacts when the budget allows", async () => {
    const bill = makeBill();
    db.collectionMocks["stateBills"]!.findOne.mockResolvedValue(bill);
    db.collectionMocks["gameState"]!.findOne.mockResolvedValue({ currentTurn: 10 });
    vi.mocked(validateStateBudgetImpact).mockResolvedValue({
      allowed: true,
      costAmount: 1e6,
      newTotalSpending: 2.1e7,
    });

    const result = await takeStateBillGovernorAction(
      db as unknown as Db,
      "US",
      "TX",
      bill._id.toString(),
      user,
      "signed"
    );

    expect(result.status).toBe(200);
    expect(validateStateBudgetImpact).toHaveBeenCalledWith(expect.anything(), "TX", "US", bill);
    expect(finalizeStateBillEnactment).toHaveBeenCalled();
    const updateCall = db.collectionMocks["stateBills"]!.updateOne.mock.calls[0];
    expect(updateCall[1].$set.status).toBe("enacted");
  });
});
