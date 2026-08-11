import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { ObjectId } from "mongodb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAdmin", () => ({ requireAdmin: vi.fn() }));

let db: MockDb;
beforeEach(async () => {
  vi.resetModules();
  db = createMockDb();
  // Pre-initialize lazy collections used by these routes
  db.collection("corporations");
  db.collection("gameState");
  db.collection("characters");
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Awaited<ReturnType<typeof getDb>>);
  const { requireAdmin } = await import("@/lib/api/requireAdmin");
  vi.mocked(requireAdmin).mockResolvedValue({
    ok: true,
    admin: { id: "admin1" },
  } as unknown as Awaited<ReturnType<typeof requireAdmin>>);
});

describe("POST /api/admin/corporations/[id]/ceo — appoint", () => {
  it("returns 404 when corporation not found", async () => {
    db.collectionMocks.corporations.findOne.mockResolvedValue(null);
    db.collectionMocks.corporations.updateOne.mockResolvedValue({ matchedCount: 0 });
    const { POST } = await import("./route");
    const req = new Request("http://test", {
      method: "POST",
      body: JSON.stringify({ characterId: "a".repeat(24) }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req, { params: Promise.resolve({ id: new ObjectId().toString() }) });
    expect(res.status).toBe(404);
  });

  it("sets ceoVacant false and new ceoId on appoint", async () => {
    const corpId = new ObjectId();
    const charId = new ObjectId();
    const ownerUserId = new ObjectId();
    db.collectionMocks.corporations.findOne.mockResolvedValue({
      _id: corpId,
      shareholders: [{ characterId: charId, shares: 80000 }],
      totalShares: 100000,
    });
    db.collectionMocks.characters.findOne.mockResolvedValue({
      _id: charId,
      userId: ownerUserId,
    });
    db.collectionMocks.corporations.updateOne.mockResolvedValue({ matchedCount: 1 });
    const { POST } = await import("./route");
    const req = new Request("http://test", {
      method: "POST",
      body: JSON.stringify({ characterId: charId.toString() }),
      headers: { "Content-Type": "application/json" },
    });
    await POST(req, { params: Promise.resolve({ id: corpId.toString() }) });
    const [, update] = db.collectionMocks.corporations.updateOne.mock.calls[0];
    expect(update.$set.ceoVacant).toBe(false);
    expect(update.$set.ceoId.toString()).toBe(charId.toString());
  });

  it("sets corporation.userId to the appointed character's owning user", async () => {
    // Regression: the appointed CEO is recognized as an insider only when the
    // corp's userId matches their account (requireCeo / shouldRedactCorporation).
    // Appointing must stamp userId from the character's owning user, like the
    // player-facing /ceo/accept flow — otherwise the CEO sees the private view.
    const corpId = new ObjectId();
    const charId = new ObjectId();
    const ownerUserId = new ObjectId();
    db.collectionMocks.corporations.findOne.mockResolvedValue({ _id: corpId });
    db.collectionMocks.characters.findOne.mockResolvedValue({
      _id: charId,
      userId: ownerUserId,
    });
    db.collectionMocks.corporations.updateOne.mockResolvedValue({ matchedCount: 1 });
    const { POST } = await import("./route");
    const req = new Request("http://test", {
      method: "POST",
      body: JSON.stringify({ characterId: charId.toString() }),
      headers: { "Content-Type": "application/json" },
    });
    await POST(req, { params: Promise.resolve({ id: corpId.toString() }) });
    const [, update] = db.collectionMocks.corporations.updateOne.mock.calls[0];
    expect(update.$set.userId?.toString()).toBe(ownerUserId.toString());
  });

  it("stamps ceoType 'character' and clears caretakerCeo over an NPP-run corp", async () => {
    // Regression: appointing a human over a corp whose seat was held by an NPP
    // must reset ceoType, or corporationDetail looks the CEO up in the npps
    // collection, finds nothing, and renders "CEO Vacant" despite a live ceoId.
    const corpId = new ObjectId();
    const charId = new ObjectId();
    db.collectionMocks.corporations.findOne.mockResolvedValue({
      _id: corpId,
      ceoType: "npp",
      ceoId: new ObjectId(),
      caretakerCeo: {
        underlyingCharacterId: new ObjectId(),
        underlyingUserId: new ObjectId(),
        appointedTurn: 1100,
      },
    });
    db.collectionMocks.characters.findOne.mockResolvedValue({
      _id: charId,
      userId: new ObjectId(),
    });
    db.collectionMocks.corporations.updateOne.mockResolvedValue({ matchedCount: 1 });
    const { POST } = await import("./route");
    const req = new Request("http://test", {
      method: "POST",
      body: JSON.stringify({ characterId: charId.toString() }),
      headers: { "Content-Type": "application/json" },
    });
    await POST(req, { params: Promise.resolve({ id: corpId.toString() }) });
    const [, update] = db.collectionMocks.corporations.updateOne.mock.calls[0];
    expect(update.$set.ceoType).toBe("character");
    expect(update.$unset).toHaveProperty("caretakerCeo");
  });

  it("returns 404 when the appointed character does not exist", async () => {
    const corpId = new ObjectId();
    db.collectionMocks.corporations.findOne.mockResolvedValue({ _id: corpId });
    db.collectionMocks.characters.findOne.mockResolvedValue(null);
    db.collectionMocks.corporations.updateOne.mockResolvedValue({ matchedCount: 1 });
    const { POST } = await import("./route");
    const req = new Request("http://test", {
      method: "POST",
      body: JSON.stringify({ characterId: new ObjectId().toString() }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req, { params: Promise.resolve({ id: corpId.toString() }) });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/admin/corporations/[id]/ceo — vacate", () => {
  it("returns 404 when corporation not found", async () => {
    db.collectionMocks.gameState.findOne.mockResolvedValue({ currentTurn: 10 });
    db.collectionMocks.corporations.updateOne.mockResolvedValue({ matchedCount: 0 });
    const { DELETE } = await import("./route");
    const req = new Request("http://test", { method: "DELETE" });
    const res = await DELETE(req, {
      params: Promise.resolve({ id: new ObjectId().toString() }),
    });
    expect(res.status).toBe(404);
  });

  it("sets ceoVacant true and records ceoVacantSinceTurn", async () => {
    db.collectionMocks.gameState.findOne.mockResolvedValue({ currentTurn: 42 });
    db.collectionMocks.corporations.updateOne.mockResolvedValue({ matchedCount: 1 });
    const { DELETE } = await import("./route");
    const req = new Request("http://test", { method: "DELETE" });
    await DELETE(req, { params: Promise.resolve({ id: new ObjectId().toString() }) });
    const [, update] = db.collectionMocks.corporations.updateOne.mock.calls[0];
    expect(update.$set.ceoVacant).toBe(true);
    expect(update.$set.ceoVacantSinceTurn).toBe(42);
  });
});
