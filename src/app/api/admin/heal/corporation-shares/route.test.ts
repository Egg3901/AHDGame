import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAdmin", () => ({
  requireAdmin: vi.fn().mockResolvedValue({ ok: true }),
}));

let db: ReturnType<typeof createInMemoryDb>;
beforeEach(async () => {
  db = createInMemoryDb();
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as never);
});

describe("corporation share recalculation", () => {
  it("preserves modern and legacy reservations, listings and float without counting retained holdings twice", async () => {
    const corporationId = new ObjectId();
    db.seed("corporations", [
      {
        _id: corporationId,
        name: "Test",
        totalShares: 100,
        publicFloat: 10,
        shareholders: [{ characterId: new ObjectId(), shares: 50 }],
      },
    ]);
    db.seed("shareListings", [{ corporationId, status: "open", sharesRemaining: 5 }]);
    db.seed("shareOrders", [
      {
        corporationId,
        type: "sell",
        status: "open",
        shares: 40,
        sharesRemaining: 25,
        sharesDebitedAtCreation: true,
      },
      {
        corporationId,
        type: "sell",
        status: "open",
        sharesRemaining: 10,
        placerCorporationId: new ObjectId(),
      },
      { corporationId, type: "sell", status: "open", sharesRemaining: 10 },
      {
        corporationId,
        type: "sell",
        status: "open",
        sharesRemaining: 10,
        sharesDebitedAtCreation: false,
      },
      {
        corporationId,
        type: "sell",
        status: "cancelled",
        sharesRemaining: 500,
        sharesDebitedAtCreation: true,
      },
      {
        corporationId,
        type: "buy",
        status: "open",
        sharesRemaining: 500,
        sharesDebitedAtCreation: true,
      },
    ]);
    const { POST } = await import("./route");
    const response = await POST();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ fixes: [], totalChecked: 1 });
    expect((await db.collection("corporations").findOne({ _id: corporationId }))?.totalShares).toBe(
      100
    );
  });
});
