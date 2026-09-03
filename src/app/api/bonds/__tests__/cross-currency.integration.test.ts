/**
 * Cross-currency regression tests for bond transactional routes.
 *
 * Locks in the fixes shipped in commit c53dadf9 (A19/A20/A21 corp-side
 * anchor normalization + A25 canonical `bond.currencyCode` resolution).
 *
 * Same-currency fixtures would pass even with the pre-fix bugs because the
 * FX scale factor was 1. The scenarios below cross currencies on purpose:
 *
 *   - JP corp buys/sells/buybacks a USD-denominated bond (A19/A20/A21):
 *     the corp's liquidCapital (USD) must be debited/credited by
 *     `costAnchor × corpFxRate`, NOT the raw `costLocal` (which would be
 *     off by the bond FX factor).
 *
 *   - Character paths where `bond.currencyCode` diverges from the issuer
 *     corp's `countryId` currency (A25): the character deduction/credit
 *     must use `bond.currencyCode` (canonical), never the corp's country
 *     currency. Simulates post-admin-HQ-relocation state.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { Db } from "mongodb";
import { MARKET_MAKER_SPREAD } from "@/lib/constants/currencies";

vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(),
  getMongoClient: vi.fn(async () => ({
    startSession: () => ({
      withTransaction: vi.fn(async () => {
        const err = new Error("transactions not supported on standalone") as Error & {
          code?: number;
        };
        err.code = 20;
        throw err;
      }),
      endSession: vi.fn(async () => {}),
    }),
  })),
}));
vi.mock("@/lib/api/requireAuth", () => ({
  requireBasicAuth: vi.fn(),
}));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn().mockReturnValue({ ok: true }),
  rateLimitResponse: vi.fn(),
}));
vi.mock("@/lib/currency/featureFlag", () => ({
  isForexEnabled: vi.fn().mockResolvedValue(true),
}));
vi.mock("@/lib/currency/autoConvert", () => ({
  autoConvertForPurchase: vi.fn().mockResolvedValue({ needed: false, success: true }),
  convertForExplicitPay: vi.fn().mockResolvedValue({ success: true }),
}));
vi.mock("@/lib/api/corporations/resolveQuery", () => ({
  resolveCorporation: vi.fn(),
  requireCeo: vi.fn().mockReturnValue(null),
}));
vi.mock("@/lib/financialTxLog/emit", () => ({
  emitTx: vi.fn().mockResolvedValue(undefined),
  emitTxBulk: vi.fn().mockResolvedValue(undefined),
  loadTxThresholds: vi.fn().mockResolvedValue({}),
}));

// FX rates shared across tests — chosen so every scale factor is visibly
// distinct: JPY≈114 ≠ USD≈1.04 ≠ GBP≈0.795 ≠ 1.0 (anchor).
const FX_USD = 1.04;
const FX_JPY = 113.88;

function makeCursor(docs: unknown[]) {
  return {
    toArray: vi.fn().mockResolvedValue(docs),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
  };
}

function setupExchangeRates(db: MockDb) {
  const rates = [
    { currencyCode: "USD", rate: FX_USD },
    { currencyCode: "JPY", rate: FX_JPY },
  ];
  db.collection("exchangeRates");
  db.collectionMocks["exchangeRates"]!.findOne.mockImplementation(
    (filter: { currencyCode?: string }) => {
      const doc = rates.find((r) => r.currencyCode === filter?.currencyCode);
      return Promise.resolve(doc ?? null);
    }
  );
  db.collectionMocks["exchangeRates"]!.find.mockReturnValue(makeCursor(rates));
}

describe("Bond transactional routes — cross-currency regression (A19-A21, A25)", () => {
  let db: MockDb;
  const userId = new ObjectId().toString();

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    // Pre-initialize every collection the routes touch so per-test `.mockResolvedValue`
    // calls on `db.collectionMocks[name]` never hit `undefined`.
    for (const name of [
      "bonds",
      "corporations",
      "characters",
      "users",
      "gameState",
      "exchangeRates",
      "imperialCharacters",
      "bondMarketPools",
    ]) {
      db.collection(name);
    }
    // A flush bond market pool so sells are never refused for depth here.
    db.collectionMocks["bondMarketPools"]!.findOne.mockResolvedValue({ cashLocal: 1e12 });
    db.collectionMocks["bondMarketPools"]!.findOneAndUpdate.mockResolvedValue({ cashLocal: 1e12 });
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,
      user: { userId, username: "tester", isAdmin: false } as any,
    });

    setupExchangeRates(db);
  });

  // ── BUY corp path (A19) ────────────────────────────────────────────────────
  it("buy: JP corp buying USD-denominated bond deducts liquidCapital in JPY via ₳ route", async () => {
    const corpId = new ObjectId();
    const bondId = new ObjectId();
    const issuerCorpId = new ObjectId();

    db.collectionMocks["bonds"]!.findOne.mockResolvedValue({
      _id: bondId,
      currencyCode: "USD",
      countryId: "US",
      corporationId: issuerCorpId,
      faceValue: 1000,
      marketPrice: 1.0,
      publicFloat: 10,
      holders: [],
      matured: false,
      defaulted: false,
    });
    db.collectionMocks["corporations"]!.findOne.mockResolvedValue({
      _id: corpId,
      userId: new ObjectId(userId),
      liquidCurrencyCode: "JPY",
      countryId: "JP",
      // 2M JPY ≈ 17,562 ₳ ≈ 18,265 USD of buying power — well above 10,000 USD cost.
      liquidCapital: 2_000_000,
    });
    // Atomic-debit guard simulation: corp has enough liquidCapital, return new balance.
    db.collectionMocks["corporations"]!.findOneAndUpdate.mockResolvedValue({
      _id: corpId,
      liquidCapital: 905_200, // ~2M − 1.094M JPY deduction
    });

    const url = `http://test.local/api/bonds/${bondId.toString()}/buy?corporationId=${corpId.toString()}`;
    const req = new Request(url, {
      method: "POST",
      body: JSON.stringify({ units: 10 }),
      headers: { "content-type": "application/json" },
    });

    const { POST } = await import("../[bondId]/buy/route");
    const res = await POST(req, { params: Promise.resolve({ bondId: bondId.toString() }) });
    expect(res.status).toBe(200);

    // Post-fix: costLocal (USD) = 10 × 1000 × 1.0 = 10,000 USD.
    //          costAnchor = 10,000 / 1.04 ≈ 9,615.38 ₳.
    //          JPY deduction = 9,615.38 × 113.88 ≈ 1,094,799.90 JPY.
    // Deduction now goes through findOneAndUpdate (atomic guard), not updateOne.
    // Pre-fix (A19): anchorToCorpLiquidCapital(10000 LOCAL, JPY, 113.88) = 10000 × 113.88
    //          = 1,138,800 JPY — wrong by ~44,000 JPY (the USD FX factor leaking through).
    const guardCalls = db.collectionMocks["corporations"]!.findOneAndUpdate.mock.calls;
    expect(guardCalls.length).toBeGreaterThanOrEqual(1);
    const update = guardCalls[0][1] as { $inc: { liquidCapital: number } };
    const actualDeduction = -update.$inc.liquidCapital;
    const expectedDeduction = 10_000 / ((1 - MARKET_MAKER_SPREAD) * (FX_USD / FX_JPY));
    expect(actualDeduction).toBeCloseTo(expectedDeduction, 0);
    // Explicitly reject the pre-fix value (10,000 × 113.88 = 1,138,800).
    expect(actualDeduction).not.toBeCloseTo(10_000 * FX_JPY, -1);
    // Filter must include the $gte balance gate (atomicity guarantee).
    const filter = guardCalls[0][0] as Record<string, unknown>;
    expect(filter.liquidCapital).toEqual({ $gte: expect.any(Number) });
  });

  // ── CORP bond_purchase ledger row carries both currencies ──────────────────
  it("emit: corp bond_purchase row records bondAmount in bondCurrency alongside the corp's local-currency amount", async () => {
    // The row's `currencyCode` and `amount` reflect what actually came out of
    // the corp's liquidCapital (JPY here). The bond is denominated in USD,
    // and `meta.bondAmount` exposes the cost in that bondCurrency so the
    // cross-currency relationship is explicit on the row itself — readers no
    // longer have to multiply pricePerUnit × units × face mentally to recover
    // the bond-side magnitude.
    const corpId = new ObjectId();
    const bondId = new ObjectId();
    const issuerCorpId = new ObjectId();

    db.collectionMocks["bonds"]!.findOne.mockResolvedValue({
      _id: bondId,
      currencyCode: "USD",
      countryId: "US",
      corporationId: issuerCorpId,
      faceValue: 1000,
      marketPrice: 1.0,
      publicFloat: 10,
      holders: [],
      matured: false,
      defaulted: false,
    });
    db.collectionMocks["corporations"]!.findOne.mockResolvedValue({
      _id: corpId,
      userId: new ObjectId(userId),
      liquidCurrencyCode: "JPY",
      countryId: "JP",
      liquidCapital: 2_000_000,
    });
    db.collectionMocks["corporations"]!.findOneAndUpdate.mockResolvedValue({
      _id: corpId,
      liquidCapital: 905_200,
    });

    const url = `http://test.local/api/bonds/${bondId.toString()}/buy?corporationId=${corpId.toString()}`;
    const req = new Request(url, {
      method: "POST",
      body: JSON.stringify({ units: 10 }),
      headers: { "content-type": "application/json" },
    });

    const { POST } = await import("../[bondId]/buy/route");
    const res = await POST(req, { params: Promise.resolve({ bondId: bondId.toString() }) });
    expect(res.status).toBe(200);

    const { emitTx } = await import("@/lib/financialTxLog/emit");
    const purchaseCall = vi
      .mocked(emitTx)
      .mock.calls.find(([, entry]) => (entry as { type?: string }).type === "bond_purchase");
    expect(purchaseCall).toBeDefined();
    const entry = purchaseCall![1] as {
      currencyCode: string;
      amount: number;
      meta?: { bondCurrency?: string; bondAmount?: number };
    };
    // Row's local-currency view: corp's liquidCapital is JPY, amount is the JPY deduction.
    expect(entry.currencyCode).toBe("JPY");
    expect(entry.amount).toBeLessThan(0);
    // The new field — bond-side cost in the bond's denomination.
    // costLocal (USD) = 10 units × $1000 face × 1.0 marketPrice = $10,000 USD.
    expect(entry.meta?.bondCurrency).toBe("USD");
    expect(entry.meta?.bondAmount).toBe(-10_000);
  });

  // ── SELL corp path (A20) ───────────────────────────────────────────────────
  it("sell: JP corp selling USD-denominated bond credits liquidCapital in JPY via ₳ route", async () => {
    const corpId = new ObjectId();
    const bondId = new ObjectId();
    const issuerCorpId = new ObjectId();

    db.collectionMocks["bonds"]!.findOne.mockResolvedValue({
      _id: bondId,
      currencyCode: "USD",
      countryId: "US",
      corporationId: issuerCorpId,
      faceValue: 1000,
      marketPrice: 1.02,
      publicFloat: 0,
      holders: [{ corporationId: corpId, units: 5 }],
      matured: false,
      defaulted: false,
    });
    db.collectionMocks["corporations"]!.findOne.mockResolvedValue({
      _id: corpId,
      userId: new ObjectId(userId),
      liquidCurrencyCode: "JPY",
      countryId: "JP",
      liquidCapital: 500_000,
    });

    const url = `http://test.local/api/bonds/${bondId.toString()}/sell?corporationId=${corpId.toString()}`;
    const req = new Request(url, {
      method: "POST",
      body: JSON.stringify({ units: 5 }),
      headers: { "content-type": "application/json" },
    });

    const { POST } = await import("../[bondId]/sell/route");
    const res = await POST(req, { params: Promise.resolve({ bondId: bondId.toString() }) });
    expect(res.status).toBe(200);

    // Post-fix: proceedsLocal (USD) = 5 × 1000 × 1.02 = 5,100 USD.
    //           proceedsAnchor = 5,100 / 1.04 ≈ 4,903.85 ₳.
    //           JPY credit = 4,903.85 × 113.88 ≈ 558,410 JPY.
    // Pre-fix (A20): anchorToCorpLiquidCapital(5100 LOCAL, JPY, 113.88) = 5100 × 113.88
    //           = 580,788 JPY — over-credited by the USD FX ratio.
    const creditCall = db.collectionMocks["corporations"]!.updateOne.mock.calls.find(
      (c: unknown[]) =>
        (c[1] as { $inc?: { liquidCapital?: number } })?.$inc?.liquidCapital !== undefined
    );
    expect(creditCall).toBeDefined();
    const actualCredit = (creditCall![1] as { $inc: { liquidCapital: number } }).$inc.liquidCapital;
    const expectedCredit = (5_100 / FX_USD) * FX_JPY;
    expect(actualCredit).toBeCloseTo(expectedCredit, 0);
    expect(actualCredit).not.toBeCloseTo(5_100 * FX_JPY, -1);
  });

  // ── BUYBACK corp path (A21) ────────────────────────────────────────────────
  it("buyback: JP corp buying back USD-denominated bond deducts liquidCapital in JPY via ₳ route", async () => {
    const corpId = new ObjectId();
    const bondId = new ObjectId();

    db.collectionMocks["bonds"]!.findOne.mockResolvedValue({
      _id: bondId,
      currencyCode: "USD",
      countryId: "US",
      corporationId: corpId,
      faceValue: 1000,
      marketPrice: 0.95,
      publicFloat: 20,
      totalIssued: 20_000,
      holders: [],
      matured: false,
      defaulted: false,
    });

    // Buyback uses `resolveCorporation` — mock it directly.
    const { resolveCorporation, requireCeo } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: true,
      corporation: {
        _id: corpId,
        ceoId: new ObjectId(),
        userId: new ObjectId(userId),
        liquidCurrencyCode: "JPY",
        countryId: "JP",
        // 10M JPY ≈ 87,811 ₳ ≈ 91,323 USD of buying power — well above 4,750 USD cost.
        liquidCapital: 10_000_000,
      } as any,
    });
    vi.mocked(requireCeo).mockReturnValue(null);

    const url = `http://test.local/api/bonds/${bondId.toString()}/buyback`;
    const req = new Request(url, {
      method: "POST",
      body: JSON.stringify({ units: 5 }),
      headers: { "content-type": "application/json" },
    });

    const { POST } = await import("../[bondId]/buyback/route");
    const res = await POST(req, { params: Promise.resolve({ bondId: bondId.toString() }) });
    expect(res.status).toBe(200);

    // Post-fix: costLocal (USD) = 5 × 1000 × 0.95 = 4,750 USD.
    //           With FX spread, required JPY = 4,750 / ((1 - spread) � USD/JPY).
    // Pre-fix (A21): anchorToCorpLiquidCapital(4750 LOCAL, JPY, 113.88) = 4,750 × 113.88
    //           = 540,930 JPY.
    const deductCall = db.collectionMocks["corporations"]!.updateOne.mock.calls.find(
      (c: unknown[]) =>
        (c[1] as { $inc?: { liquidCapital?: number } })?.$inc?.liquidCapital !== undefined
    );
    expect(deductCall).toBeDefined();
    const actualDeduction = -(deductCall![1] as { $inc: { liquidCapital: number } }).$inc
      .liquidCapital;
    const expectedDeduction = 4_750 / ((1 - MARKET_MAKER_SPREAD) * (FX_USD / FX_JPY));
    expect(actualDeduction).toBeCloseTo(expectedDeduction, 0);
    expect(actualDeduction).not.toBeCloseTo(4_750 * FX_JPY, -1);
  });

  // ── BUY character path (A25 canonical bond.currencyCode) ───────────────────
  it("buy: character-path resolves deduction currency from bond.currencyCode (A25)", async () => {
    // Simulates admin-HQ-relocated corp: bond was issued in JPY, but corp
    // now has countryId=US. Pre-A25 code would derive currency from corp.countryId
    // (→ USD) and attempt to debit the character's USD balance. Post-A25 uses
    // bond.currencyCode (→ JPY) and debits the character's JPY balance.
    const charId = new ObjectId();
    const bondId = new ObjectId();
    const issuerCorpId = new ObjectId();

    db.collectionMocks["users"]!.findOne.mockResolvedValue({
      _id: new ObjectId(userId),
      activeCharacterId: charId,
      activeCharacterType: "regular",
    });
    db.collectionMocks["bonds"]!.findOne.mockResolvedValue({
      _id: bondId,
      currencyCode: "JPY", // canonical — set at issuance
      countryId: "JP",
      corporationId: issuerCorpId,
      faceValue: 1000,
      marketPrice: 1.0,
      publicFloat: 50,
      holders: [],
      matured: false,
      defaulted: false,
    });
    // Issuing corp has been admin-relocated to US post-issuance (divergence).
    let corpFindCalls = 0;
    db.collectionMocks["corporations"]!.findOne.mockImplementation(() => {
      corpFindCalls++;
      // First call: issuing-corp ceoId lookup (CEO gate).
      if (corpFindCalls === 1) {
        return Promise.resolve({ _id: issuerCorpId, ceoId: new ObjectId() });
      }
      return Promise.resolve(null);
    });
    db.collectionMocks["characters"]!.findOne.mockResolvedValue({
      _id: charId,
      userId: new ObjectId(userId),
      countryId: "US",
      currencyBalances: {
        personal: { USD: 0, JPY: 5_000_000 },
      },
    });
    // Atomic-debit guard simulation: findOneAndUpdate matches when JPY ≥ 10,000.
    db.collectionMocks["characters"]!.findOneAndUpdate.mockResolvedValue({
      _id: charId,
      currencyBalances: { personal: { JPY: 4_990_000 } },
    });
    db.collectionMocks["gameState"]!.findOne.mockResolvedValue({
      _id: "current",
      forexEnabled: true,
      currentTurn: 100,
    });

    const url = `http://test.local/api/bonds/${bondId.toString()}/buy`;
    const req = new Request(url, {
      method: "POST",
      body: JSON.stringify({ units: 10 }),
      headers: { "content-type": "application/json" },
    });

    const { POST } = await import("../[bondId]/buy/route");
    const res = await POST(req, { params: Promise.resolve({ bondId: bondId.toString() }) });
    expect(res.status).toBe(200);

    // Post-fix: deduction goes through findOneAndUpdate with $gte filter,
    // not the legacy updateOne $inc path. Verify the canonical currency (A25)
    // routes the debit to JPY (bond.currencyCode), NOT USD (corp.countryId).
    const guardCalls = db.collectionMocks["characters"]!.findOneAndUpdate.mock.calls;
    expect(guardCalls.length).toBeGreaterThanOrEqual(1);
    const filter = guardCalls[0][0] as Record<string, unknown>;
    expect(filter["currencyBalances.personal.JPY"]).toEqual({ $gte: 10_000 });
    // Pre-A25 would have gated USD instead — explicitly absent.
    expect(filter["currencyBalances.personal.USD"]).toBeUndefined();

    const update = guardCalls[0][1] as { $inc: Record<string, number> };
    expect(update.$inc["currencyBalances.personal.JPY"]).toBe(-10_000);
  });

  // ── SELL character path (A25-ext canonical bond.currencyCode) ──────────────
  it("sell: character-path credits proceeds in bond.currencyCode (A25-ext)", async () => {
    // Mirror scenario to the buy test: a bond with `currencyCode=USD` whose
    // issuing corp has been admin-relocated to JP post-issuance. A JP-home
    // character selling should have USD credited (canonical bond currency),
    // NOT JPY (which the pre-A25 code would derive from corp.countryId).
    const charId = new ObjectId();
    const bondId = new ObjectId();
    const issuerCorpId = new ObjectId();

    db.collectionMocks["users"]!.findOne.mockResolvedValue({
      _id: new ObjectId(userId),
      activeCharacterId: charId,
      activeCharacterType: "regular",
    });
    db.collectionMocks["bonds"]!.findOne.mockResolvedValue({
      _id: bondId,
      currencyCode: "USD", // canonical
      countryId: "US",
      corporationId: issuerCorpId,
      faceValue: 1000,
      marketPrice: 1.0,
      publicFloat: 0,
      holders: [{ characterId: charId, units: 7 }],
      matured: false,
      defaulted: false,
    });
    // Divergent issuing corp: now in JP (admin-relocated).
    db.collectionMocks["corporations"]!.findOne.mockResolvedValue({
      _id: issuerCorpId,
      countryId: "JP",
    });
    db.collectionMocks["characters"]!.findOne.mockResolvedValue({
      _id: charId,
      userId: new ObjectId(userId),
      countryId: "JP",
    });

    const url = `http://test.local/api/bonds/${bondId.toString()}/sell`;
    const req = new Request(url, {
      method: "POST",
      body: JSON.stringify({ units: 7 }),
      headers: { "content-type": "application/json" },
    });

    const { POST } = await import("../[bondId]/sell/route");
    const res = await POST(req, { params: Promise.resolve({ bondId: bondId.toString() }) });
    expect(res.status).toBe(200);

    const charUpdateCall = db.collectionMocks["characters"]!.updateOne.mock.calls.find(
      (c: unknown[]) => {
        const update = c[1] as { $inc?: Record<string, number> };
        return !!update?.$inc;
      }
    );
    expect(charUpdateCall).toBeDefined();
    const incUpdate = (charUpdateCall![1] as { $inc: Record<string, number> }).$inc;
    // Post-A25-ext: credit key targets USD, value = 7 × 1000 × 1.0 = 7,000 USD.
    expect(incUpdate["currencyBalances.personal.USD"]).toBe(7_000);
    // Pre-A25-ext would have targeted JPY (corp.countryId) — explicitly absent.
    expect(incUpdate["currencyBalances.personal.JPY"]).toBeUndefined();
  });
});
