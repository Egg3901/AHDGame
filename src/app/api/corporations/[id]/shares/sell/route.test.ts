import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/rateLimit", () => ({ checkRateLimit: vi.fn().mockReturnValue({ ok: true }) }));
vi.mock("@/lib/api/requireAuth", () => ({ requireBasicAuth: vi.fn() }));
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
// Treasury-backed market maker: by default the issuer treasury covers the
// buyback so existing sell behavior is preserved. The cap (ok:false) is
// exercised by a dedicated test below.
vi.mock("@/lib/financialTxLog/atomicCashGuard", () => ({
  atomicallyDebitCorpLiquidCapital: vi.fn().mockResolvedValue({ ok: true, newBalance: 0 }),
  refundCorpLiquidCapital: vi.fn().mockResolvedValue(undefined),
  decrementCorpIssuanceProceeds: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/currency/featureFlag", () => ({ isForexEnabled: vi.fn().mockResolvedValue(false) }));

let db: MockDb;
beforeEach(async () => {
  db = createMockDb();
  vi.clearAllMocks();
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as any);
});

describe("POST /api/corporations/[id]/shares/sell — character seller", () => {
  it("rejects market-sell when open character sell orders reserve the shares", async () => {
    const userId = new ObjectId();
    const charId = new ObjectId();
    const targetCorpId = new ObjectId();

    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,
      user: { userId: userId.toString() },
    } as any);

    db.collection("users");
    db.collectionMocks["users"].findOne.mockResolvedValue({
      _id: userId,
      activeCharacterId: charId,
      activeCharacterType: "character",
    });

    db.collection("characters");
    db.collectionMocks["characters"].findOne.mockResolvedValue({
      _id: charId,
      userId,
      countryId: "US",
    });

    const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: true,
      corporation: {
        _id: targetCorpId,
        sharePrice: 10,
        publicFloat: 0,
        shareholders: [{ characterId: charId, shares: 100 }],
        ceoId: new ObjectId(),
      },
    } as any);

    // Pending character sell order for the full 100 shares — no debit at creation,
    // so shareholders still shows 100 but those are reserved.
    db.collection("shareOrders");
    db.collectionMocks["shareOrders"].find.mockReturnValueOnce({
      toArray: async () => [
        {
          _id: new ObjectId(),
          corporationId: targetCorpId,
          characterId: charId,
          type: "sell",
          status: "open",
          sharesRemaining: 100,
        },
      ],
    });

    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/corporations/abc/shares/sell", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shares: 100, sellAsCorporation: false }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "abc" }) });
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain("0 shares available");
    expect(json.error).toContain("100 reserved");
  });

  it("rejects the sell when the issuer treasury can't cover the buyback (cap)", async () => {
    const userId = new ObjectId();
    const charId = new ObjectId();
    const targetCorpId = new ObjectId();

    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,
      user: { userId: userId.toString() },
    } as any);

    db.collection("users");
    db.collectionMocks["users"].findOne.mockResolvedValue({
      _id: userId,
      activeCharacterId: charId,
      activeCharacterType: "character",
    });
    db.collection("characters");
    db.collectionMocks["characters"].findOne.mockResolvedValue({
      _id: charId,
      userId,
      countryId: "US",
    });

    const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: true,
      corporation: {
        _id: targetCorpId,
        name: "Acme",
        sharePrice: 10,
        publicFloat: 1_000_000,
        totalShares: 10_000_000,
        shareholders: [{ characterId: charId, shares: 100 }],
        ceoId: new ObjectId(),
      },
    } as any);

    db.collection("shareOrders");
    db.collectionMocks["shareOrders"].find.mockReturnValue({ toArray: async () => [] });

    // Treasury can't cover the buyback this time.
    const { atomicallyDebitCorpLiquidCapital } =
      await import("@/lib/financialTxLog/atomicCashGuard");
    vi.mocked(atomicallyDebitCorpLiquidCapital).mockResolvedValueOnce({
      ok: false,
      error: "Insufficient corporate funds",
    });

    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/corporations/abc/shares/sell", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shares: 100, sellAsCorporation: false }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "abc" }) });
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain("treasury can't cover");
    // No shares were moved — the gate rejected before the share debit.
    const { debitShares } = await import("@/lib/corporations/shareholderOps");
    expect(debitShares).not.toHaveBeenCalled();
  });

  it("ignores sell orders that already debited the holder balance", async () => {
    const userId = new ObjectId();
    const charId = new ObjectId();
    const targetCorpId = new ObjectId();

    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,
      user: { userId: userId.toString() },
    } as any);

    db.collection("users");
    db.collectionMocks["users"].findOne.mockResolvedValue({
      _id: userId,
      activeCharacterId: charId,
      activeCharacterType: "character",
    });

    db.collection("characters");
    db.collectionMocks["characters"].findOne.mockResolvedValue({
      _id: charId,
      userId,
      countryId: "US",
      name: "Seller",
    });

    const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: true,
      corporation: {
        _id: targetCorpId,
        sharePrice: 10,
        publicFloat: 0,
        shareholders: [{ characterId: charId, shares: 100 }],
        ceoId: new ObjectId(),
      },
    } as any);

    db.collection("shareOrders");
    db.collectionMocks["shareOrders"].find.mockReturnValueOnce({
      toArray: async () => [
        {
          _id: new ObjectId(),
          corporationId: targetCorpId,
          characterId: charId,
          type: "sell",
          status: "open",
          sharesRemaining: 100,
          sharesDebitedAtCreation: true,
        },
      ],
    });

    const { debitShares } = await import("@/lib/corporations/shareholderOps");
    vi.mocked(debitShares).mockResolvedValueOnce(-1);

    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/corporations/abc/shares/sell", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shares: 100, sellAsCorporation: false }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "abc" }) });
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.error).toContain("already sold or reserved");
    expect(debitShares).toHaveBeenCalledWith(
      expect.anything(),
      targetCorpId,
      charId,
      100,
      expect.anything(),
      { requireSufficient: true }
    );
  });

  it("vacates the CEO immediately when they sell every unreserved share", async () => {
    const userId = new ObjectId();
    const charId = new ObjectId();
    const targetCorpId = new ObjectId();

    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,
      user: { userId: userId.toString() },
    } as any);

    db.collection("users");
    db.collectionMocks["users"].findOne.mockResolvedValue({
      _id: userId,
      activeCharacterId: charId,
      activeCharacterType: "character",
    });

    db.collection("characters");
    db.collectionMocks["characters"].findOne.mockResolvedValue({
      _id: charId,
      userId,
      countryId: "US",
      name: "CEO Seller",
    });

    db.collection("gameState");
    db.collectionMocks["gameState"].findOne.mockResolvedValue({ _id: "current", currentTurn: 42 });

    const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: true,
      corporation: {
        _id: targetCorpId,
        sharePrice: 10,
        publicFloat: 0,
        shareholders: [{ characterId: charId, shares: 100 }],
        ceoId: charId,
        userId,
      },
    } as any);

    db.collection("shareOrders");
    db.collectionMocks["shareOrders"].find.mockReturnValueOnce({
      toArray: async () => [],
    });

    const { debitShares } = await import("@/lib/corporations/shareholderOps");
    vi.mocked(debitShares).mockResolvedValueOnce(0);

    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/corporations/abc/shares/sell", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shares: 100, sellAsCorporation: false, confirmCeoVacate: true }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "abc" }) });

    expect(res.status).toBe(200);
    expect(debitShares).toHaveBeenCalledWith(
      expect.anything(),
      targetCorpId,
      charId,
      100,
      {
        $inc: { publicFloat: 100, orderFlowWindowSellValue: 1000 },
        $set: expect.objectContaining({
          ceoVacant: true,
          ceoVacantSinceTurn: 42,
        }),
        $unset: { ceoId: "", userId: "", pendingCeoCharacterId: "" },
      },
      { requireSufficient: true }
    );
    expect(db.collectionMocks["corporationCeoVotes"].deleteMany).toHaveBeenCalledWith({
      corporationId: targetCorpId,
    });
  });

  it("returns 409 requiresCeoVacateConfirm without confirmCeoVacate, and makes no mutation", async () => {
    const userId = new ObjectId();
    const charId = new ObjectId();
    const targetCorpId = new ObjectId();

    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,
      user: { userId: userId.toString() },
    } as any);

    db.collection("users");
    db.collectionMocks["users"].findOne.mockResolvedValue({
      _id: userId,
      activeCharacterId: charId,
      activeCharacterType: "character",
    });

    db.collection("characters");
    db.collectionMocks["characters"].findOne.mockResolvedValue({
      _id: charId,
      userId,
      countryId: "US",
      name: "CEO Seller",
    });

    const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: true,
      corporation: {
        _id: targetCorpId,
        name: "Acme",
        sharePrice: 10,
        publicFloat: 0,
        shareholders: [{ characterId: charId, shares: 100 }],
        ceoId: charId,
        userId,
      },
    } as any);

    db.collection("shareOrders");
    db.collectionMocks["shareOrders"].find.mockReturnValueOnce({
      toArray: async () => [],
    });

    const { debitShares } = await import("@/lib/corporations/shareholderOps");
    const { atomicallyDebitCorpLiquidCapital } =
      await import("@/lib/financialTxLog/atomicCashGuard");

    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/corporations/abc/shares/sell", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shares: 100, sellAsCorporation: false }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "abc" }) });
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.requiresCeoVacateConfirm).toBe(true);
    expect(json.error).toContain("Acme");
    expect(json.error).toMatch(/CEO/i);
    expect(debitShares).not.toHaveBeenCalled();
    // The buyback gate (treasury debit) must not have run either — no mutation at all.
    expect(atomicallyDebitCorpLiquidCapital).not.toHaveBeenCalled();
  });

  it("does not require confirmation for a partial sale by the CEO", async () => {
    const userId = new ObjectId();
    const charId = new ObjectId();
    const targetCorpId = new ObjectId();

    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,
      user: { userId: userId.toString() },
    } as any);

    db.collection("users");
    db.collectionMocks["users"].findOne.mockResolvedValue({
      _id: userId,
      activeCharacterId: charId,
      activeCharacterType: "character",
    });

    db.collection("characters");
    db.collectionMocks["characters"].findOne.mockResolvedValue({
      _id: charId,
      userId,
      countryId: "US",
      name: "CEO Seller",
    });

    db.collection("gameState");
    db.collectionMocks["gameState"].findOne.mockResolvedValue({ _id: "current", currentTurn: 42 });

    const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: true,
      corporation: {
        _id: targetCorpId,
        sharePrice: 10,
        publicFloat: 0,
        // CEO owns 100 shares but only sells 40 — should not vacate or require confirm.
        shareholders: [{ characterId: charId, shares: 100 }],
        ceoId: charId,
        userId,
      },
    } as any);

    db.collection("shareOrders");
    db.collectionMocks["shareOrders"].find.mockReturnValueOnce({
      toArray: async () => [],
    });

    const { debitShares } = await import("@/lib/corporations/shareholderOps");
    vi.mocked(debitShares).mockResolvedValueOnce(60);

    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/corporations/abc/shares/sell", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shares: 40, sellAsCorporation: false }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "abc" }) });

    expect(res.status).toBe(200);
    expect(debitShares).toHaveBeenCalledWith(
      expect.anything(),
      targetCorpId,
      charId,
      40,
      expect.objectContaining({
        $set: expect.not.objectContaining({ ceoVacant: true }),
      }),
      { requireSufficient: true }
    );
    expect(debitShares).not.toHaveBeenCalledWith(
      expect.anything(),
      targetCorpId,
      charId,
      40,
      expect.objectContaining({ $unset: expect.anything() }),
      { requireSufficient: true }
    );
  });

  it("vacates an imperial CEO immediately when they sell every share", async () => {
    const userId = new ObjectId();
    const imperialId = new ObjectId();
    const targetCorpId = new ObjectId();

    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,
      user: { userId: userId.toString() },
    } as any);

    db.collection("users");
    db.collectionMocks["users"].findOne.mockResolvedValue({
      _id: userId,
      activeImperialCharacterId: imperialId,
      activeCharacterType: "imperial",
    });

    db.collection("imperialCharacters");
    db.collectionMocks["imperialCharacters"].findOne.mockResolvedValue({
      _id: imperialId,
      userId,
      countryId: "JP",
      homeState: "KANTO",
      name: "Imperial CEO",
    });

    db.collection("gameState");
    db.collectionMocks["gameState"].findOne.mockResolvedValue({ _id: "current", currentTurn: 77 });

    const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: true,
      corporation: {
        _id: targetCorpId,
        sharePrice: 12,
        publicFloat: 0,
        shareholders: [{ imperialCharacterId: imperialId, shares: 50 }],
        ceoId: imperialId,
        ceoType: "imperial",
        userId,
      },
    } as any);

    const { debitSharesFromImperial } = await import("@/lib/corporations/shareholderOps");
    vi.mocked(debitSharesFromImperial).mockResolvedValueOnce(0);

    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/corporations/abc/shares/sell", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shares: 50, sellAsCorporation: false, confirmCeoVacate: true }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "abc" }) });

    expect(res.status).toBe(200);
    expect(debitSharesFromImperial).toHaveBeenCalledWith(
      expect.anything(),
      targetCorpId,
      imperialId,
      50,
      {
        $inc: { publicFloat: 50, orderFlowWindowSellValue: 600 },
        $set: expect.objectContaining({
          ceoVacant: true,
          ceoVacantSinceTurn: 77,
        }),
        $unset: { ceoId: "", userId: "", pendingCeoCharacterId: "" },
      },
      { requireSufficient: true }
    );
    expect(db.collectionMocks["corporationCeoVotes"].deleteMany).toHaveBeenCalledWith({
      corporationId: targetCorpId,
    });
  });

  it("returns 409 requiresCeoVacateConfirm for an imperial CEO full divest without the flag", async () => {
    const userId = new ObjectId();
    const imperialId = new ObjectId();
    const targetCorpId = new ObjectId();

    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,
      user: { userId: userId.toString() },
    } as any);

    db.collection("users");
    db.collectionMocks["users"].findOne.mockResolvedValue({
      _id: userId,
      activeImperialCharacterId: imperialId,
      activeCharacterType: "imperial",
    });

    db.collection("imperialCharacters");
    db.collectionMocks["imperialCharacters"].findOne.mockResolvedValue({
      _id: imperialId,
      userId,
      countryId: "JP",
      homeState: "KANTO",
      name: "Imperial CEO",
    });

    const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: true,
      corporation: {
        _id: targetCorpId,
        name: "Imperial Co",
        sharePrice: 12,
        publicFloat: 0,
        shareholders: [{ imperialCharacterId: imperialId, shares: 50 }],
        ceoId: imperialId,
        ceoType: "imperial",
        userId,
      },
    } as any);

    const { debitSharesFromImperial } = await import("@/lib/corporations/shareholderOps");

    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/corporations/abc/shares/sell", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shares: 50, sellAsCorporation: false }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "abc" }) });
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.requiresCeoVacateConfirm).toBe(true);
    expect(debitSharesFromImperial).not.toHaveBeenCalled();
  });

  it("restores character shares and CEO state if the seller credit misses", async () => {
    const userId = new ObjectId();
    const charId = new ObjectId();
    const targetCorpId = new ObjectId();

    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,
      user: { userId: userId.toString() },
    } as any);

    db.collection("users");
    db.collectionMocks["users"].findOne.mockResolvedValue({
      _id: userId,
      activeCharacterId: charId,
      activeCharacterType: "character",
    });

    db.collection("characters");
    db.collectionMocks["characters"].findOne.mockResolvedValue({
      _id: charId,
      userId,
      countryId: "US",
      name: "CEO Seller",
    });
    db.collectionMocks["characters"].updateOne.mockResolvedValue({ matchedCount: 0 });
    db.collection("corporationCeoVotes");

    db.collection("gameState");
    db.collectionMocks["gameState"].findOne.mockResolvedValue({ _id: "current", currentTurn: 42 });

    const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: true,
      corporation: {
        _id: targetCorpId,
        sharePrice: 10,
        publicFloat: 0,
        shareholders: [{ characterId: charId, shares: 100, avgCostPerShare: 7 }],
        ceoId: charId,
        userId,
      },
    } as any);

    db.collection("shareOrders");
    db.collectionMocks["shareOrders"].find.mockReturnValueOnce({
      toArray: async () => [],
    });

    const { creditShares, debitShares } = await import("@/lib/corporations/shareholderOps");

    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/corporations/abc/shares/sell", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shares: 100, sellAsCorporation: false, confirmCeoVacate: true }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "abc" }) });

    expect(res.status).toBe(500);
    expect(debitShares).toHaveBeenCalledWith(
      expect.anything(),
      targetCorpId,
      charId,
      100,
      expect.anything(),
      { requireSufficient: true }
    );
    expect(creditShares).toHaveBeenCalledWith(
      expect.anything(),
      targetCorpId,
      charId,
      100,
      {
        $inc: { publicFloat: -100, orderFlowWindowSellValue: -1000 },
        $set: expect.any(Object),
      },
      { pricePerShare: 7 }
    );
    expect(db.collectionMocks["corporations"].updateOne).toHaveBeenCalledWith(
      { _id: targetCorpId },
      expect.objectContaining({
        $set: expect.objectContaining({
          ceoId: charId,
          userId,
          ceoVacant: false,
        }),
      })
    );
    expect(db.collectionMocks["corporationCeoVotes"].deleteMany).not.toHaveBeenCalled();
  });

  it("restores imperial shares and CEO state if the imperial seller credit misses", async () => {
    const userId = new ObjectId();
    const imperialId = new ObjectId();
    const targetCorpId = new ObjectId();

    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,
      user: { userId: userId.toString() },
    } as any);

    db.collection("users");
    db.collectionMocks["users"].findOne.mockResolvedValue({
      _id: userId,
      activeImperialCharacterId: imperialId,
      activeCharacterType: "imperial",
    });

    db.collection("imperialCharacters");
    db.collectionMocks["imperialCharacters"].findOne.mockResolvedValue({
      _id: imperialId,
      userId,
      countryId: "JP",
      homeState: "KANTO",
      name: "Imperial CEO",
    });
    db.collectionMocks["imperialCharacters"].updateOne.mockResolvedValue({ matchedCount: 0 });
    db.collection("corporationCeoVotes");

    db.collection("gameState");
    db.collectionMocks["gameState"].findOne.mockResolvedValue({ _id: "current", currentTurn: 77 });

    const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: true,
      corporation: {
        _id: targetCorpId,
        sharePrice: 12,
        publicFloat: 0,
        shareholders: [{ imperialCharacterId: imperialId, shares: 50, avgCostPerShare: 8 }],
        ceoId: imperialId,
        ceoType: "imperial",
        userId,
      },
    } as any);

    const { creditSharesToImperial, debitSharesFromImperial } =
      await import("@/lib/corporations/shareholderOps");

    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/corporations/abc/shares/sell", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shares: 50, sellAsCorporation: false, confirmCeoVacate: true }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "abc" }) });

    expect(res.status).toBe(500);
    expect(debitSharesFromImperial).toHaveBeenCalledWith(
      expect.anything(),
      targetCorpId,
      imperialId,
      50,
      expect.anything(),
      { requireSufficient: true }
    );
    expect(creditSharesToImperial).toHaveBeenCalledWith(
      expect.anything(),
      targetCorpId,
      imperialId,
      50,
      {
        $inc: { publicFloat: -50, orderFlowWindowSellValue: -600 },
        $set: expect.any(Object),
      },
      { pricePerShare: 8 }
    );
    expect(db.collectionMocks["corporations"].updateOne).toHaveBeenCalledWith(
      { _id: targetCorpId },
      expect.objectContaining({
        $set: expect.objectContaining({
          ceoId: imperialId,
          userId,
          ceoVacant: false,
        }),
      })
    );
    expect(db.collectionMocks["corporationCeoVotes"].deleteMany).not.toHaveBeenCalled();
  });
});

