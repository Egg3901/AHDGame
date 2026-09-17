/**
 * Keyed-flow tests for POST /api/corporations/[id]/bond-default/cash
 * (issue #1672): defaulted bonds cure through the shared bondPayoffSpend
 * primitive (guarded liquid+escrow debit, one resumable credit per holder,
 * per-bond maturity claims over still-defaulted bonds), so these tests
 * assert the keyed surface — missing/minted key, invalid key, replay,
 * conflict, same-key partial recovery, empty-remainder recovery after the
 * final cure, terminal mapping, and empty-path terminal/mismatch mappings —
 * plus the escrow split, the fund/NPP coverage (#809), and the preserved
 * status/body contract.
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
vi.mock("@/lib/db/transactionSupport", () => ({
  assertTransactionSupportAtBoot: vi.fn().mockResolvedValue(false),
}));

let db: MockDb;

beforeEach(async () => {
  vi.clearAllMocks();
  db = createMockDb();
  for (const name of [
    "bonds",
    "corporations",
    "characters",
    "imperialCharacters",
    "indexFunds",
    "npps",
    "nonAtomicMoneyFlowReceipts",
    "exchangeRates",
  ]) {
    db.collection(name);
  }
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as never);
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

interface Fixture {
  corpId: ObjectId;
  charId: ObjectId;
  imperialId: ObjectId;
  holderCorpId: ObjectId;
  fundId: ObjectId;
  nppId: ObjectId;
  bondA: Record<string, unknown>;
  bondB: Record<string, unknown>;
}

/**
 * Two DEFAULTED USD bonds, face 17_000 + 5_000 = 22_000. The issuer holds
 * 20_000 liquid, so the 2_000 remainder draws from the positive buyback
 * escrow. Holder units x $1k face: char 12, imperial 4, corp 2, fund 2,
 * npp 1 (21_000 credited; 1_000 of bond-A float retired silently).
 */
async function setupFixture(overrides: Record<string, unknown> = {}): Promise<Fixture> {
  const corpId = new ObjectId();
  const charId = new ObjectId();
  const imperialId = new ObjectId();
  const holderCorpId = new ObjectId();
  const fundId = new ObjectId();
  const nppId = new ObjectId();
  const bondAId = new ObjectId();
  const bondBId = new ObjectId();

  const corporation = {
    _id: corpId,
    name: "Debtor Corp",
    countryId: "US",
    liquidCapital: 20_000,
    liquidCurrencyCode: "USD",
    shareEscrowBalance: 50_000,
    ...overrides,
  };

  const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
  vi.mocked(resolveCorporation).mockResolvedValue({ ok: true, corporation } as never);
  db.collectionMocks["corporations"]!.findOne.mockResolvedValue(corporation as never);

  const bondA = {
    _id: bondAId,
    corporationId: corpId,
    currencyCode: "USD",
    matured: false,
    defaulted: true,
    couponRate: 6,
    marketPrice: 0.4,
    totalIssued: 17_000,
    publicFloat: 1,
    holders: [
      { characterId: charId, units: 12 },
      { imperialCharacterId: imperialId, units: 4 },
    ],
  };
  const bondB = {
    _id: bondBId,
    corporationId: corpId,
    currencyCode: "USD",
    matured: false,
    defaulted: true,
    couponRate: 5,
    marketPrice: 0.3,
    totalIssued: 5_000,
    publicFloat: 0,
    holders: [
      { corporationId: holderCorpId, units: 2 },
      { fundId, units: 2 },
      { nppId, units: 1 },
    ],
  };
  db.collectionMocks["bonds"]!.find.mockReturnValue(makeCursor([bondA, bondB]));
  db.collectionMocks["exchangeRates"]!.find.mockReturnValue(makeCursor([]));

  db.collectionMocks["characters"]!.find.mockReturnValue({
    project: vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ _id: charId, countryId: "US", name: "Alice" }]),
    }),
  });
  db.collectionMocks["imperialCharacters"]!.find.mockReturnValue({
    project: vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ _id: imperialId, countryId: "US", name: "Imperator" }]),
    }),
  });
  db.collectionMocks["corporations"]!.find.mockReturnValue(
    makeCursor([
      { _id: holderCorpId, name: "Holder Corp", countryId: "US", liquidCurrencyCode: "USD" },
    ])
  );

  return { corpId, charId, imperialId, holderCorpId, fundId, nppId, bondA, bondB };
}

