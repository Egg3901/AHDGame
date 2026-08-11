import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireBasicAuth: vi.fn() }));
vi.mock("@/lib/api/requireCorporationActions", () => ({
  requireCorporationActionsEnabled: vi.fn(),
}));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn(),
  rateLimitResponse: vi.fn(
    (retryAfter?: number) =>
      new Response(JSON.stringify({ error: "Too many requests" }), {
        status: 429,
        headers: { "Retry-After": String(retryAfter ?? 60) },
      })
  ),
}));
vi.mock("@/lib/api/corporations/resolveQuery", () => ({
  resolveCorporation: vi.fn(),
  requireCeo: vi.fn(),
}));
vi.mock("@/lib/gameState", () => ({ getGameState: vi.fn() }));
vi.mock("@/lib/currency/corporationCapital", () => ({
  getCorpFxRate: vi.fn().mockResolvedValue(1),
  corpLiquidCapitalToAnchor: vi.fn((v: number) => v),
  anchorToCorpLiquidCapital: vi.fn((v: number) => v),
  loadFxRatesByCurrency: vi.fn().mockResolvedValue(new Map([["USD", 1]])),
  fxRateForCorpFromMap: vi.fn(() => 1),
  resolveCorpLiquidCurrencyCode: vi.fn(
    (corp: { liquidCurrencyCode?: string } | null | undefined) =>
      corp?.liquidCurrencyCode ?? undefined
  ),
}));
vi.mock("@/lib/currency/featureFlag", () => ({
  isForexEnabled: vi.fn().mockResolvedValue(false),
}));
vi.mock("@/lib/corporations/convertCorpCurrency", () => ({
  convertCorpCurrency: vi.fn().mockResolvedValue({ ok: true, converted: false }),
}));
vi.mock("@/lib/wireEvent", () => ({ logWireEvent: vi.fn() }));
vi.mock("@/lib/corporations/issueRelocationBond", () => ({
  previewRelocationBond: vi.fn(),
  issueRelocationBond: vi.fn(),
}));

let db: MockDb;

beforeEach(() => {
  db = createMockDb();
  vi.clearAllMocks();
  db.collection("states");
  db.collection("characters");
  db.collection("corporations");
});

async function setup(options: {
  userId: string;
  ceoCharId: ObjectId;
  corp: Record<string, unknown>;
  targetState: { _id: string; name: string; countryId: string };
  ceoHomeState: string;
}) {
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as import("mongodb").Db);

  const { requireBasicAuth } = await import("@/lib/api/requireAuth");
  vi.mocked(requireBasicAuth).mockResolvedValue({
    ok: true,
    user: { userId: options.userId },
  } as never);

  const { requireCorporationActionsEnabled } = await import("@/lib/api/requireCorporationActions");
  vi.mocked(requireCorporationActionsEnabled).mockResolvedValue(null);

  const { checkRateLimit } = await import("@/lib/api/rateLimit");
  vi.mocked(checkRateLimit).mockReturnValue({
    ok: true,
    limit: 100,
    remaining: 99,
    resetAt: Date.now() + 60_000,
  });

  const { resolveCorporation, requireCeo } = await import("@/lib/api/corporations/resolveQuery");
  vi.mocked(resolveCorporation).mockResolvedValue({
    ok: true,
    corporation: options.corp,
  } as never);
  vi.mocked(requireCeo).mockReturnValue(null);

  db.collectionMocks.states.findOne.mockResolvedValue(options.targetState);
  db.collectionMocks.characters.findOne.mockResolvedValue({
    homeState: options.ceoHomeState,
    userId: new ObjectId(options.userId),
  });

  const { getGameState } = await import("@/lib/gameState");
  vi.mocked(getGameState).mockResolvedValue({ currentTurn: 100 } as never);
}

