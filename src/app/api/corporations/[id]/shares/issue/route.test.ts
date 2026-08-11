import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireCorporationActions", () => ({
  requireCorporationActionsEnabled: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/api/requireAuth", () => ({ requireBasicAuth: vi.fn() }));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn().mockReturnValue({ ok: true }),
  rateLimitResponse: vi.fn(),
}));
vi.mock("@/lib/api/corporations/resolveQuery", () => ({
  resolveCorporation: vi.fn(),
  requireCeo: vi.fn().mockReturnValue(null),
}));
vi.mock("@/lib/currency/corporationCapital", async () => {
  const actual = await vi.importActual<typeof import("@/lib/currency/corporationCapital")>(
    "@/lib/currency/corporationCapital"
  );
  return {
    ...actual,
    getCorpFxRate: vi.fn().mockResolvedValue(1),
  };
});
vi.mock("@/lib/corporations/shareTradeHistory", () => ({ recordShareTrade: vi.fn() }));
vi.mock("@/lib/turn/currentTurn", () => ({ getCurrentTurn: vi.fn().mockResolvedValue(500) }));
vi.mock("@/lib/financialTxLog/emit", () => ({ emitTx: vi.fn().mockResolvedValue(undefined) }));

let db: MockDb;

beforeEach(async () => {
  db = createMockDb();
  vi.clearAllMocks();
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
});

describe("POST /api/corporations/[id]/shares/issue", () => {
  it("rejects share issuance for private corporations", async () => {
    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,
      user: { userId: new ObjectId().toString() },
    } as never);

    const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: true,
      corporation: {
        _id: new ObjectId(),
        name: "Private Corp",
        isPrivate: true,
        totalShares: 10_000_000,
        sharePrice: 1,
      },
    } as never);

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/corporations/x/shares/issue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ percent: 5 }),
      }),
      { params: Promise.resolve({ id: "x" }) }
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/private/i);
  });

  it("uses the fundamental execution price when float is too small for order-flow pricing", async () => {
    const corpId = new ObjectId();

    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,
      user: { userId: new ObjectId().toString() },
    } as never);

    const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: true,
      corporation: {
        _id: corpId,
        name: "General Electric",
        countryId: "US",
        liquidCurrencyCode: "USD",
        sharePrice: 40,
        fundamentalSharePrice: 10,
        publicFloat: 100,
        totalShares: 10_000,
      },
    } as never);

    db.collection("corporations");
    db.collectionMocks["corporations"].findOneAndUpdate.mockResolvedValue({
      _id: corpId,
      totalShares: 11_000,
    });

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/corporations/x/shares/issue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ percent: 10 }),
      }),
      { params: Promise.resolve({ id: "x" }) }
    );

    expect(response.status).toBe(200);
    // Uses the fundamental execution price (10), not the stale sharePrice (40),
    // because the float is too small for order-flow pricing.
    const body = await response.json();
    expect(body.pricePerShare).toBe(10);
    // Issuance creates float inventory only — totalShares + publicFloat rise, but
    // NO cash/proceeds are credited at issuance (Bug #0624). The corp realizes both
    // as the float is bought.
    const incArg = db.collectionMocks["corporations"].findOneAndUpdate.mock.calls[0][1].$inc;
    expect(incArg).toEqual({ totalShares: 1000, publicFloat: 1000 });
    expect(incArg.liquidCapital).toBeUndefined();
    expect(incArg.shareIssuanceProceeds).toBeUndefined();
  });
});
