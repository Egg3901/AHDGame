/**
 * Regression tests for POST /api/corporations/[id]/parent-bond-payoff —
 * specifically the financial-ledger emission added to fix the gap where
 * parent-paid bond payoffs moved cash silently with no tx rows.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn(), getMongoClient: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireBasicAuth: vi.fn() }));
vi.mock("@/lib/api/corporations/resolveQuery", () => ({
  resolveCorporation: vi.fn(),
  requireCeo: vi.fn(),
  corporationQueryFromParamId: vi.fn(),
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
vi.mock("@/lib/corporations/corporateOwnership", () => ({
  acquirerOwnershipPercent: vi.fn().mockReturnValue(75),
  HOSTILE_TAKEOVER_OWNERSHIP_THRESHOLD_PERCENT: 50,
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

describe("POST /api/corporations/[id]/parent-bond-payoff — ledger emission", () => {
  it("emits bond_maturity tx rows for every holder receiving face value", async () => {
    // Pre-fix: parent-bond-payoff drained the parent corp's liquidCapital and
    // credited each holder of the target's outstanding bonds without emitting
    // a single financialTxLog row. A hostile-takeover prep cost (potentially
    // hundreds of millions) was therefore invisible to the audit ledger.
    const parentCorpId = new ObjectId();
    const targetCorpId = new ObjectId();
    const charId = new ObjectId();
    const imperialId = new ObjectId();
    const corpHolderId = new ObjectId();
    const bondId = new ObjectId();

    const target = {
      _id: targetCorpId,
      name: "Target Subsidiary",
      countryId: "US",
      liquidCapital: 0,
      liquidCurrencyCode: "USD",
    };
    const parent = {
      _id: parentCorpId,
      name: "Parent Holdings",
      countryId: "US",
      liquidCapital: 100_000_000,
      liquidCurrencyCode: "USD",
    };

    const { resolveCorporation, corporationQueryFromParamId } =
      await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: true,
      corporation: target,
    } as never);
    vi.mocked(corporationQueryFromParamId).mockReturnValue({
      _id: parentCorpId,
    } as never);
    db.collectionMocks["corporations"]!.findOne.mockResolvedValue(parent as never);

    const outstandingBond = {
      _id: bondId,
      corporationId: targetCorpId,
      currencyCode: "USD",
      matured: false,
      defaulted: false,
      couponRate: 6,
      holders: [
        { characterId: charId, units: 7 },
        { imperialCharacterId: imperialId, units: 4 },
        { corporationId: corpHolderId, units: 2 },
      ],
    };

    db.collectionMocks["bonds"]!.find.mockReturnValue(makeCursor([outstandingBond]));
    db.collectionMocks["exchangeRates"]!.find.mockReturnValue(makeCursor([]));

    db.collectionMocks["characters"]!.find.mockReturnValue({
      project: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([{ _id: charId, countryId: "US", name: "Alice" }]),
      }),
    });
    db.collectionMocks["imperialCharacters"]!.find.mockReturnValue({
      project: vi.fn().mockReturnValue({
        toArray: vi
          .fn()
          .mockResolvedValue([{ _id: imperialId, countryId: "US", name: "Imperator" }]),
      }),
    });
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
      `http://localhost/api/corporations/${targetCorpId.toString()}/parent-bond-payoff`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parentCorporationId: parentCorpId.toString() }),
      }
    );
    const { POST } = await import("./route");
    const res = await POST(req, { params: Promise.resolve({ id: targetCorpId.toString() }) });
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
          subjectType: string;
          subjectName: string;
          amount: number;
          meta?: { bondId?: string; units?: number; source?: string };
        }
      | undefined;
    expect(charEntry).toBeDefined();
    expect(charEntry!.subjectType).toBe("character");
    expect(charEntry!.subjectName).toBe("Alice");
    expect(charEntry!.amount).toBeGreaterThan(0);
    expect(charEntry!.meta?.bondId).toBe(bondId.toString());
    expect(charEntry!.meta?.units).toBe(7);
    expect(charEntry!.meta?.source).toBe("parent_bond_payoff");

    const imperialEntry = allEntries.find(
      (e: unknown) =>
        (e as { type?: string }).type === "bond_maturity" &&
        (e as { subjectId?: ObjectId }).subjectId?.toString() === imperialId.toString()
    ) as { subjectType: string; meta?: { units?: number; imperial?: boolean } } | undefined;
    expect(imperialEntry).toBeDefined();
    expect(imperialEntry!.meta?.imperial).toBe(true);
    expect(imperialEntry!.meta?.units).toBe(4);

    const corpHolderEntry = allEntries.find(
      (e: unknown) =>
        (e as { type?: string }).type === "bond_maturity" &&
        (e as { subjectType?: string }).subjectType === "corporation" &&
        (e as { subjectId?: ObjectId }).subjectId?.toString() === corpHolderId.toString()
    ) as
      | {
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
    expect(corpHolderEntry!.meta?.units).toBe(2);
    // Same-currency fixture (USD bond, USD holder): row in holder's lc =
    // bondCcy here, so currencyCode and meta.bondCurrency match, and amount
    // matches meta.bondAmount.
    expect(corpHolderEntry!.currencyCode).toBe("USD");
    expect(corpHolderEntry!.meta?.bondCurrency).toBe("USD");
    expect(corpHolderEntry!.meta?.bondAmount).toBeCloseTo(corpHolderEntry!.amount);

    // Bond doc gets a defaultCure marker for the Bonds tab UI.
    const bondsUpdateCall = db.collectionMocks["bonds"]!.updateMany.mock.calls[0];
    expect(bondsUpdateCall).toBeDefined();
    const bondsUpdate = bondsUpdateCall![1] as {
      $set: {
        matured?: boolean;
        defaulted?: boolean;
        defaultCure?: { cureMethod?: string; curedAtTurn?: number };
      };
      $unset?: Record<string, string>;
    };
    expect(bondsUpdate.$set.matured).toBe(true);
    expect(bondsUpdate.$set.defaulted).toBe(false);
    expect(bondsUpdate.$set.defaultCure?.cureMethod).toBe("parent_payoff");
    expect(bondsUpdate.$set.defaultCure?.curedAtTurn).toBe(444);
    expect(bondsUpdate.$unset?.defaultedAtTurn).toBeUndefined();
  });

  it("returns 503 when game state is unavailable (no turn=0 leakage)", async () => {
    const parentCorpId = new ObjectId();
    const targetCorpId = new ObjectId();
    const target = {
      _id: targetCorpId,
      name: "Target",
      countryId: "US",
      liquidCapital: 0,
      liquidCurrencyCode: "USD",
    };
    const parent = {
      _id: parentCorpId,
      name: "Parent",
      countryId: "US",
      liquidCapital: 100_000_000,
      liquidCurrencyCode: "USD",
    };

    const { resolveCorporation, corporationQueryFromParamId } =
      await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({ ok: true, corporation: target } as never);
    vi.mocked(corporationQueryFromParamId).mockReturnValue({ _id: parentCorpId } as never);
    db.collectionMocks["corporations"]!.findOne.mockResolvedValue(parent as never);

    const { getGameState } = await import("@/lib/gameState");
    vi.mocked(getGameState).mockResolvedValueOnce(null as never);

    const req = new Request(
      `http://localhost/api/corporations/${targetCorpId.toString()}/parent-bond-payoff`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parentCorporationId: parentCorpId.toString() }),
      }
    );
    const { POST } = await import("./route");
    const res = await POST(req, { params: Promise.resolve({ id: targetCorpId.toString() }) });
    expect(res.status).toBe(503);
    expect(db.collectionMocks["bonds"]!.updateMany).not.toHaveBeenCalled();
  });

  it("relies on transaction rollback instead of issuing a manual refund on post-debit failure", async () => {
    const parentCorpId = new ObjectId();
    const targetCorpId = new ObjectId();
    const charId = new ObjectId();
    const target = {
      _id: targetCorpId,
      name: "Target Subsidiary",
      countryId: "US",
      liquidCapital: 0,
      liquidCurrencyCode: "USD",
    };
    const parent = {
      _id: parentCorpId,
      name: "Parent Holdings",
      countryId: "US",
      liquidCapital: 100_000_000,
      liquidCurrencyCode: "USD",
    };

    const { resolveCorporation, corporationQueryFromParamId } =
      await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: true,
      corporation: target,
    } as never);
    vi.mocked(corporationQueryFromParamId).mockReturnValue({ _id: parentCorpId } as never);
    db.collectionMocks["corporations"]!.findOne.mockResolvedValue(parent as never);
    db.collectionMocks["bonds"]!.find.mockReturnValue(
      makeCursor([
        {
          _id: new ObjectId(),
          corporationId: targetCorpId,
          currencyCode: "USD",
          matured: false,
          defaulted: false,
          couponRate: 6,
          totalIssued: 7_000,
          holders: [{ characterId: charId, units: 7 }],
        },
      ])
    );
    db.collectionMocks["exchangeRates"]!.find.mockReturnValue(makeCursor([]));
    db.collectionMocks["characters"]!.find.mockReturnValue({
      project: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([{ _id: charId, countryId: "US", name: "Alice" }]),
      }),
    });
    db.collectionMocks["characters"]!.bulkWrite.mockRejectedValueOnce(
      new Error("Simulated DB write failure")
    );

    const req = new Request(
      `http://localhost/api/corporations/${targetCorpId.toString()}/parent-bond-payoff`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parentCorporationId: parentCorpId.toString() }),
      }
    );
    const { POST } = await import("./route");
    const res = await POST(req, { params: Promise.resolve({ id: targetCorpId.toString() }) });
    expect(res.status).toBe(500);

    const calls = db.collectionMocks["corporations"]!.updateOne.mock.calls;
    expect(calls).toHaveLength(1);
    const debitCall = calls[0][1] as { $inc?: { liquidCapital?: number } };
    expect(debitCall.$inc?.liquidCapital).toBeLessThan(0);
    expect(endSessionMock).toHaveBeenCalled();
  });

  it("aborts before any write when a referenced holder record is missing", async () => {
    const parentCorpId = new ObjectId();
    const targetCorpId = new ObjectId();
    const missingCharId = new ObjectId();
    const target = {
      _id: targetCorpId,
      name: "Target Subsidiary",
      countryId: "US",
      liquidCapital: 0,
      liquidCurrencyCode: "USD",
    };
    const parent = {
      _id: parentCorpId,
      name: "Parent Holdings",
      countryId: "US",
      liquidCapital: 100_000_000,
      liquidCurrencyCode: "USD",
    };

    const { resolveCorporation, corporationQueryFromParamId } =
      await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({ ok: true, corporation: target } as never);
    vi.mocked(corporationQueryFromParamId).mockReturnValue({ _id: parentCorpId } as never);
    db.collectionMocks["corporations"]!.findOne.mockResolvedValue(parent as never);
    db.collectionMocks["bonds"]!.find.mockReturnValue(
      makeCursor([
        {
          _id: new ObjectId(),
          corporationId: targetCorpId,
          currencyCode: "USD",
          matured: false,
          defaulted: false,
          couponRate: 6,
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
      `http://localhost/api/corporations/${targetCorpId.toString()}/parent-bond-payoff`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parentCorporationId: parentCorpId.toString() }),
      }
    );
    const { POST } = await import("./route");
    const res = await POST(req, { params: Promise.resolve({ id: targetCorpId.toString() }) });
    expect(res.status).toBe(500);
    // Holder validation now happens before any write: no debit, no maturation,
    // no credit — the invalid payoff costs nothing on either DB topology.
    expect(db.collectionMocks["corporations"]!.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks["bonds"]!.updateMany).not.toHaveBeenCalled();
    expect(db.collectionMocks["characters"]!.bulkWrite).not.toHaveBeenCalled();
    const { emitTxBulk } = await import("@/lib/financialTxLog/emit");
    expect(vi.mocked(emitTxBulk)).not.toHaveBeenCalled();
    expect(endSessionMock).toHaveBeenCalled();
  });
});

/**
 * Standalone-mongo (no replica set) fallback. The live server runs a Railway
 * standalone mongod, so `session.withTransaction` throws MongoServerError code
 * 20. The route must fall back to sequential writes — and keep the payoff
 * money-safe via explicit compensation — instead of returning the old 503
 * ("requires MongoDB transactions; run against a replica set").
 */
