/**
 * Regression tests for POST /api/corporations/[id]/bond-default/cash —
 * specifically the financial-ledger emission added to fix the gap where
 * defaulted-bond cash payoffs moved millions silently with no tx rows.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn(), getMongoClient: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireBasicAuth: vi.fn() }));
vi.mock("@/lib/api/corporations/resolveQuery", () => ({
  resolveCorporation: vi.fn(),
  requireCeo: vi.fn(),
}));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn(),
  rateLimitResponse: vi.fn(),
}));
vi.mock("@/lib/currency/featureFlag", () => ({
  isForexEnabled: vi.fn().mockResolvedValue(false),
}));
vi.mock("@/lib/corporations/settlementLock", () => ({
  withCorporationSettlementLock: vi.fn(
    async (
      _db: unknown,
      _corpId: unknown,
      _field: unknown,
      _now: unknown,
      run: () => Promise<unknown>
    ) => run()
  ),
}));
vi.mock("@/lib/financialTxLog/emit", () => ({
  emitTx: vi.fn().mockResolvedValue(undefined),
  emitTxBulk: vi.fn().mockResolvedValue(undefined),
  loadTxThresholds: vi.fn().mockResolvedValue({}),
}));
vi.mock("@/lib/gameState", () => ({
  getGameState: vi.fn().mockResolvedValue({ currentTurn: 444 }),
}));

let db: MockDb;
let endSessionMock: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  vi.clearAllMocks();
  endSessionMock = vi.fn().mockResolvedValue(undefined);
  db = createMockDb();
  for (const name of [
    "bonds",
    "corporations",
    "characters",
    "imperialCharacters",
    "exchangeRates",
  ]) {
    db.collection(name);
  }
  db.collectionMocks["bonds"]!.updateMany.mockResolvedValue({
    modifiedCount: 1,
    matchedCount: 1,
  } as never);
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as never);
  const { getMongoClient } = await import("@/lib/mongodb");
  vi.mocked(getMongoClient).mockResolvedValue({
    startSession: () => ({
      withTransaction: vi.fn(async (callback: () => Promise<unknown>) => callback()),
      endSession: endSessionMock,
    }),
  } as never);
  const { requireBasicAuth } = await import("@/lib/api/requireAuth");
  vi.mocked(requireBasicAuth).mockResolvedValue({
    ok: true,
    user: { userId: new ObjectId().toString() },
  } as never);
  const { checkRateLimit } = await import("@/lib/api/rateLimit");
  vi.mocked(checkRateLimit).mockReturnValue({
    ok: true,
    limit: 100,
    remaining: 99,
    resetAt: Date.now() + 60_000,
  });
  const { requireCeo } = await import("@/lib/api/corporations/resolveQuery");
  vi.mocked(requireCeo).mockReturnValue(null);
});

function makeCursor(docs: unknown[]) {
  return {
    toArray: vi.fn().mockResolvedValue(docs),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
  };
}

describe("POST /api/corporations/[id]/bond-default/cash — ledger emission", () => {
  it("emits bond_maturity tx rows for every holder receiving face value", async () => {
    // Pre-fix: the cash route deducted liquidCapital from the issuer corp,
    // credited each holder's wallet/lc, and matured the bonds — all without
    // a single financialTxLog row. A ~$193M default cure flow disappeared
    // from the audit trail. This pins the new emit so every holder receives
    // a `bond_maturity` row.
    const corpId = new ObjectId();
    const charId = new ObjectId();
    const imperialId = new ObjectId();
    const corpHolderId = new ObjectId();
    const bondId = new ObjectId();

    const corporation = {
      _id: corpId,
      name: "Test Issuer",
      countryId: "US",
      liquidCapital: 1_000_000,
      liquidCurrencyCode: "USD",
    };

    const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: true,
      corporation,
    } as never);
    db.collectionMocks["corporations"]!.findOne.mockResolvedValue(corporation as never);

    const defaultedBond = {
      _id: bondId,
      corporationId: corpId,
      currencyCode: "USD",
      matured: false,
      defaulted: true,
      couponRate: 8,
      holders: [
        { characterId: charId, units: 10 },
        { imperialCharacterId: imperialId, units: 5 },
        { corporationId: corpHolderId, units: 3 },
      ],
    };

    db.collectionMocks["bonds"]!.find.mockReturnValue(makeCursor([defaultedBond]));
    // FX rates — empty (USD bonds, no conversion)
    db.collectionMocks["exchangeRates"]!.find.mockReturnValue(makeCursor([]));
    // Holder docs for currency lookup
    db.collectionMocks["characters"]!.find.mockReturnValue({
      project: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([{ _id: charId, countryId: "US" }]),
      }),
    });
    db.collectionMocks["imperialCharacters"]!.find.mockReturnValue({
      project: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([{ _id: imperialId, countryId: "US" }]),
      }),
    });
    // Holder corp lookup
    db.collectionMocks["corporations"]!.find.mockReturnValue(
      makeCursor([
        {
          _id: corpHolderId,
          name: "Holder Corp",
          countryId: "US",
          liquidCurrencyCode: "USD",
        },
      ])
    );

    const req = new Request(
      `http://localhost/api/corporations/${corpId.toString()}/bond-default/cash`,
      { method: "POST" }
    );
    const { POST } = await import("./route");
    const res = await POST(req, { params: Promise.resolve({ id: corpId.toString() }) });
    expect(res.status).toBe(200);

    const { emitTxBulk } = await import("@/lib/financialTxLog/emit");
    expect(vi.mocked(emitTxBulk)).toHaveBeenCalled();
    const allEntries = vi.mocked(emitTxBulk).mock.calls.flatMap((c) => c[1] as unknown[]);

    const charEntry = allEntries.find(
      (e: unknown) =>
        (e as { type?: string }).type === "bond_maturity" &&
        (e as { subjectId?: ObjectId }).subjectId?.toString() === charId.toString()
    ) as
      | {
          type: string;
          subjectType: string;
          subjectId: ObjectId;
          amount: number;
          currencyCode: string;
          meta?: { bondId?: string; units?: number };
        }
      | undefined;
    expect(charEntry).toBeDefined();
    expect(charEntry!.subjectType).toBe("character");
    expect(charEntry!.amount).toBeGreaterThan(0);
    expect(charEntry!.currencyCode).toBe("USD");
    expect(charEntry!.meta?.bondId).toBe(bondId.toString());
    expect(charEntry!.meta?.units).toBe(10);

    const imperialEntry = allEntries.find(
      (e: unknown) =>
        (e as { type?: string }).type === "bond_maturity" &&
        (e as { subjectId?: ObjectId }).subjectId?.toString() === imperialId.toString()
    ) as
      | { subjectType: string; amount: number; meta?: { units?: number; imperial?: boolean } }
      | undefined;
    expect(imperialEntry).toBeDefined();
    expect(imperialEntry!.subjectType).toBe("character");
    expect(imperialEntry!.meta?.imperial).toBe(true);
    expect(imperialEntry!.meta?.units).toBe(5);

    const corpHolderEntry = allEntries.find(
      (e: unknown) =>
        (e as { type?: string }).type === "bond_maturity" &&
        (e as { subjectType?: string }).subjectType === "corporation" &&
        (e as { subjectId?: ObjectId }).subjectId?.toString() === corpHolderId.toString()
    ) as
      | {
          subjectType: string;
          subjectName: string;
          currencyCode: string;
          amount: number;
          meta?: {
            units?: number;
            bondCurrency?: string;
            bondAmount?: number;
          };
        }
      | undefined;
    expect(corpHolderEntry).toBeDefined();
    expect(corpHolderEntry!.subjectName).toBe("Holder Corp");
    expect(corpHolderEntry!.meta?.units).toBe(3);
    // Same-currency fixture (USD bond, USD holder): row amount and meta.bondAmount
    // are both in USD and should match the same numeric value.
    expect(corpHolderEntry!.currencyCode).toBe("USD");
    expect(corpHolderEntry!.meta?.bondCurrency).toBe("USD");
    expect(corpHolderEntry!.meta?.bondAmount).toBeCloseTo(corpHolderEntry!.amount);
  });

  it("preserves defaultedAtTurn and stamps defaultCure on cured bonds", async () => {
    // Pre-fix: the cure routes did `$unset: { defaultedAtTurn: "" }`, erasing
    // the bond's default history from the doc. Post-fix: the historical mark
    // stays, and a defaultCure object is added so the Bonds tab can render a
    // "DEFAULT CURED" badge instead of a bare MATURED chip.
    const corpId = new ObjectId();
    const charId = new ObjectId();
    const corporation = {
      _id: corpId,
      name: "Test Issuer",
      countryId: "US",
      liquidCapital: 1_000_000,
      liquidCurrencyCode: "USD",
    };
    const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({ ok: true, corporation } as never);
    db.collectionMocks["corporations"]!.findOne.mockResolvedValue(corporation as never);

    db.collectionMocks["bonds"]!.find.mockReturnValue(
      makeCursor([
        {
          _id: new ObjectId(),
          corporationId: corpId,
          currencyCode: "USD",
          matured: false,
          defaulted: true,
          couponRate: 8,
          holders: [{ characterId: charId, units: 5 }],
        },
      ])
    );
    db.collectionMocks["exchangeRates"]!.find.mockReturnValue(makeCursor([]));
    db.collectionMocks["characters"]!.find.mockReturnValue({
      project: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([{ _id: charId, countryId: "US" }]),
      }),
    });

    const req = new Request(
      `http://localhost/api/corporations/${corpId.toString()}/bond-default/cash`,
      { method: "POST" }
    );
    const { POST } = await import("./route");
    const res = await POST(req, { params: Promise.resolve({ id: corpId.toString() }) });
    expect(res.status).toBe(200);

    const updateManyCall = db.collectionMocks["bonds"]!.updateMany.mock.calls[0];
    expect(updateManyCall).toBeDefined();
    const updateOp = updateManyCall![1] as {
      $set: {
        matured?: boolean;
        marketPrice?: number;
        defaulted?: boolean;
        defaultCure?: { cureMethod?: string; curedAtTurn?: number };
      };
      $unset?: Record<string, string>;
    };
    expect(updateOp.$set.matured).toBe(true);
    expect(updateOp.$set.marketPrice).toBe(1);
    expect(updateOp.$set.defaulted).toBe(false);
    expect(updateOp.$set.defaultCure?.cureMethod).toBe("cash");
    expect(updateOp.$set.defaultCure?.curedAtTurn).toBe(444);
    // Critical: defaultedAtTurn must NOT be unset — the historical mark stays.
    expect(updateOp.$unset?.defaultedAtTurn).toBeUndefined();
  });

  it("returns 400 (no money moved) when atomic debit loses the race", async () => {
    const corpId = new ObjectId();
    const corporation = {
      _id: corpId,
      name: "Test",
      countryId: "US",
      liquidCapital: 1_000_000,
      liquidCurrencyCode: "USD",
    };
    const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({ ok: true, corporation } as never);
    db.collectionMocks["corporations"]!.findOne.mockResolvedValue(corporation as never);

    db.collectionMocks["bonds"]!.find.mockReturnValue(
      makeCursor([
        {
          _id: new ObjectId(),
          corporationId: corpId,
          currencyCode: "USD",
          matured: false,
          defaulted: true,
          couponRate: 8,
          holders: [{ characterId: new ObjectId(), units: 5 }],
        },
      ])
    );
    db.collectionMocks["exchangeRates"]!.find.mockReturnValue(makeCursor([]));
    // Atomic debit guard: modifiedCount 0 = lost the race.
    db.collectionMocks["corporations"]!.updateOne.mockResolvedValueOnce({
      modifiedCount: 0,
      matchedCount: 0,
    } as never);

    const req = new Request(
      `http://localhost/api/corporations/${corpId.toString()}/bond-default/cash`,
      { method: "POST" }
    );
    const { POST } = await import("./route");
    const res = await POST(req, { params: Promise.resolve({ id: corpId.toString() }) });
    expect(res.status).toBe(400);
    // No bond updates and no holder writes should have fired.
    expect(db.collectionMocks["bonds"]!.updateMany).not.toHaveBeenCalled();
  });

  it("relies on transaction rollback instead of issuing a manual refund on post-debit failure", async () => {
    const corpId = new ObjectId();
    const charId = new ObjectId();
    const corporation = {
      _id: corpId,
      name: "Test Issuer",
      countryId: "US",
      liquidCapital: 1_000_000,
      liquidCurrencyCode: "USD",
    };
    const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({ ok: true, corporation } as never);
    db.collectionMocks["corporations"]!.findOne.mockResolvedValue(corporation as never);

    db.collectionMocks["bonds"]!.find.mockReturnValue(
      makeCursor([
        {
          _id: new ObjectId(),
          corporationId: corpId,
          currencyCode: "USD",
          matured: false,
          defaulted: true,
          couponRate: 8,
          totalIssued: 10_000,
          holders: [{ characterId: charId, units: 10 }],
        },
      ])
    );
    db.collectionMocks["exchangeRates"]!.find.mockReturnValue(makeCursor([]));
    db.collectionMocks["characters"]!.find.mockReturnValue({
      project: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([{ _id: charId, countryId: "US", name: "Alice" }]),
      }),
    });

    // Initial debit succeeds (modifiedCount 1). Holder credit then throws.
    db.collectionMocks["corporations"]!.updateOne.mockResolvedValue({
      modifiedCount: 1,
      matchedCount: 1,
    } as never);
    db.collectionMocks["characters"]!.bulkWrite.mockRejectedValueOnce(
      new Error("Simulated DB write failure")
    );

    const req = new Request(
      `http://localhost/api/corporations/${corpId.toString()}/bond-default/cash`,
      { method: "POST" }
    );
    const { POST } = await import("./route");
    const res = await POST(req, { params: Promise.resolve({ id: corpId.toString() }) });
    // Outer catch turns the rethrown error into a 500.
    expect(res.status).toBe(500);

    const calls = db.collectionMocks["corporations"]!.updateOne.mock.calls;
    expect(calls).toHaveLength(1);
    const debitCall = calls[0][1] as { $inc?: { liquidCapital?: number } };
    expect(debitCall.$inc?.liquidCapital).toBeLessThan(0);
    expect(endSessionMock).toHaveBeenCalled();
  });

  it("aborts the transaction when a referenced holder record is missing", async () => {
    const corpId = new ObjectId();
    const missingCharId = new ObjectId();
    const corporation = {
      _id: corpId,
      name: "Test Issuer",
      countryId: "US",
      liquidCapital: 1_000_000,
      liquidCurrencyCode: "USD",
    };
    const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({ ok: true, corporation } as never);
    db.collectionMocks["corporations"]!.findOne.mockResolvedValue(corporation as never);

    db.collectionMocks["bonds"]!.find.mockReturnValue(
      makeCursor([
        {
          _id: new ObjectId(),
          corporationId: corpId,
          currencyCode: "USD",
          matured: false,
          defaulted: true,
          couponRate: 8,
          totalIssued: 5_000,
          holders: [{ characterId: missingCharId, units: 5 }],
        },
      ])
    );
    db.collectionMocks["exchangeRates"]!.find.mockReturnValue(makeCursor([]));
    db.collectionMocks["characters"]!.find.mockReturnValue({
      project: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([]),
      }),
    });

    const req = new Request(
      `http://localhost/api/corporations/${corpId.toString()}/bond-default/cash`,
      { method: "POST" }
    );
    const { POST } = await import("./route");
    const res = await POST(req, { params: Promise.resolve({ id: corpId.toString() }) });
    expect(res.status).toBe(500);
    expect(db.collectionMocks["bonds"]!.updateMany).toHaveBeenCalledTimes(1);
    expect(db.collectionMocks["characters"]!.bulkWrite).not.toHaveBeenCalled();
    const { emitTxBulk } = await import("@/lib/financialTxLog/emit");
    expect(vi.mocked(emitTxBulk)).not.toHaveBeenCalled();
    expect(endSessionMock).toHaveBeenCalled();
  });

  it("returns 503 when game state is unavailable (no turn=0 leakage)", async () => {
    const corpId = new ObjectId();
    const corporation = {
      _id: corpId,
      name: "Test",
      countryId: "US",
      liquidCapital: 1_000_000,
      liquidCurrencyCode: "USD",
    };
    const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({ ok: true, corporation } as never);

    const { getGameState } = await import("@/lib/gameState");
    vi.mocked(getGameState).mockResolvedValueOnce(null as never);

    const req = new Request(
      `http://localhost/api/corporations/${corpId.toString()}/bond-default/cash`,
      { method: "POST" }
    );
    const { POST } = await import("./route");
    const res = await POST(req, { params: Promise.resolve({ id: corpId.toString() }) });
    expect(res.status).toBe(503);
    // No bonds.updateMany should have fired.
    expect(db.collectionMocks["bonds"]!.updateMany).not.toHaveBeenCalled();
  });
});
