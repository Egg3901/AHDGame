import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { MARKET_MAKER_SPREAD } from "@/lib/constants/currencies";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/rateLimit", () => ({ checkRateLimit: vi.fn().mockReturnValue({ ok: true }) }));
vi.mock("@/lib/api/requireAuth", () => ({
  requireBasicAuth: vi.fn(),
}));
vi.mock("@/lib/currency/featureFlag", () => ({
  isForexEnabled: vi.fn().mockResolvedValue(false),
}));
vi.mock("@/lib/currency/corporationCapital", async () => {
  const actual = await vi.importActual<typeof import("@/lib/currency/corporationCapital")>(
    "@/lib/currency/corporationCapital"
  );
  return {
    ...actual,
    loadFxRatesRecord: vi.fn().mockResolvedValue({ USD: 1, GBP: 0.75, JPY: 100 }),
  };
});
vi.mock("@/lib/api/corporations/resolveQuery", () => ({ resolveCorporation: vi.fn() }));
vi.mock("@/lib/corporations/shareholderOps", () => ({
  creditShares: vi.fn().mockResolvedValue(true),
  creditSharesToCorp: vi.fn().mockResolvedValue(true),
  creditSharesToImperial: vi.fn().mockResolvedValue(true),
  debitShares: vi.fn().mockResolvedValue(0),
  debitSharesFromCorp: vi.fn().mockResolvedValue(0),
  debitSharesFromImperial: vi.fn().mockResolvedValue(0),
}));
vi.mock("@/lib/financialTxLog/emit", () => ({ emitTx: vi.fn() }));

let db: MockDb;

beforeEach(() => {
  db = createMockDb();
  vi.clearAllMocks();
});

async function setup() {
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as any);
}