function postCash(corpId: ObjectId, headers?: Record<string, string>) {
  return import("./route").then(({ POST }) =>
    POST(
      new Request(`http://localhost/api/corporations/${corpId.toString()}/bond-default/cash`, {
        method: "POST",
        headers: { ...(headers ?? {}) },
      }),
      { params: Promise.resolve({ id: corpId.toString() }) }
    )
  );
}

describe("POST /api/corporations/[id]/bond-default/cash — keyed flow", () => {
  it("cures defaulted bonds with a liquid+escrow debit and pays every holder kind", async () => {
    const f = await setupFixture();

    const res = await postCash(f.corpId);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, paid: 22_000, bondsMatured: 2 });

    // Liquid covers 20_000, the positive escrow tops up the 2_000 remainder
    // in the same atomic payer write.
    const debitCall = db.collectionMocks["corporations"]!.updateOne.mock.calls.find(
      (call) => (call[1] as { $inc?: { liquidCapital?: number } }).$inc?.liquidCapital === -20_000
    );
    expect(debitCall).toBeDefined();
    expect(debitCall?.[0]).toEqual(
      expect.objectContaining({
        _id: f.corpId,
        liquidCapital: { $gte: 20_000 },
        shareEscrowBalance: { $gte: 2_000 },
      })
    );
    expect(debitCall?.[1]).toEqual(
      expect.objectContaining({
        $inc: expect.objectContaining({ liquidCapital: -20_000, shareEscrowBalance: -2_000 }),
      })
    );

    // Holder credits land on each holder's own account and field.
    expect(db.collectionMocks["characters"]!.updateOne.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ $inc: expect.objectContaining({ cashOnHand: 12_000 }) })
    );
    expect(db.collectionMocks["imperialCharacters"]!.updateOne.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ $inc: expect.objectContaining({ cashOnHand: 4_000 }) })
    );
    expect(db.collectionMocks["indexFunds"]!.updateOne.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ $inc: expect.objectContaining({ cashAnchor: 2_000 }) })
    );
    expect(db.collectionMocks["npps"]!.updateOne.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        $inc: expect.objectContaining({ nppInvestmentCashAnchor: 1_000 }),
      })
    );

    // Cash cures claim only still-defaulted bonds, stamped with the cure.
    const bondCalls = db.collectionMocks["bonds"]!.updateOne.mock.calls;
    expect(bondCalls).toHaveLength(2);
    for (const call of bondCalls) {
      expect(call[0]).toEqual(expect.objectContaining({ matured: false, defaulted: true }));
      expect(call[1]).toEqual(
        expect.objectContaining({
          $set: expect.objectContaining({
            matured: true,
            defaulted: false,
            defaultCure: { cureMethod: "cash", curedAtTurn: 444 },
          }),
        })
      );
    }

    const receipts = db.collectionMocks["nonAtomicMoneyFlowReceipts"]!;
    expect((receipts.insertOne.mock.calls[0]?.[0] as { fingerprint: string }).fingerprint).toMatch(
      /^bond-payoff:cash:/
    );

    // Ledger: fund payout logged, NPP investment returns excluded.
    const { emitTxBulk } = await import("@/lib/financialTxLog/emit");
    const rows = vi.mocked(emitTxBulk).mock.calls[0]?.[1] as Array<{
      subjectId: ObjectId;
      subjectType: string;
      amount: number;
      meta?: { source?: string; fundId?: string; units?: number };
    }>;
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.meta?.source === "default_cash_payoff")).toBe(true);
    const fundRow = rows.find((r) => r.subjectId.toString() === f.fundId.toString())!;
    expect(fundRow.subjectType).toBe("corporation");
    expect(fundRow.amount).toBe(2_000);
    expect(fundRow.meta?.fundId).toBe(f.fundId.toString());
    expect(rows.some((r) => r.subjectId.toString() === f.nppId.toString())).toBe(false);
  });

  it("settles without an Idempotency-Key, claiming a minted receipt", async () => {
    const f = await setupFixture();

    const res = await postCash(f.corpId);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, paid: 22_000, bondsMatured: 2 });

    // No client key: the attempt is still crash-safe within itself, keyed
    // under a minted id rather than a client-supplied one.
    const receiptInsert = db.collectionMocks["nonAtomicMoneyFlowReceipts"]!.insertOne.mock
      .calls[0]![0] as { _id: string };
    expect(typeof receiptInsert._id).toBe("string");
    expect(receiptInsert._id.length).toBeGreaterThan(0);
  });

  it("rejects an empty or overlong Idempotency-Key without touching money", async () => {
    const f = await setupFixture();

    for (const key of ["", "x".repeat(129)]) {
      const res = await postCash(f.corpId, { "Idempotency-Key": key });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe(
        "Invalid Idempotency-Key header"
      );
    }
    expect(db.collectionMocks["corporations"]!.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks["bonds"]!.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks["nonAtomicMoneyFlowReceipts"]!.insertOne).not.toHaveBeenCalled();
  });

  it("replays the same Idempotency-Key without moving money again", async () => {
    const f = await setupFixture();
    const headers = { "Idempotency-Key": "cash-payoff-replay" };

    const first = await postCash(f.corpId, headers);
    expect(first.status).toBe(200);

    const receipts = db.collectionMocks["nonAtomicMoneyFlowReceipts"]!;
    const fingerprint = (receipts.insertOne.mock.calls[0]?.[0] as { fingerprint: string })
      .fingerprint;
    receipts.insertOne.mockRejectedValueOnce({ code: 11000 });
    receipts.findOne.mockResolvedValue({
      _id: "cash-payoff-replay",
      status: "completed",
      fingerprint,
    });

    const writes = db.collectionMocks["corporations"]!.updateOne.mock.calls.length;
    const second = await postCash(f.corpId, headers);
    expect(second.status).toBe(200);
    expect(db.collectionMocks["corporations"]!.updateOne.mock.calls.length).toBe(writes);
  });

  it("maps a reused key for a different payoff to 409 without moving money", async () => {
    const f = await setupFixture();
    const receipts = db.collectionMocks["nonAtomicMoneyFlowReceipts"]!;
    receipts.insertOne.mockRejectedValueOnce({ code: 11000 });
    receipts.findOne.mockResolvedValue({
      _id: "cash-payoff-conflict",
      status: "completed",
      fingerprint: "bond-payoff:cash:something-else",
    });

    const res = await postCash(f.corpId, { "Idempotency-Key": "cash-payoff-conflict" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toContain("different payoff");
    expect(db.collectionMocks["corporations"]!.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks["bonds"]!.updateOne).not.toHaveBeenCalled();
  });

  it("resumes under the same key after a mid-payoff crash instead of conflicting", async () => {
    const f = await setupFixture();
    const headers = { "Idempotency-Key": "cash-payoff-crash" };
    db.collectionMocks["bonds"]!.updateOne.mockResolvedValueOnce({
      matchedCount: 1,
      modifiedCount: 1,
    });
    db.collectionMocks["bonds"]!.updateOne.mockRejectedValueOnce(new Error("INJECTED_CRASH"));

    const crashed = await postCash(f.corpId, headers);
    expect(crashed.status).toBe(500);

    const receipts = db.collectionMocks["nonAtomicMoneyFlowReceipts"]!;
    const firstInsert = receipts.insertOne.mock.calls[0]?.[0] as {
      _id: string;
      fingerprint: string;
    };
    const planUpdate = receipts.updateOne.mock.calls.find(
      (call) => (call[1] as { $set?: { bondPayoffPlan?: unknown } }).$set?.bondPayoffPlan
    );
    expect(planUpdate).toBeDefined();

    // Only bond B is still defaulted on the retry: the shrunken fingerprint
    // must resume the stored plan under the same key, not 409.
    db.collectionMocks["bonds"]!.find.mockReturnValue(makeCursor([f.bondB]));
    receipts.insertOne.mockRejectedValueOnce({ code: 11000 });
    receipts.findOne.mockResolvedValue({
      _id: firstInsert._id,
      status: "in_progress",
      fingerprint: firstInsert.fingerprint,
      bondPayoffPlan: (planUpdate![1] as { $set: { bondPayoffPlan: unknown } }).$set.bondPayoffPlan,
    });

    const retry = await postCash(f.corpId, headers);
    expect(retry.status).toBe(200);
    const settled = receipts.updateOne.mock.calls.filter(
      (call) => (call[1] as { $set?: { status?: string } }).$set?.status === "completed"
    );
    expect(settled.length).toBeGreaterThan(0);
  });

  it("recovers the stored outcome after the final cure when the live set reads empty", async () => {
    const f = await setupFixture();
    const headers = { "Idempotency-Key": "cash-payoff-final-cure" };

    // A genuinely completed first attempt, captured so the retry below can
    // replay its exact stored plan. Reporting the completed receipt back as
    // `in_progress` models the crash window precisely: every write applied,
    // the completion write lost, every bond cured so the live set is empty.
    const first = await postCash(f.corpId, headers);
    expect(first.status).toBe(200);
    const firstBody = await first.json();

    const receipts = db.collectionMocks["nonAtomicMoneyFlowReceipts"]!;
    const firstInsert = receipts.insertOne.mock.calls[0]?.[0] as {
      _id: string;
      fingerprint: string;
    };
    const planUpdate = receipts.updateOne.mock.calls.find(
      (call) => (call[1] as { $set?: { bondPayoffPlan?: unknown } }).$set?.bondPayoffPlan
    );
    expect(planUpdate).toBeDefined();

    db.collectionMocks["bonds"]!.find.mockReturnValue(makeCursor([]));
    receipts.insertOne.mockRejectedValueOnce({ code: 11000 });
    receipts.findOne.mockResolvedValue({
      _id: firstInsert._id,
      status: "in_progress",
      fingerprint: firstInsert.fingerprint,
      bondPayoffPlan: (planUpdate![1] as { $set: { bondPayoffPlan: unknown } }).$set.bondPayoffPlan,
    });

    const retry = await postCash(f.corpId, headers);
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual(firstBody);
    const settled = receipts.updateOne.mock.calls.filter(
      (call) => (call[1] as { $set?: { status?: string } }).$set?.status === "completed"
    );
    expect(settled.length).toBeGreaterThan(0);
  });

  it("maps a settled failed receipt to 409 without moving money again", async () => {
    const f = await setupFixture();
    const headers = { "Idempotency-Key": "cash-payoff-terminal" };
    // Force the payer-debit guard to reject: the first attempt settles
    // `failed` (nothing applied, so the status is truthful) behind the 400
    // race surface. A retry under the same key must fail closed.
    db.collectionMocks["corporations"]!.updateOne.mockResolvedValueOnce({
      matchedCount: 0,
      modifiedCount: 0,
    } as never);
    const failed = await postCash(f.corpId, headers);
    expect(failed.status).toBe(400);
    expect(((await failed.json()) as { error: string }).error).toContain("race");

    const receipts = db.collectionMocks["nonAtomicMoneyFlowReceipts"]!;
    const fingerprint = (receipts.insertOne.mock.calls[0]?.[0] as { fingerprint: string })
      .fingerprint;
    const corpWrites = db.collectionMocks["corporations"]!.updateOne.mock.calls.length;
    receipts.insertOne.mockRejectedValueOnce({ code: 11000 });
    receipts.findOne.mockResolvedValue({
      _id: "cash-payoff-terminal",
      status: "failed",
      fingerprint,
    });

    const res = await postCash(f.corpId, headers);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toContain("already settled");
    expect(db.collectionMocks["corporations"]!.updateOne.mock.calls.length).toBe(corpWrites);
    expect(db.collectionMocks["bonds"]!.updateOne).not.toHaveBeenCalled();
  });

  it("maps a terminal receipt to 409 on the empty-remainder path", async () => {
    const f = await setupFixture();
    db.collectionMocks["bonds"]!.find.mockReturnValue(makeCursor([]));
    const receipts = db.collectionMocks["nonAtomicMoneyFlowReceipts"]!;
    receipts.findOne.mockResolvedValue({
      _id: "cash-payoff-empty-terminal",
      status: "compensated",
      fingerprint: "bond-payoff:cash:stale",
    });

    const res = await postCash(f.corpId, { "Idempotency-Key": "cash-payoff-empty-terminal" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toContain("already settled");
    expect(db.collectionMocks["corporations"]!.updateOne).not.toHaveBeenCalled();
  });

  it("maps a stored plan naming a different payer to 409 on the empty-remainder path", async () => {
    const f = await setupFixture();
    const headers = { "Idempotency-Key": "cash-payoff-empty-mismatch" };

    const first = await postCash(f.corpId, headers);
    expect(first.status).toBe(200);

    const receipts = db.collectionMocks["nonAtomicMoneyFlowReceipts"]!;
    const firstInsert = receipts.insertOne.mock.calls[0]?.[0] as {
      _id: string;
      fingerprint: string;
    };
    const planUpdate = receipts.updateOne.mock.calls.find(
      (call) => (call[1] as { $set?: { bondPayoffPlan?: unknown } }).$set?.bondPayoffPlan
    );
    expect(planUpdate).toBeDefined();
    const storedPlan = (planUpdate![1] as { $set: { bondPayoffPlan: Record<string, unknown> } })
      .$set.bondPayoffPlan;

    // The live set reads empty but the stored attempt names a different
    // payer: cross-corp key reuse, fail closed rather than reporting the
    // stored outcome for the wrong payoff.
    db.collectionMocks["bonds"]!.find.mockReturnValue(makeCursor([]));
    receipts.findOne.mockResolvedValue({
      _id: firstInsert._id,
      status: "in_progress",
      fingerprint: firstInsert.fingerprint,
      bondPayoffPlan: { ...storedPlan, payerCorpIdHex: new ObjectId().toHexString() },
    });

    const res = await postCash(f.corpId, headers);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toContain("different payoff");
  });

  it("returns 400 with no writes when liquid plus escrow cannot cover the cost", async () => {
    const f = await setupFixture({ liquidCapital: 1_000, shareEscrowBalance: 100 });

    const res = await postCash(f.corpId);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("Insufficient");
    expect(db.collectionMocks["corporations"]!.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks["bonds"]!.updateOne).not.toHaveBeenCalled();
    const { emitTxBulk } = await import("@/lib/financialTxLog/emit");
    expect(vi.mocked(emitTxBulk)).not.toHaveBeenCalled();
  });

  it("returns 400 when no defaulted bonds remain", async () => {
    const f = await setupFixture();
    db.collectionMocks["bonds"]!.find.mockReturnValue(makeCursor([]));

    const res = await postCash(f.corpId);
    expect(res.status).toBe(400);
    expect(db.collectionMocks["corporations"]!.updateOne).not.toHaveBeenCalled();
  });

  it("aborts before any write when a referenced holder record is missing", async () => {
    const f = await setupFixture();
    db.collectionMocks["characters"]!.find.mockReturnValue({
      project: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
    });

    const res = await postCash(f.corpId);
    expect(res.status).toBe(500);
    expect(db.collectionMocks["corporations"]!.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks["bonds"]!.updateOne).not.toHaveBeenCalled();
  });

  it("returns 503 when game state is unavailable (no turn=0 leakage)", async () => {
    const f = await setupFixture();
    const { getGameState } = await import("@/lib/gameState");
    vi.mocked(getGameState).mockResolvedValueOnce(null as never);

    const res = await postCash(f.corpId);
    expect(res.status).toBe(503);
    expect(db.collectionMocks["bonds"]!.updateOne).not.toHaveBeenCalled();
  });
});
