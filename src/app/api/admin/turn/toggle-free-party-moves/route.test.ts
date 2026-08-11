import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAdmin", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/db/collections", () => ({ getGameStateCollection: vi.fn() }));

let db: MockDb;

beforeEach(() => {
  db = createMockDb();
  vi.clearAllMocks();
  db.collection("gameState");
});

async function setup() {
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as never);

  const { requireAdmin } = await import("@/lib/api/requireAdmin");
  vi.mocked(requireAdmin).mockResolvedValue({
    ok: true,
    admin: { userId: "admin", isAdmin: true },
  } as never);

  const { getGameStateCollection } = await import("@/lib/db/collections");
  vi.mocked(getGameStateCollection).mockResolvedValue(db.collectionMocks.gameState as never);
}

describe("POST /api/admin/turn/toggle-free-party-moves", () => {
  it("opens the free-party-move window when currently closed", async () => {
    await setup();
    db.collectionMocks.gameState!.findOne.mockResolvedValue({
      _id: "current",
      freePartyMovesOpen: false,
    });

    const { POST } = await import("./route");
    const res = await POST();
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.freePartyMovesOpen).toBe(true);
    expect(db.collectionMocks.gameState!.updateOne).toHaveBeenCalledWith(
      { _id: "current" },
      expect.objectContaining({
        $set: expect.objectContaining({ freePartyMovesOpen: true }),
      })
    );
  });

  it("closes the window when currently open", async () => {
    await setup();
    db.collectionMocks.gameState!.findOne.mockResolvedValue({
      _id: "current",
      freePartyMovesOpen: true,
    });

    const { POST } = await import("./route");
    const res = await POST();
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.freePartyMovesOpen).toBe(false);
  });

  it("returns 404 when game state is missing", async () => {
    await setup();
    db.collectionMocks.gameState!.findOne.mockResolvedValue(null);

    const { POST } = await import("./route");
    const res = await POST();
    expect(res.status).toBe(404);
  });
});
