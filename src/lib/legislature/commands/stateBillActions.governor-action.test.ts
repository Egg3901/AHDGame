import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb, assertSetFields } from "@/lib/test-utils/mockDb";
import type { AuthUserWithCharacter } from "@/lib/auth";

const mockCanManageOffice = vi.fn();

vi.mock("@/lib/governorOffice/access", () => ({
  canManageOffice: (...a: unknown[]) => mockCanManageOffice(...a),
}));
vi.mock("@/lib/billEnactment", () => ({ onBillEnacted: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/notifications", () => ({
  createNotification: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/news", () => ({
  generateBillSignedNews: vi.fn().mockResolvedValue(undefined),
  generateBillVetoedNews: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/legislationEffects", () => ({
  applyLegislationEffect: vi.fn().mockResolvedValue(undefined),
}));

const billId = new ObjectId();

function user(): AuthUserWithCharacter {
  return {
    userId: "u1",
    character: { _id: new ObjectId(), name: "Jack Ma" },
  } as unknown as AuthUserWithCharacter;
}

describe("takeStateBillGovernorAction — parliamentary regional assent", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("stateBills").findOne.mockResolvedValue({
      _id: billId,
      stateId: "XB",
      countryId: "CN",
      title: "Xibei Economy Supremacy Law",
      status: "passed",
      sponsorId: null,
      sponsorName: "Ma Zhiwei",
    });
    db.collection("gameState").findOne.mockResolvedValue({ _id: "current", currentTurn: 214 });
  });

  it("lets a parliamentary-system (CN) governor sign a passed regional bill", async () => {
    mockCanManageOffice.mockResolvedValue(true);
    const { takeStateBillGovernorAction } = await import("./stateBillActions");
    const res = await takeStateBillGovernorAction(
      db as unknown as Db,
      "CN",
      "XB",
      billId.toString(),
      user(),
      "signed"
    );

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ action: "signed", statusText: "enacted" });
    // It must NOT short-circuit with the old parliamentary carve-out.
    expect(res.body.error).toBeUndefined();
    assertSetFields(db.collection("stateBills").updateOne, { status: "enacted" });
    const { applyLegislationEffect } = await import("@/lib/legislationEffects");
    expect(vi.mocked(applyLegislationEffect)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ countryId: "CN", stateId: "XB" })
    );
  });

  it("still rejects a viewer who cannot manage the office", async () => {
    mockCanManageOffice.mockResolvedValue(false);
    const { takeStateBillGovernorAction } = await import("./stateBillActions");
    const res = await takeStateBillGovernorAction(
      db as unknown as Db,
      "CN",
      "XB",
      billId.toString(),
      user(),
      "signed"
    );
    expect(res.status).toBe(403);
    expect(db.collection("stateBills").updateOne).not.toHaveBeenCalled();
  });
});
