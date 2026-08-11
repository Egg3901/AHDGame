import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuthWithCharacter: vi.fn() }));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn().mockReturnValue({ ok: true }),
  rateLimitResponse: vi.fn(),
}));
vi.mock("@/lib/turn/currentTurn", () => ({ getCurrentTurn: vi.fn().mockResolvedValue(10) }));
vi.mock("@/lib/nationalization/treasury", () => ({
  drawFromTreasury: vi.fn().mockResolvedValue({ ok: true, amount: 0 }),
}));

let db: MockDb;
const ceoId = new ObjectId();
const corpId = new ObjectId();

function makeRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/country/CN/national-corporation/900007/treasury-draw", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
const ctx = { params: Promise.resolve({ code: "CN", id: "900007" }) };

beforeEach(async () => {
  vi.clearAllMocks();
  db = createMockDb();
  db.collection("corporations");
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
  vi.mocked(requireAuthWithCharacter).mockResolvedValue({
    ok: true,
    user: { userId: new ObjectId().toString(), character: { _id: ceoId, name: "CEO" } },
  } as never);
  // Cap 1000, already drew 300 on turn 10 (the current turn) → 700 allowance.
  db.collectionMocks.corporations.findOne.mockResolvedValue({
    _id: corpId,
    sequentialId: 900_007,
    countryId: "CN",
    countryOwnerId: "CN",
    ownershipState: "stateOwned",
    ceoVacant: false,
    ceoId,
    treasuryDrawCap: 1000,
    treasuryDrawnThisTurn: 300,
    treasuryDrawTurn: 10,
  });
});

describe("POST .../treasury-draw", () => {
  it("draws within the per-turn allowance and increments the tally", async () => {
    const { drawFromTreasury } = await import("@/lib/nationalization/treasury");
    vi.mocked(drawFromTreasury).mockResolvedValue({ ok: true, amount: 500 });
    const { POST } = await import("./route");
    const res = await POST(makeRequest({ amount: 500 }), ctx);
    expect(res.status).toBe(200);
    expect(vi.mocked(drawFromTreasury)).toHaveBeenCalledWith(
      db,
      { countryId: "CN", corpId, amountLocal: 500 },
      expect.any(Date)
    );
    expect(
      db.collectionMocks.corporations.updateOne.mock.calls[0][1].$inc.treasuryDrawnThisTurn
    ).toBe(500);
  });

  it("rejects a draw over the remaining per-turn allowance", async () => {
    const { drawFromTreasury } = await import("@/lib/nationalization/treasury");
    const { POST } = await import("./route");
    const res = await POST(makeRequest({ amount: 800 }), ctx); // 800 > 700 allowance
    expect(res.status).toBe(400);
    expect(vi.mocked(drawFromTreasury)).not.toHaveBeenCalled();
  });

  it("allows a draw even when the reserve is short — the country takes on debt", async () => {
    const { drawFromTreasury } = await import("@/lib/nationalization/treasury");
    vi.mocked(drawFromTreasury).mockResolvedValue({ ok: true, amount: 500 });
    const { POST } = await import("./route");
    const res = await POST(makeRequest({ amount: 500 }), ctx);
    expect(res.status).toBe(200);
    expect(vi.mocked(drawFromTreasury)).toHaveBeenCalled();
  });

  it("403s for a non-CEO", async () => {
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: { userId: new ObjectId().toString(), character: { _id: new ObjectId(), name: "X" } },
    } as never);
    const { POST } = await import("./route");
    const res = await POST(makeRequest({ amount: 100 }), ctx);
    expect(res.status).toBe(403);
  });
});
