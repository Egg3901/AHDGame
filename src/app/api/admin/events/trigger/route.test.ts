import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAdmin", () => ({ requireAdmin: vi.fn() }));

describe("POST /api/admin/events/trigger", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("characters");
    db.collection("eventDefinitions");
    db.collection("eventInstances");

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue({ ok: true, admin: { username: "admin" } } as never);
  });

  it("rejects world events instead of creating character random-event cards", async () => {
    const characterId = new ObjectId();
    db.collectionMocks.characters!.findOne.mockResolvedValue({
      _id: characterId,
      userId: new ObjectId(),
      countryId: "US",
    });
    db.collectionMocks.eventDefinitions!.findOne.mockResolvedValue({
      kind: "worldEvents.bankRun",
      status: "approved",
    });

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/admin/events/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          characterId: characterId.toHexString(),
          kind: "worldEvents.bankRun",
        }),
      })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: "World events cannot be triggered as character random events",
    });
    expect(db.collectionMocks.eventInstances!.insertOne).not.toHaveBeenCalled();
  });
});
