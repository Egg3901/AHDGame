import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuth: vi.fn() }));

const { getDb } = await import("@/lib/mongodb");
const { requireAuth } = await import("@/lib/api/requireAuth");

const ROUTE = "@/app/api/corporations/[id]/defence-contracts/[contractId]/route";

const CORP_ID = new ObjectId();
const CONTRACT_ID = new ObjectId();
const CEO_USER_ID = new ObjectId();

function req(body: unknown) {
  return new Request("http://localhost/api/corporations/x/defence-contracts/y", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
const params = {
  params: Promise.resolve({ id: CORP_ID.toString(), contractId: CONTRACT_ID.toString() }),
};

describe("POST corporations/[id]/defence-contracts/[contractId]", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    vi.mocked(requireAuth).mockResolvedValue({
      ok: true,
      user: { userId: CEO_USER_ID, isAdmin: false },
    } as never);

    db.collection("corporations");
    db.collectionMocks.corporations.findOne.mockResolvedValue({
      _id: CORP_ID,
      userId: CEO_USER_ID,
      name: "Lockmartin",
    });
    db.collection("defenceContracts");
    db.collectionMocks.defenceContracts.findOne.mockResolvedValue({
      _id: CONTRACT_ID,
      corporationId: CORP_ID,
      status: "pending",
    });
    db.collectionMocks.defenceContracts.updateOne.mockResolvedValue({
      matchedCount: 1,
      modifiedCount: 1,
    } as never);
  });

  it("accepts a pending offer, making it active", async () => {
    const { POST } = await import(ROUTE);
    const res = await POST(req({ action: "accept" }), params);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ success: true, status: "active" });
    const [filter, update] = db.collectionMocks.defenceContracts.updateOne.mock.calls[0];
    // Guarded on `pending`, so a double-click or a race with the minister's cancel resolves
    // to one winner rather than reviving a withdrawn order.
    expect(filter).toMatchObject({ status: "pending" });
    expect((update as { $set: { status: string } }).$set.status).toBe("active");
  });

  it("declines a pending offer", async () => {
    const { POST } = await import(ROUTE);
    const res = await POST(req({ action: "decline" }), params);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ status: "declined" });
    const [, update] = db.collectionMocks.defenceContracts.updateOne.mock.calls[0];
    expect((update as { $set: { status: string } }).$set.status).toBe("declined");
  });

  // The supplier's lever is theirs alone — a government cannot answer on their behalf, and
  // no other player can answer for them.
  it("refuses someone who is not the CEO", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      ok: true,
      user: { userId: new ObjectId(), isAdmin: false },
    } as never);

    const { POST } = await import(ROUTE);
    const res = await POST(req({ action: "accept" }), params);

    expect(res.status).toBe(403);
    expect(db.collectionMocks.defenceContracts.updateOne).not.toHaveBeenCalled();
  });

  // Without the corporation scope on the lookup, any CEO could answer another corp's offer
  // by pasting its contract id.
  it("refuses a contract belonging to another corporation", async () => {
    db.collectionMocks.defenceContracts.findOne.mockResolvedValue(null);

    const { POST } = await import(ROUTE);
    const res = await POST(req({ action: "accept" }), params);

    expect(res.status).toBe(404);
    const [filter] = db.collectionMocks.defenceContracts.findOne.mock.calls[0];
    expect(filter).toMatchObject({ corporationId: CORP_ID });
    expect(db.collectionMocks.defenceContracts.updateOne).not.toHaveBeenCalled();
  });

  it("409s on an offer that is no longer pending", async () => {
    db.collectionMocks.defenceContracts.findOne.mockResolvedValue({
      _id: CONTRACT_ID,
      corporationId: CORP_ID,
      status: "active",
    });

    const { POST } = await import(ROUTE);
    const res = await POST(req({ action: "accept" }), params);

    expect(res.status).toBe(409);
    expect(db.collectionMocks.defenceContracts.updateOne).not.toHaveBeenCalled();
  });

  // The read said pending but the guarded write lost — the minister cancelled in between.
  it("409s when the guarded write loses the race", async () => {
    db.collectionMocks.defenceContracts.updateOne.mockResolvedValue({
      matchedCount: 0,
      modifiedCount: 0,
    } as never);

    const { POST } = await import(ROUTE);
    const res = await POST(req({ action: "accept" }), params);

    expect(res.status).toBe(409);
  });

  it("rejects an action that is neither accept nor decline", async () => {
    const { POST } = await import(ROUTE);
    const res = await POST(req({ action: "renegotiate" }), params);

    expect(res.status).toBe(400);
    expect(db.collectionMocks.defenceContracts.updateOne).not.toHaveBeenCalled();
  });

  it("404s for a corporation that does not exist", async () => {
    db.collectionMocks.corporations.findOne.mockResolvedValue(null);

    const { POST } = await import(ROUTE);
    const res = await POST(req({ action: "accept" }), params);

    expect(res.status).toBe(404);
  });

  it("lets an admin answer on a corporation's behalf", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      ok: true,
      user: { userId: new ObjectId(), isAdmin: true },
    } as never);

    const { POST } = await import(ROUTE);
    const res = await POST(req({ action: "accept" }), params);

    expect(res.status).toBe(200);
  });
});
