import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireBasicAuth: vi.fn() }));
vi.mock("@/lib/supporter/reviewNotifications", () => ({
  notifyModeratorsOfSupporterRequest: vi.fn().mockResolvedValue(undefined),
  notifySubmitterOfSupporterDecision: vi.fn().mockResolvedValue(undefined),
}));

const userId = new ObjectId();

function post(body: unknown) {
  return new Request("http://localhost/api/settings/supporter-requests", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function authAs() {
  const { requireBasicAuth } = await import("@/lib/api/requireAuth");
  vi.mocked(requireBasicAuth).mockResolvedValue({
    ok: true,
    user: { userId: userId.toString(), username: "tester" },
  } as never);
}

describe("POST /api/settings/supporter-requests", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("users");
    db.collection("supporterRequests");
    db.collection("npps");
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    await authAs();
  });

  function mockUser(user: Record<string, unknown>) {
    // First users.findOne call resolves the requester; later calls are the
    // impersonation guard and resolve null (no collision) unless overridden.
    db.collectionMocks.users.findOne.mockImplementation(async (filter: Record<string, unknown>) => {
      if (filter && "_id" in filter && !("$and" in filter)) {
        return { _id: userId, username: "tester", ...user };
      }
      return null;
    });
  }

  it("rejects users without active supporter benefits", async () => {
    mockUser({ patreonTier: null });
    const { POST } = await import("./route");
    const res = await POST(post({ kind: "wall-name", proposedName: "Cool Name" }));
    expect(res.status).toBe(403);
  });

  it("rejects wall names containing em dashes", async () => {
    mockUser({ patreonTier: "supporter", patreonExpiresAt: null });
    const { POST } = await import("./route");
    const res = await POST(post({ kind: "wall-name", proposedName: "Cool—Name" }));
    expect(res.status).toBe(400);
  });

  it("rejects wall names that collide with another user's name", async () => {
    db.collectionMocks.users.findOne.mockImplementation(async (filter: Record<string, unknown>) => {
      if (filter && "$and" in filter) {
        return { _id: new ObjectId() }; // impersonation collision
      }
      return { _id: userId, username: "tester", patreonTier: "supporter" };
    });
    const { POST } = await import("./route");
    const res = await POST(post({ kind: "wall-name", proposedName: "Someone Else" }));
    expect(res.status).toBe(409);
  });

  it("accepts a valid wall-name request and notifies moderators", async () => {
    mockUser({ patreonTier: "supporter", patreonExpiresAt: null });
    const { POST } = await import("./route");
    const res = await POST(post({ kind: "wall-name", proposedName: "  Cool Name  " }));
    expect(res.status).toBe(200);
    expect(db.collectionMocks.supporterRequests.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "wall-name",
        status: "pending",
        proposedName: "Cool Name",
      })
    );
    const { notifyModeratorsOfSupporterRequest } =
      await import("@/lib/supporter/reviewNotifications");
    expect(notifyModeratorsOfSupporterRequest).toHaveBeenCalled();
  });

  it("rejects a second pending request of the same kind", async () => {
    mockUser({ patreonTier: "supporter" });
    db.collectionMocks.supporterRequests.findOne.mockResolvedValue({
      _id: new ObjectId(),
      status: "pending",
    });
    const { POST } = await import("./route");
    const res = await POST(post({ kind: "wall-name", proposedName: "Cool Name" }));
    expect(res.status).toBe(409);
  });

  it("gates npp-rename to supporter-plus-plus", async () => {
    mockUser({ patreonTier: "supporter-plus" });
    const { POST } = await import("./route");
    const res = await POST(
      post({ kind: "npp-rename", nppId: new ObjectId().toString(), proposedNppName: "New Name" })
    );
    expect(res.status).toBe(403);
  });

  it("blocks npp-rename when the one-time rename was already used", async () => {
    mockUser({ patreonTier: "supporter-plus-plus", nppRenameUsedAt: new Date() });
    const { POST } = await import("./route");
    const res = await POST(
      post({ kind: "npp-rename", nppId: new ObjectId().toString(), proposedNppName: "New Name" })
    );
    expect(res.status).toBe(409);
  });

  it("accepts a valid npp-rename request for supporter-plus-plus", async () => {
    mockUser({ patreonTier: "supporter-plus-plus" });
    const nppId = new ObjectId();
    db.collectionMocks.npps.findOne.mockImplementation(async (filter: Record<string, unknown>) => {
      if (filter && "_id" in filter && !(filter._id as Record<string, unknown>)?.$ne) {
        return {
          _id: nppId,
          name: "Old Name",
          sequentialId: 42,
          countryId: "us",
          retiredAt: null,
        };
      }
      return null; // no duplicate NPP name in the country
    });
    const { POST } = await import("./route");
    const res = await POST(
      post({ kind: "npp-rename", nppId: nppId.toString(), proposedNppName: "New Name" })
    );
    expect(res.status).toBe(200);
    expect(db.collectionMocks.supporterRequests.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "npp-rename",
        status: "pending",
        currentNppName: "Old Name",
        proposedNppName: "New Name",
        nppSequentialId: 42,
      })
    );
  });

  it("rejects npp-rename for retired politicians", async () => {
    mockUser({ patreonTier: "supporter-plus-plus" });
    const nppId = new ObjectId();
    db.collectionMocks.npps.findOne.mockResolvedValue({
      _id: nppId,
      name: "Old Name",
      retiredAt: new Date(),
    });
    const { POST } = await import("./route");
    const res = await POST(
      post({ kind: "npp-rename", nppId: nppId.toString(), proposedNppName: "New Name" })
    );
    expect(res.status).toBe(400);
  });
});
