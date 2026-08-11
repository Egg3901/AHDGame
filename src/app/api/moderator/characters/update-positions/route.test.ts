import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireModerator", () => ({ requireModerator: vi.fn() }));
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

  const { requireModerator } = await import("@/lib/api/requireModerator");
  vi.mocked(requireModerator).mockResolvedValue({
    ok: true,
    user: { userId: new ObjectId().toString(), username: "moduser" },
  } as never);
}

function patch(body: unknown) {
  return new Request("http://localhost/api/moderator/characters/update-positions", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("PATCH /api/moderator/characters/update-positions", () => {
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
    const res = await PATCH(patch({ characterId: characterId.toString(), social: -3 }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(db.collectionMocks.characters!.updateOne).toHaveBeenCalledWith(
      { _id: characterId },
      expect.objectContaining({
        $set: expect.objectContaining({ "policies.social": -3 }),
      })
    );
  });

  it("blocks updating a character linked to an admin account", async () => {
    await setup();
    const characterId = new ObjectId();
    const userId = new ObjectId();
    db.collectionMocks.characters!.findOne.mockResolvedValue({
      _id: characterId,
      userId,
      name: "Admin Avatar",
      policies: { economic: 0, social: 0 },
    });
    db.collectionMocks.users!.findOne.mockResolvedValue({
      _id: userId,
      username: "bigboss",
      role: "admin",
    });

    const { PATCH } = await import("./route");
    const res = await PATCH(patch({ characterId: characterId.toString(), economic: 1 }));

    expect(res.status).toBe(403);
    expect(db.collectionMocks.characters!.updateOne).not.toHaveBeenCalled();
  });

  it("returns 404 when the character does not exist", async () => {
    await setup();
    db.collectionMocks.characters!.findOne.mockResolvedValue(null);

    const { PATCH } = await import("./route");
    const res = await PATCH(patch({ characterId: new ObjectId().toString(), economic: 2 }));

    expect(res.status).toBe(404);
  });
});