describe("POST /api/corporations/[id]/shares/sell — corp seller", () => {
  it("credits proceeds to corporation liquidCapital", async () => {
    const userId = new ObjectId();
    const ceoId = new ObjectId();
    const sellerCorpId = new ObjectId();
    const targetCorpId = new ObjectId();

    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,
      user: { userId: userId.toString() },
    } as any);

    // Mock users collection for user doc lookup (regular character mode)
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
    });

    const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: true,
      corporation: {
        _id: targetCorpId,
        sharePrice: 15,
        publicFloat: 0,
        shareholders: [{ corporationId: sellerCorpId, shares: 500 }],
        ceoId: new ObjectId(),
      },
    } as any);

    // Pre-initialize the corporations collection mock so it exists before the route accesses it
    db.collection("corporations");
    db.collectionMocks["corporations"].findOne.mockResolvedValue({
      _id: sellerCorpId,
      ceoId,
      liquidCapital: 10000,
    });
    db.collectionMocks["corporations"].updateOne.mockResolvedValue({ modifiedCount: 1 });

    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/corporations/abc/shares/sell", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shares: 100, sellAsCorporation: true }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "abc" }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.proceeds).toBe(1500);
    expect(db.collectionMocks["corporations"].updateOne).toHaveBeenCalledWith(
      { _id: sellerCorpId },
      expect.objectContaining({ $inc: expect.objectContaining({ liquidCapital: 1500 }) })
    );
    // Bug #0624: selling back into the float backs out the issuer's realized
    // issuance proceeds (100 shares × 15 = 1500) on the TARGET (issuer) corp, so
    // the share-price book-floor lever tracks the float shrinking. This mirrors
    // the +shareIssuanceProceeds credit applied when the float was bought.
    const { decrementCorpIssuanceProceeds } = await import("@/lib/financialTxLog/atomicCashGuard");
    expect(decrementCorpIssuanceProceeds).toHaveBeenCalledWith(
      expect.anything(),
      targetCorpId,
      1500,
      undefined
    );
  });
});