describe("POST /api/corporations/[id]/shares/buy — buyAsCorporation", () => {
  it("rejects if caller is not authenticated", async () => {
    await setup();
    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: false,
      response: Response.json({ error: "Unauthorized" }, { status: 401 }),
    } as any);

    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/corporations/abc/shares/buy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shares: 100, buyAsCorporation: true }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "abc" }) });
    expect(res.status).toBe(401);
  });

  it("uses corp liquidCapital instead of character cashOnHand", async () => {
    await setup();
    const userId = new ObjectId();
    const ceoId = new ObjectId();
    const buyingCorpId = new ObjectId();
    const targetCorpId = new ObjectId();

    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,
      user: { userId: userId.toString() },
    } as any);

    const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: true,
      corporation: {
        _id: targetCorpId,
        sharePrice: 10,
        publicFloat: 1000,
        shareholders: [],
        ceoId: new ObjectId(), // different CEO — not self-dealing
      },
    } as any);

    // Mock users collection for user doc lookup
    db.collection("users");
    db.collectionMocks["users"].findOne.mockResolvedValue({
      _id: userId,
      activeCharacterId: ceoId,
      activeCharacterType: "character",
    });

    // Mock characters collection for character lookup
    db.collection("characters");
    db.collectionMocks["characters"].findOne.mockResolvedValue({
      _id: ceoId,
      userId,
      countryId: "US",
      cashOnHand: 0,
    });

    // Pre-register the corporations collection
    const corpsMock = db.collection("corporations") as any;
    corpsMock.findOne.mockResolvedValue({
      _id: buyingCorpId,
      ceoId,
      liquidCapital: 50000,
      ceoVacant: false,
    });
    corpsMock.updateOne.mockResolvedValue({ modifiedCount: 1 });
    // Atomic-debit guard: Phase 2 routes the corp deduction through
    // findOneAndUpdate with a $gte filter on liquidCapital. Mock a successful
    // match so the route proceeds with the deduction.
    corpsMock.findOneAndUpdate.mockResolvedValue({
      _id: buyingCorpId,
      liquidCapital: 49000,
    });

    const { creditSharesToCorp } = await import("@/lib/corporations/shareholderOps");

    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/corporations/abc/shares/buy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shares: 100, buyAsCorporation: true }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "abc" }) });

    expect(res.status).toBe(200);
    expect(creditSharesToCorp).toHaveBeenCalled();
    // Deduction now goes through findOneAndUpdate with $gte gate.
    const expectedDebit = 1000;
    expect(db.collectionMocks["corporations"].findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ _id: buyingCorpId, liquidCapital: { $gte: expectedDebit } }),
      expect.objectContaining({ $inc: expect.objectContaining({ liquidCapital: -expectedDebit }) }),
      expect.objectContaining({ returnDocument: "after" })
    );
    // Bug #0624 conservation: the buyer's 1000 is injected into the ISSUER
    // (target) corp's treasury, AND records realized issuance proceeds — issuance
    // itself no longer pre-credits either field. 100 shares × 10 = 1000.
    expect(db.collectionMocks["corporations"].findOneAndUpdate).toHaveBeenCalledWith(
      { _id: targetCorpId },
      expect.objectContaining({
        $inc: expect.objectContaining({ liquidCapital: 1000, shareIssuanceProceeds: 1000 }),
      }),
      expect.objectContaining({ returnDocument: "after" })
    );
  });

  it("converts cost to buying corp home currency when countries differ", async () => {
    // UK corp (GBP, rate=0.75) buys shares in US corp (USD, sharePrice=10).
    // Post-v0.2.6: sharePrice is stored in the target corp's liquidCurrencyCode
    // (USD here; rate mocked to null → falls back to 1.0). Route normalizes
    // shares × sharePrice to ₳ (100 × 10 ÷ 1 = 1,000 ₳), then anchor→GBP via
    // the buyer's 0.75 rate → 750 GBP debited from the buying corp's
    // liquidCapital. A JP-target scenario would be the regression case missed
    // by the old "sharePrice is ₳" assumption.
    await setup();
    const userId = new ObjectId();
    const ceoId = new ObjectId();
    const buyingCorpId = new ObjectId();
    const targetCorpId = new ObjectId();

    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,
      user: { userId: userId.toString() },
    } as any);

    const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: true,
      corporation: {
        _id: targetCorpId,
        countryId: "US",
        sharePrice: 10,
        publicFloat: 1000,
        shareholders: [],
        ceoId: new ObjectId(),
      },
    } as any);

    // Mock users collection
    db.collection("users");
    db.collectionMocks["users"].findOne.mockResolvedValue({
      _id: userId,
      activeCharacterId: ceoId,
      activeCharacterType: "character",
    });

    // Mock characters collection
    db.collection("characters");
    db.collectionMocks["characters"].findOne.mockResolvedValue({
      _id: ceoId,
      userId,
      countryId: "US",
      cashOnHand: 0,
    });

    const corpsMock = db.collection("corporations") as any;
    corpsMock.findOne.mockResolvedValue({
      _id: buyingCorpId,
      ceoId,
      countryId: "UK",
      liquidCurrencyCode: "GBP",
      liquidCapital: 50000,
      ceoVacant: false,
    });
    corpsMock.updateOne.mockResolvedValue({ modifiedCount: 1 });
    corpsMock.findOneAndUpdate.mockResolvedValue({
      _id: buyingCorpId,
      liquidCapital: 49250,
    });

    // Mock the GBP FX rate lookup used by getCorpFxRate()
    const ratesMock = db.collection("exchangeRates") as any;
    ratesMock.findOne.mockImplementation((filter: { currencyCode?: string }) => {
      if (filter?.currencyCode === "GBP")
        return Promise.resolve({ currencyCode: "GBP", rate: 0.75 });
      return Promise.resolve(null);
    });

    const { creditSharesToCorp } = await import("@/lib/corporations/shareholderOps");

    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/corporations/abc/shares/buy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shares: 100, buyAsCorporation: true }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "abc" }) });

    expect(res.status).toBe(200);
    expect(creditSharesToCorp).toHaveBeenCalled();
    // 1000 ₳ × 0.75 GBP/₳ = 750 GBP debited from buying corp's liquidCapital
    // — now via the $gte-gated atomic guard. The exact spend includes the FX
    // spread plus a sub-unit rounding buffer, so assert within ±2 rather than
    // pinning the exact float (which shifts with MARKET_MAKER_SPREAD).
    const expectedDebit = 1000 / ((1 - MARKET_MAKER_SPREAD) * (1 / 0.75));
    const guardCall = db.collectionMocks["corporations"].findOneAndUpdate.mock.calls[0];
    expect(guardCall).toBeDefined();
    const guardFilter = guardCall[0] as { liquidCapital: { $gte: number } };
    const guardUpdate = guardCall[1] as { $inc: { liquidCapital: number } };
    const debited = -guardUpdate.$inc.liquidCapital;
    expect(guardFilter.liquidCapital.$gte).toBe(debited);
    expect(debited).toBeGreaterThanOrEqual(expectedDebit);
    expect(debited - expectedDebit).toBeLessThan(2);
  });

  it("anchor-normalizes cost when target corp is non-USD (JP regression)", async () => {
    // Regression coverage for the Task 18A → shares-routes propagation gap.
    // Pre-fix, the buy route treated `shares × sharePrice` as ₳ directly.
    // When sharePrice is denominated in JPY (target corp is JP, rate = 100
    // JPY/₳), that raw product is ~100× the actual ₳ value.
    //
    // Setup: JP target corp at ¥1,000/share × 100 shares = ¥100,000 local
    // cost. At 100 JPY/₳, that's 1,000 ₳. US buying corp has USD rate 1.0,
    // so 1,000 ₳ → 1,000 USD debited from its liquidCapital.
    //
    // Under the old code this would have mis-debited 100,000 USD — a 100×
    // overcharge. Keeping this test as the guardrail for any future
    // sharePrice-storage refactor.
    await setup();
    const userId = new ObjectId();
    const ceoId = new ObjectId();
    const buyingCorpId = new ObjectId();
    const targetCorpId = new ObjectId();

    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,
      user: { userId: userId.toString() },
    } as any);

    const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: true,
      corporation: {
        _id: targetCorpId,
        countryId: "JP",
        liquidCurrencyCode: "JPY",
        sharePrice: 1000,
        publicFloat: 1000,
        shareholders: [],
        ceoId: new ObjectId(),
      },
    } as any);

    db.collection("users");
    db.collectionMocks["users"].findOne.mockResolvedValue({
      _id: userId,
      activeCharacterId: ceoId,
      activeCharacterType: "character",
    });

    db.collection("characters");
    db.collectionMocks["characters"].findOne.mockResolvedValue({
      _id: ceoId,
      userId,
      countryId: "US",
      cashOnHand: 0,
    });

    const corpsMock = db.collection("corporations") as any;
    corpsMock.findOne.mockResolvedValue({
      _id: buyingCorpId,
      ceoId,
      countryId: "US",
      liquidCurrencyCode: "USD",
      liquidCapital: 10_000_000,
      ceoVacant: false,
    });
    corpsMock.updateOne.mockResolvedValue({ modifiedCount: 1 });
    corpsMock.findOneAndUpdate.mockResolvedValue({
      _id: buyingCorpId,
      liquidCapital: 9_999_000,
    });

    // Target corp: JPY at 100/₳ → sharePrice of 1000 = 10 ₳.
    // Buyer corp: USD at 1.0/₳ → pass-through.
    const ratesMock = db.collection("exchangeRates") as any;
    ratesMock.findOne.mockImplementation((filter: { currencyCode?: string }) => {
      if (filter?.currencyCode === "JPY")
        return Promise.resolve({ currencyCode: "JPY", rate: 100 });
      if (filter?.currencyCode === "USD")
        return Promise.resolve({ currencyCode: "USD", rate: 1.0 });
      return Promise.resolve(null);
    });

    const { creditSharesToCorp } = await import("@/lib/corporations/shareholderOps");

    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/corporations/abc/shares/buy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shares: 100, buyAsCorporation: true }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "abc" }) });

    expect(res.status).toBe(200);
    expect(creditSharesToCorp).toHaveBeenCalled();
    // 100 × ¥1,000 = ¥100,000 local → ÷ 100 JPY/₳ = 1,000 ₳ → × 1.0 USD/₳ = 1,000 USD.
    // Pre-fix: 100,000 ₳ × 1.0 = 100,000 USD (wrong — 100× overcharge).
    // Atomic guard form (Phase 2):
    const expectedBaseDebit = 100_000 / ((1 - MARKET_MAKER_SPREAD) * 100);
    const guardCall = db.collectionMocks["corporations"].findOneAndUpdate.mock.calls[0];
    expect(guardCall).toBeDefined();
    const filter = guardCall[0] as { liquidCapital: { $gte: number } };
    const update = guardCall[1] as { $inc: { liquidCapital: number } };
    const actualDebit = -update.$inc.liquidCapital;
    expect(filter.liquidCapital.$gte).toBe(actualDebit);
    expect(actualDebit).toBeGreaterThanOrEqual(expectedBaseDebit);
    expect(actualDebit - expectedBaseDebit).toBeLessThan(2);
  });

  it("rolls back corporation share credits if settlement fails after the fill", async () => {
    await setup();
    const userId = new ObjectId();
    const ceoId = new ObjectId();
    const buyingCorpId = new ObjectId();
    const targetCorpId = new ObjectId();

    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,
      user: { userId: userId.toString() },
    } as any);

    const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: true,
      corporation: {
        _id: targetCorpId,
        sharePrice: 10,
        publicFloat: 1000,
        shareholders: [],
        ceoId: new ObjectId(),
      },
    } as any);

    db.collection("users");
    db.collectionMocks["users"].findOne.mockResolvedValue({
      _id: userId,
      activeCharacterId: ceoId,
      activeCharacterType: "character",
    });

    db.collection("characters");
    db.collectionMocks["characters"].findOne.mockResolvedValue({
      _id: ceoId,
      userId,
      countryId: "US",
    });

    const corpsMock = db.collection("corporations") as any;
    corpsMock.findOne.mockResolvedValue({
      _id: buyingCorpId,
      ceoId,
      liquidCapital: 50000,
      ceoVacant: false,
    });
    corpsMock.findOneAndUpdate.mockResolvedValue({
      _id: buyingCorpId,
      liquidCapital: 49000,
    });

    const { emitTx } = await import("@/lib/financialTxLog/emit");
    vi.mocked(emitTx).mockRejectedValueOnce(new Error("ledger failed"));

    const { debitSharesFromCorp } = await import("@/lib/corporations/shareholderOps");

    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/corporations/abc/shares/buy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shares: 100, buyAsCorporation: true }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "abc" }) });

    expect(res.status).toBe(500);
    expect(debitSharesFromCorp).toHaveBeenCalledWith(
      expect.anything(),
      targetCorpId,
      buyingCorpId,
      100,
      {
        $inc: { publicFloat: 100, orderFlowWindowBuyValue: -1000 },
        $set: expect.any(Object),
      },
      { requireSufficient: true }
    );
  });
});