describe("POST /api/corporations/[id]/relocate", () => {
  it("same-country cash move: deducts cost, keeps CEO", async () => {
    const userId = new ObjectId().toString();
    const corpId = new ObjectId();
    const ceoCharId = new ObjectId();
    await setup({
      userId,
      ceoCharId,
      corp: {
        _id: corpId,
        countryId: "US",
        headquartersState: "CA",
        ceoId: ceoCharId,
        ceoType: "character",
        isPrivate: true,
        liquidCapital: 100_000_000,
        liquidCurrencyCode: "USD",
        sharePrice: 10,
        totalShares: 1_000_000,
        name: "TestCorp",
      },
      targetState: { _id: "TX", name: "Texas", countryId: "US" },
      ceoHomeState: "TX",
    });

    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/corporations/1/relocate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetStateId: "TX", paymentMethod: "cash" }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "1" }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.cost).toBe(700_000);
    expect(data.crossCountry).toBe(false);
    expect(data.ceoVacated).toBe(false);
    const call = db.collectionMocks.corporations.updateOne.mock.calls[0];
    const update = call[1] as { $set: Record<string, unknown>; $unset?: Record<string, unknown> };
    expect(update.$set.headquartersState).toBe("TX");
    expect(update.$set.countryId).toBe("US");
    expect(update.$unset).toBeUndefined();
  });

  it("cross-country cash move: doubles cost, updates countryId", async () => {
    const userId = new ObjectId().toString();
    const corpId = new ObjectId();
    const ceoCharId = new ObjectId();
    await setup({
      userId,
      ceoCharId,
      corp: {
        _id: corpId,
        countryId: "US",
        headquartersState: "CA",
        ceoId: ceoCharId,
        ceoType: "character",
        isPrivate: true,
        liquidCapital: 100_000_000,
        liquidCurrencyCode: "USD",
        sharePrice: 10,
        totalShares: 1_000_000,
        name: "TestCorp",
      },
      targetState: { _id: "LON", name: "London", countryId: "UK" },
      ceoHomeState: "LON",
    });

    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/corporations/1/relocate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetStateId: "LON", paymentMethod: "cash" }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "1" }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.cost).toBe(1_400_000);
    expect(data.crossCountry).toBe(true);
    expect(data.ceoVacated).toBe(false);
    const update = db.collectionMocks.corporations.updateOne.mock.calls[0][1] as {
      $set: Record<string, unknown>;
    };
    expect(update.$set.countryId).toBe("UK");
  });

  it("cross-country cross-currency move: triggers currency conversion + refetches corp", async () => {
    // US (USD) → UK (GBP) forces a currency conversion. Override the default
    // `{ converted: false }` mock to simulate a real conversion that flips the
    // corp's liquidCurrencyCode. The route must refetch the corp after
    // conversion so the downstream $inc lands in the new currency.
    const { convertCorpCurrency } = await import("@/lib/corporations/convertCorpCurrency");
    vi.mocked(convertCorpCurrency).mockResolvedValueOnce({
      ok: true,
      converted: true,
      fromCurrency: "USD",
      toCurrency: "GBP",
      scale: 0.77,
      sectorsConverted: 3,
      ordersCancelled: 2,
      listingsCancelled: 1,
    });
    const userId = new ObjectId().toString();
    const corpId = new ObjectId();
    const ceoCharId = new ObjectId();
    await setup({
      userId,
      ceoCharId,
      corp: {
        _id: corpId,
        countryId: "US",
        headquartersState: "CA",
        ceoId: ceoCharId,
        ceoType: "character",
        isPrivate: true,
        liquidCapital: 100_000_000,
        liquidCurrencyCode: "USD",
        sharePrice: 10,
        totalShares: 1_000_000,
        name: "TestCorp",
      },
      targetState: { _id: "LON", name: "London", countryId: "UK" },
      ceoHomeState: "LON",
    });
    // Post-conversion refetch returns the same corp with new currencyCode + scaled fields.
    db.collectionMocks.corporations.findOne.mockResolvedValueOnce({
      _id: corpId,
      countryId: "US",
      liquidCurrencyCode: "GBP",
      liquidCapital: 77_000_000,
      sharePrice: 7.7,
      totalShares: 1_000_000,
      name: "TestCorp",
    });

    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/corporations/1/relocate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetStateId: "LON", paymentMethod: "cash" }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "1" }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    // Response surfaces conversion telemetry to the client.
    expect(data.currencyConversion).toEqual({
      from: "USD",
      to: "GBP",
      scale: 0.77,
      sectorsConverted: 3,
      ordersCancelled: 2,
      listingsCancelled: 1,
    });
    expect(data.crossCountry).toBe(true);
    // Helper was invoked exactly once with the target currency.
    expect(convertCorpCurrency).toHaveBeenCalledTimes(1);
    const convArgs = vi.mocked(convertCorpCurrency).mock.calls[0];
    expect(convArgs[2]).toBe("GBP");
    // The refetch after conversion: second corporations.findOne (first was setup's, if any).
    expect(db.collectionMocks.corporations.findOne).toHaveBeenCalled();
  });

  it("CEO not at destination: auto-vacates the CEO role", async () => {
    const userId = new ObjectId().toString();
    const corpId = new ObjectId();
    const ceoCharId = new ObjectId();
    await setup({
      userId,
      ceoCharId,
      corp: {
        _id: corpId,
        countryId: "US",
        headquartersState: "CA",
        ceoId: ceoCharId,
        ceoType: "character",
        isPrivate: true,
        liquidCapital: 100_000_000,
        liquidCurrencyCode: "USD",
        sharePrice: 10,
        totalShares: 1_000_000,
        name: "TestCorp",
      },
      targetState: { _id: "TX", name: "Texas", countryId: "US" },
      ceoHomeState: "CA",
    });

    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/corporations/1/relocate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetStateId: "TX", paymentMethod: "cash" }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "1" }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ceoVacated).toBe(true);
    const update = db.collectionMocks.corporations.updateOne.mock.calls[0][1] as {
      $set: Record<string, unknown>;
      $unset?: Record<string, unknown>;
    };
    expect(update.$set.ceoVacant).toBe(true);
    expect(update.$unset).toEqual({ ceoId: "", userId: "" });
    // Two corp updates now: the relocate/vacate write, then the ceoHistory
    // tenure close (stamps endTurn on the outgoing CEO's open tenure).
    expect(db.collectionMocks.corporations.updateOne.mock.calls).toHaveLength(2);
    const tenureClose = db.collectionMocks.corporations.updateOne.mock.calls[1][1] as {
      $set: Record<string, unknown>;
    };
    expect(Object.keys(tenureClose.$set).some((k) => k.includes("ceoHistory"))).toBe(true);
  });

  it("insufficient cash: returns 400, no mutation", async () => {
    const userId = new ObjectId().toString();
    const corpId = new ObjectId();
    const ceoCharId = new ObjectId();
    await setup({
      userId,
      ceoCharId,
      corp: {
        _id: corpId,
        countryId: "US",
        headquartersState: "CA",
        ceoId: ceoCharId,
        ceoType: "character",
        isPrivate: true,
        liquidCapital: 100,
        liquidCurrencyCode: "USD",
        sharePrice: 10,
        totalShares: 1_000_000,
        name: "TestCorp",
      },
      targetState: { _id: "TX", name: "Texas", countryId: "US" },
      ceoHomeState: "TX",
    });

    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/corporations/1/relocate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetStateId: "TX", paymentMethod: "cash" }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "1" }) });
    expect(res.status).toBe(400);
    expect(db.collectionMocks.corporations.updateOne).not.toHaveBeenCalled();
  });
});
