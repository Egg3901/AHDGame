import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAdmin", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/modAuditLog", () => ({ createModAuditLog: vi.fn() }));

let db: MockDb;

beforeEach(() => {
  db = createMockDb();
  vi.clearAllMocks();
  db.collection("characters");
  db.collection("users");
});

async function setup() {
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as never);

  const { requireAdmin } = await import("@/lib/api/requireAdmin");
  vi.mocked(requireAdmin).mockResolvedValue({
    ok: true,
    admin: { userId: new ObjectId().toString(), username: "adminuser", isAdmin: true },
  } as never);
}

function patch(body: unknown) {
  return new Request("http://localhost/api/admin/characters/update-positions", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("PATCH /api/admin/characters/update-positions", () => {
  it("updates a character's positions identified by characterId", async () => {
    await setup();
    const characterId = new ObjectId();
    const userId = new ObjectId();
    db.collectionMocks.characters!.findOne.mockResolvedValue({
      _id: characterId,
      userId,
      name: "Hugh Smith",
      policies: { economic: 0, social: 1 },
    });
    db.collectionMocks.users!.findOne.mockResolvedValue({
      _id: userId,
      username: "hughs",
      role: "user",
    });

    const { PATCH } = await import("./route");
    const res = await PATCH(patch({ characterId: characterId.toString(), economic: 2 }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(db.collectionMocks.characters!.updateOne).toHaveBeenCalledWith(
      { _id: characterId },
      expect.objectContaining({
        $set: expect.objectContaining({ "policies.economic": 2 }),
      })
    );
  });

  it("returns 404 when the character does not exist", async () => {
    await setup();
    db.collectionMocks.characters!.findOne.mockResolvedValue(null);

    const { PATCH } = await import("./route");
    const res = await PATCH(patch({ characterId: new ObjectId().toString(), economic: 2 }));

    expect(res.status).toBe(404);
  });

  it("rejects an invalid characterId with 400", async () => {
    await setup();

    const { PATCH } = await import("./route");
    const res = await PATCH(patch({ characterId: "not-an-objectid", economic: 2 }));

    expect(res.status).toBe(400);
  });
});
