import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireModerator", () => ({ requireModerator: vi.fn() }));
vi.mock("@/lib/modAuditLog", () => ({ createModAuditLog: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/supporter/reviewNotifications", () => ({
  notifySubmitterOfSupporterDecision: vi.fn().mockResolvedValue(undefined),
}));

const moderatorId = new ObjectId();
const requesterId = new ObjectId();

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("POST /api/moderator/supporter-requests/[id]/approve", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("users");
    db.collection("supporterRequests");
    db.collection("npps");
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    const { requireModerator } = await import("@/lib/api/requireModerator");
    vi.mocked(requireModerator).mockResolvedValue({
      ok: true,
      user: { userId: moderatorId.toString(), username: "mod" },
    } as never);
  });

  it("approves a wall-name request and applies the wall name", async () => {
    const requestId = new ObjectId();
    db.collectionMocks.supporterRequests.findOne.mockResolvedValue({
      _id: requestId,
      userId: requesterId,
      kind: "wall-name",
      status: "pending",
      createdAt: new Date(),
      proposedName: "Cool Name",
    });
    db.collectionMocks.users.findOne.mockResolvedValue({
      _id: requesterId,
      username: "requester",
    });

    const { POST } = await import("./route");
    const res = await POST(new Request("http://localhost"), ctx(requestId.toString()));
    expect(res.status).toBe(200);

    expect(db.collectionMocks.users.updateOne).toHaveBeenCalledWith(
      { _id: requesterId },
      { $set: { supporterWallName: "Cool Name" } }
    );
    expect(db.collectionMocks.supporterRequests.updateOne).toHaveBeenCalledWith(
      { _id: requestId },
      expect.objectContaining({
        $set: expect.objectContaining({ status: "approved", decidedBy: moderatorId }),
      })
    );
    const { notifySubmitterOfSupporterDecision } =
      await import("@/lib/supporter/reviewNotifications");
    expect(notifySubmitterOfSupporterDecision).toHaveBeenCalledWith(
      expect.objectContaining({ decision: "approved", kind: "wall-name" })
    );
  });

  it("approves an npp-rename, renames the NPP, and marks the one-time use", async () => {
    const requestId = new ObjectId();
    const nppId = new ObjectId();
    db.collection("electionCandidates");
    db.collection("electedOfficials");
    db.collectionMocks.electionCandidates.updateMany.mockResolvedValue({ modifiedCount: 1 });
    db.collectionMocks.electedOfficials.updateMany.mockResolvedValue({ modifiedCount: 0 });
    db.collectionMocks.supporterRequests.findOne.mockResolvedValue({
      _id: requestId,
      userId: requesterId,
      kind: "npp-rename",
      status: "pending",
      createdAt: new Date(),
      nppId,
      currentNppName: "Old Name",
      proposedNppName: "New Name",
    });
    db.collectionMocks.users.findOne.mockImplementation(async (filter: Record<string, unknown>) => {
      if (filter && "$and" in filter) return null; // no impersonation collision
      return { _id: requesterId, username: "requester" };
    });
    db.collectionMocks.npps.findOne.mockImplementation(async (filter: Record<string, unknown>) => {
      if (filter && "_id" in filter && !(filter._id as Record<string, unknown>)?.$ne) {
        return { _id: nppId, name: "Old Name", countryId: "us", retiredAt: null };
      }
      return null; // uniqueness re-check passes
    });

    const { POST } = await import("./route");
    const res = await POST(new Request("http://localhost"), ctx(requestId.toString()));
    expect(res.status).toBe(200);

    expect(db.collectionMocks.npps.updateOne).toHaveBeenCalledWith(
      { _id: nppId },
      { $set: expect.objectContaining({ name: "New Name" }) }
    );
    expect(db.collectionMocks.electionCandidates.updateMany).toHaveBeenCalledWith(
      { nppId },
      { $set: { characterName: "New Name" } }
    );
    expect(db.collectionMocks.electedOfficials.updateMany).toHaveBeenCalledWith(
      { nppId },
      { $set: { characterName: "New Name" } }
    );
    expect(db.collectionMocks.users.updateOne).toHaveBeenCalledWith(
      { _id: requesterId },
      { $set: { nppRenameUsedAt: expect.any(Date) } }
    );
  });

  it("refuses to approve a request that was already decided", async () => {
    const requestId = new ObjectId();
    db.collectionMocks.supporterRequests.findOne.mockResolvedValue({
      _id: requestId,
      userId: requesterId,
      kind: "wall-name",
      status: "approved",
      proposedName: "Cool Name",
    });
    const { POST } = await import("./route");
    const res = await POST(new Request("http://localhost"), ctx(requestId.toString()));
    expect(res.status).toBe(409);
  });
});