describe("POST /api/corporations/[id]/parent-bond-payoff — standalone fallback", () => {
  /** A mongo client whose transactions are rejected as on a standalone mongod. */
  function mockStandaloneClient() {
    const err = Object.assign(new Error("Transaction numbers are only allowed on a replica set"), {
      code: 20,
    });
    return {
      startSession: () => ({
        withTransaction: vi.fn(async () => {
          throw err;
        }),
        endSession: endSessionMock,
      }),
    };
  }

  function makeParentAndTarget() {
    const parentCorpId = new ObjectId();
    const targetCorpId = new ObjectId();
    const target = {
      _id: targetCorpId,
      name: "Target Subsidiary",
      countryId: "US",
      liquidCapital: 0,
      liquidCurrencyCode: "USD",
    };
    const parent = {
      _id: parentCorpId,
      name: "Parent Holdings",
      countryId: "US",
      liquidCapital: 100_000_000,
      liquidCurrencyCode: "USD",
    };
    return { parentCorpId, targetCorpId, target, parent };
  }

  it("falls back to sequential writes and completes the payoff (no replica set)", async () => {
    const { parentCorpId, targetCorpId, target, parent } = makeParentAndTarget();
    const charId = new ObjectId();
    const bondId = new ObjectId();

    const { getMongoClient } = await import("@/lib/mongodb");
    vi.mocked(getMongoClient).mockResolvedValue(mockStandaloneClient() as never);

    const { resolveCorporation, corporationQueryFromParamId } =
      await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({ ok: true, corporation: target } as never);
    vi.mocked(corporationQueryFromParamId).mockReturnValue({ _id: parentCorpId } as never);
    db.collectionMocks["corporations"]!.findOne.mockResolvedValue(parent as never);

    db.collectionMocks["bonds"]!.find.mockReturnValue(
      makeCursor([
        {
          _id: bondId,
          corporationId: targetCorpId,
          currencyCode: "USD",
          matured: false,
          defaulted: false,
          couponRate: 6,
          totalIssued: 7_000,
          holders: [{ characterId: charId, units: 7 }],
        },
      ])
    );
    db.collectionMocks["exchangeRates"]!.find.mockReturnValue(makeCursor([]));
    db.collectionMocks["characters"]!.find.mockReturnValue({
      project: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([{ _id: charId, countryId: "US", name: "Alice" }]),
      }),
    });

    const req = new Request(
      `http://localhost/api/corporations/${targetCorpId.toString()}/parent-bond-payoff`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parentCorporationId: parentCorpId.toString() }),
      }
    );
    const { POST } = await import("./route");
    const res = await POST(req, { params: Promise.resolve({ id: targetCorpId.toString() }) });
    expect(res.status).toBe(200);

    // Parent was debited once (no compensating refund on success).
    const debitCalls = db.collectionMocks["corporations"]!.updateOne.mock.calls;
    expect(debitCalls).toHaveLength(1);
    expect(
      (debitCalls[0][1] as { $inc?: { liquidCapital?: number } }).$inc?.liquidCapital
    ).toBeLessThan(0);
    // Holder credited, bonds matured, ledger emitted.
    expect(db.collectionMocks["characters"]!.bulkWrite).toHaveBeenCalledTimes(1);
    expect(db.collectionMocks["bonds"]!.updateMany).toHaveBeenCalledTimes(1);
    const { emitTxBulk } = await import("@/lib/financialTxLog/emit");
    expect(vi.mocked(emitTxBulk)).toHaveBeenCalled();
  });

  it("refunds the parent debit when a credit fails mid-sequence (money-safe)", async () => {
    const { parentCorpId, targetCorpId, target, parent } = makeParentAndTarget();
    const charId = new ObjectId();

    const { getMongoClient } = await import("@/lib/mongodb");
    vi.mocked(getMongoClient).mockResolvedValue(mockStandaloneClient() as never);

    const { resolveCorporation, corporationQueryFromParamId } =
      await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({ ok: true, corporation: target } as never);
    vi.mocked(corporationQueryFromParamId).mockReturnValue({ _id: parentCorpId } as never);
    db.collectionMocks["corporations"]!.findOne.mockResolvedValue(parent as never);

    db.collectionMocks["bonds"]!.find.mockReturnValue(
      makeCursor([
        {
          _id: new ObjectId(),
          corporationId: targetCorpId,
          currencyCode: "USD",
          matured: false,
          defaulted: false,
          couponRate: 6,
          totalIssued: 7_000,
          holders: [{ characterId: charId, units: 7 }],
        },
      ])
    );
    db.collectionMocks["exchangeRates"]!.find.mockReturnValue(makeCursor([]));
    db.collectionMocks["characters"]!.find.mockReturnValue({
      project: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([{ _id: charId, countryId: "US", name: "Alice" }]),
      }),
    });
    // The holder credit fails after the parent has been debited.
    db.collectionMocks["characters"]!.bulkWrite.mockRejectedValueOnce(
      new Error("Simulated DB write failure")
    );

    const req = new Request(
      `http://localhost/api/corporations/${targetCorpId.toString()}/parent-bond-payoff`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parentCorporationId: parentCorpId.toString() }),
      }
    );
    const { POST } = await import("./route");
    const res = await POST(req, { params: Promise.resolve({ id: targetCorpId.toString() }) });
    expect(res.status).toBe(500);

    // Two updateOne calls on corporations: the debit, then a compensating refund
    // that exactly reverses it — net zero money movement on the parent.
    const calls = db.collectionMocks["corporations"]!.updateOne.mock.calls;
    expect(calls).toHaveLength(2);
    const debit = (calls[0][1] as { $inc?: { liquidCapital?: number } }).$inc?.liquidCapital ?? 0;
    const refund = (calls[1][1] as { $inc?: { liquidCapital?: number } }).$inc?.liquidCapital ?? 0;
    expect(debit).toBeLessThan(0);
    expect(refund).toBeCloseTo(-debit);
    // Bonds never matured; no ledger rows emitted for a rolled-back payoff.
    expect(db.collectionMocks["bonds"]!.updateMany).not.toHaveBeenCalled();
    const { emitTxBulk } = await import("@/lib/financialTxLog/emit");
    expect(vi.mocked(emitTxBulk)).not.toHaveBeenCalled();
    expect(endSessionMock).toHaveBeenCalled();
  });

  it("never debits the parent when holder data is invalid (reads precede writes)", async () => {
    const { parentCorpId, targetCorpId, target, parent } = makeParentAndTarget();
    const missingCharId = new ObjectId();

    const { getMongoClient } = await import("@/lib/mongodb");
    vi.mocked(getMongoClient).mockResolvedValue(mockStandaloneClient() as never);

    const { resolveCorporation, corporationQueryFromParamId } =
      await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({ ok: true, corporation: target } as never);
    vi.mocked(corporationQueryFromParamId).mockReturnValue({ _id: parentCorpId } as never);
    db.collectionMocks["corporations"]!.findOne.mockResolvedValue(parent as never);

    db.collectionMocks["bonds"]!.find.mockReturnValue(
      makeCursor([
        {
          _id: new ObjectId(),
          corporationId: targetCorpId,
          currencyCode: "USD",
          matured: false,
          defaulted: false,
          couponRate: 6,
          holders: [{ characterId: missingCharId, units: 5 }],
        },
      ])
    );
    db.collectionMocks["exchangeRates"]!.find.mockReturnValue(makeCursor([]));
    // Holder doc is missing — validation must fail before any money moves.
    db.collectionMocks["characters"]!.find.mockReturnValue({
      project: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
    });

    const req = new Request(
      `http://localhost/api/corporations/${targetCorpId.toString()}/parent-bond-payoff`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parentCorporationId: parentCorpId.toString() }),
      }
    );
    const { POST } = await import("./route");
    const res = await POST(req, { params: Promise.resolve({ id: targetCorpId.toString() }) });
    expect(res.status).toBe(500);

    // No debit, no maturation, no refund — the payoff cost nothing.
    expect(db.collectionMocks["corporations"]!.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks["bonds"]!.updateMany).not.toHaveBeenCalled();
    expect(db.collectionMocks["characters"]!.bulkWrite).not.toHaveBeenCalled();
    const { emitTxBulk } = await import("@/lib/financialTxLog/emit");
    expect(vi.mocked(emitTxBulk)).not.toHaveBeenCalled();
  });
});
