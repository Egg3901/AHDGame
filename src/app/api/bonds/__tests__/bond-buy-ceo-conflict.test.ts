import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { Db } from "mongodb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireBasicAuth: vi.fn() }));
vi.mock("@/lib/api/requireCorporationActions", () => ({
  requireCorporationActionsEnabled: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn().mockReturnValue({ ok: true }),
  rateLimitResponse: vi.fn(),
}));
vi.mock("@/lib/currency/featureFlag", () => ({ isForexEnabled: vi.fn().mockResolvedValue(true) }));
vi.mock("@/lib/currency/autoConvert", () => ({
  autoConvertForPurchase: vi.fn().mockResolvedValue({ needed: false, success: true }),
  convertForExplicitPay: vi.fn().mockResolvedValue({ success: true }),
}));
vi.mock("@/lib/financialTxLog/emit", () => ({ emitTx: vi.fn().mockResolvedValue(undefined) }));

let db: MockDb;
const userId = new ObjectId();
const charId = new ObjectId();
const corpId = new ObjectId();
const bondId = new ObjectId();

beforeEach(async () => {
  vi.clearAllMocks();
  db = createMockDb();
  for (const n of ["bonds", "corporations", "characters", "users", "gameState"]) db.collection(n);
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  const { requireBasicAuth } = await import("@/lib/api/requireAuth");
  vi.mocked(requireBasicAuth).mockResolvedValue({
    ok: true,
    user: { userId: userId.toString() },
  } as never);
  db.collectionMocks["users"]!.findOne.mockResolvedValue({
    _id: userId,
    activeCharacterId: charId,
    activeCharacterType: "regular",
  });
  db.collectionMocks["gameState"]!.findOne.mockResolvedValue({ _id: "current", currentTurn: 100 });
  db.collectionMocks["bonds"]!.findOne.mockResolvedValue({
    _id: bondId,
    currencyCode: "CNY",
    countryId: "CN",
    corporationId: corpId,
    marketPrice: 1,
    publicFloat: 1000,
    matured: false,
  });
  db.collectionMocks["characters"]!.findOne.mockResolvedValue({
    _id: charId,
    userId,
    countryId: "CN",
    currencyBalances: { personal: { CNY: 1e9 } },
  });
});

function buyReq() {
  return new Request(`http://localhost/api/bonds/${bondId}/buy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ units: 10 }),
  });
}

describe("bond buy — CEO ⊥ bondholder guard", () => {
  it("blocks a former CEO within the window with the previous-CEO message", async () => {
    db.collectionMocks["corporations"]!.findOne.mockResolvedValue({
      _id: corpId,
      ceoId: new ObjectId(), // someone else is CEO now
      ceoHistory: [{ holderId: charId, ceoType: "character", startTurn: 1, endTurn: 90 }],
    });
    const { POST } = await import("../[bondId]/buy/route");
    const res = await POST(buyReq(), { params: Promise.resolve({ bondId: bondId.toString() }) });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("Previous CEOs cannot buy bonds");
  });

  it("blocks the current pending CEO", async () => {
    db.collectionMocks["corporations"]!.findOne.mockResolvedValue({
      _id: corpId,
      ceoId: new ObjectId(),
      pendingCeoCharacterId: charId,
      ceoHistory: [],
    });
    const { POST } = await import("../[bondId]/buy/route");
    const res = await POST(buyReq(), { params: Promise.resolve({ bondId: bondId.toString() }) });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("Cannot buy your own corporation's bonds");
  });

  // The "allow" cases assert only that the CEO ⊥ bondholder GUARD did not fire
  // (its messages are absent); the downstream buy flow may still 400 for unrelated
  // mock reasons (e.g. atomic debit), which is out of scope for this guard test.
  async function guardMessage(corp: Record<string, unknown>): Promise<string> {
    db.collectionMocks["corporations"]!.findOne.mockResolvedValue(corp);
    const { POST } = await import("../[bondId]/buy/route");
    const res = await POST(buyReq(), { params: Promise.resolve({ bondId: bondId.toString() }) });
    const body = await res.json().catch(() => ({}));
    return body.error ?? "";
  }

  it("allows an unrelated buyer (guard does not fire)", async () => {
    const err = await guardMessage({ _id: corpId, ceoId: new ObjectId(), ceoHistory: [] });
    expect(err).not.toContain("Previous CEOs cannot buy bonds");
    expect(err).not.toContain("Cannot buy your own corporation's bonds");
  });

  it("allows a former CEO once past the window (guard does not fire)", async () => {
    // currentTurn 300, left at turn 100 → 200 turns ago, well past the 120 window.
    db.collectionMocks["gameState"]!.findOne.mockResolvedValue({
      _id: "current",
      currentTurn: 300,
    });
    const err = await guardMessage({
      _id: corpId,
      ceoId: new ObjectId(),
      ceoHistory: [{ holderId: charId, ceoType: "character", startTurn: 1, endTurn: 100 }],
    });
    expect(err).not.toContain("Previous CEOs cannot buy bonds");
    expect(err).not.toContain("Cannot buy your own corporation's bonds");
  });
});
