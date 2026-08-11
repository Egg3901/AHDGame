import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireBasicAuth: vi.fn() }));

describe("PATCH /api/settings/display-currency", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("users");
    db.collection("characters");
    db.collection("imperialCharacters");
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  it("updates the active regular character preference", async () => {
    const userId = new ObjectId();
    const activeCharacterId = new ObjectId();
    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,
      user: { userId: userId.toString() },
    } as never);

    db.collectionMocks.users.findOne.mockResolvedValue({
      _id: userId,
      activeCharacterType: "character",
      activeCharacterId,
    });

    const { PATCH } = await import("./route");
    const res = await PATCH(
      new Request("http://localhost/api/settings/display-currency", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayCurrencyPreference: "JPY" }),
      })
    );

    expect(res.status).toBe(200);
    expect(db.collectionMocks.characters.updateOne).toHaveBeenCalledWith(
      { _id: activeCharacterId, userId },
      { $set: { displayCurrencyPreference: "JPY", updatedAt: expect.any(Date) } }
    );
    expect(db.collectionMocks.imperialCharacters.updateOne).not.toHaveBeenCalled();
  });

  it("updates the active imperial character preference", async () => {
    const userId = new ObjectId();
    const activeImperialCharacterId = new ObjectId();
    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,
      user: { userId: userId.toString() },
    } as never);

    db.collectionMocks.users.findOne.mockResolvedValue({
      _id: userId,
      activeCharacterType: "imperial",
      activeImperialCharacterId,
    });

    const { PATCH } = await import("./route");
    const res = await PATCH(
      new Request("http://localhost/api/settings/display-currency", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayCurrencyPreference: "EUR" }),
      })
    );

    expect(res.status).toBe(200);
    expect(db.collectionMocks.imperialCharacters.updateOne).toHaveBeenCalledWith(
      { _id: activeImperialCharacterId, userId },
      { $set: { displayCurrencyPreference: "EUR", updatedAt: expect.any(Date) } }
    );
    expect(db.collectionMocks.characters.updateOne).not.toHaveBeenCalled();
  });

  it("returns 404 when the authenticated account has no active character record", async () => {
    const userId = new ObjectId();
    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,
      user: { userId: userId.toString() },
    } as never);

    db.collectionMocks.users.findOne.mockResolvedValue({
      _id: userId,
      activeCharacterType: "character",
      activeCharacterId: null,
    });
    db.collectionMocks.characters.updateOne.mockResolvedValue({
      matchedCount: 0,
      modifiedCount: 0,
    });

    const { PATCH } = await import("./route");
    const res = await PATCH(
      new Request("http://localhost/api/settings/display-currency", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayCurrencyPreference: "home" }),
      })
    );

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Character not found" });
  });
});
