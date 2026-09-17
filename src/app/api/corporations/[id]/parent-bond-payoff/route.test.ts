/**
 * Keyed-flow tests for POST /api/corporations/[id]/parent-bond-payoff
 * (issue #1672): the payoff settles through the shared bondPayoffSpend
 * primitive (guarded parent debit, one resumable credit per holder,
 * per-bond maturity claims), so these tests assert the keyed surface —
 * missing/minted key, invalid key, replay, conflict, same-key partial
 * recovery, empty-remainder recovery after the final cure, terminal mapping,
 * and empty-path terminal/mismatch mappings — plus the multi-holder
 * economics (character/imperial/corp/fund/NPP, public float retired
 * silently) and the preserved status/body contract.
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
  parentCorpId: ObjectId;
  targetCorpId: ObjectId;
  charId: ObjectId;
  imperialId: ObjectId;
  holderCorpId: ObjectId;
  fundId: ObjectId;
  nppId: ObjectId;
  bondA: Record<string, unknown>;
  bondB: Record<string, unknown>;
}

/**
 * Two outstanding USD bonds, face 17_000 + 5_000 = 22_000. Bond A carries
 * a 1-unit public float inside that face, so the parent funds 22_000 while
 * holders receive 21_000. Holder units x $1k face: char 12, imperial 4,
 * corp 2, fund 2, npp 1.
 */
async function setupFixture(): Promise<Fixture> {
  const parentCorpId = new ObjectId();
  const targetCorpId = new ObjectId();
  const charId = new ObjectId();
  const imperialId = new ObjectId();
  const holderCorpId = new ObjectId();
  const fundId = new ObjectId();
  const nppId = new ObjectId();
  const bondAId = new ObjectId();
  const bondBId = new ObjectId();

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
    liquidCapital: 1_000_000,
    liquidCurrencyCode: "USD",
  };

  const { resolveCorporation, corporationQueryFromParamId } =
    await import("@/lib/api/corporations/resolveQuery");
  vi.mocked(resolveCorporation).mockResolvedValue({ ok: true, corporation: target } as never);
  vi.mocked(corporationQueryFromParamId).mockReturnValue({ _id: parentCorpId } as never);
  db.collectionMocks["corporations"]!.findOne.mockResolvedValue(parent as never);

  const bondA = {
    _id: bondAId,
    corporationId: targetCorpId,
    currencyCode: "USD",
    matured: false,
    defaulted: false,
    couponRate: 6,
    marketPrice: 0.9,
    totalIssued: 17_000,
    publicFloat: 1,
    holders: [
      { characterId: charId, units: 12 },
      { imperialCharacterId: imperialId, units: 4 },
    ],
  };
  const bondB = {
    _id: bondBId,
    corporationId: targetCorpId,
    currencyCode: "USD",
    matured: false,
    defaulted: false,
    couponRate: 5,
    marketPrice: 0.4,
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

  return {
    parentCorpId,
    targetCorpId,
    charId,
    imperialId,
    holderCorpId,
    fundId,
    nppId,
    bondA,
    bondB,
  };
}

function postPayoff(
  targetCorpId: ObjectId,
  parentCorpId: ObjectId,
  headers?: Record<string, string>
) {
  return import("./route").then(({ POST }) =>
    POST(
      new Request(
        `http://localhost/api/corporations/${targetCorpId.toString()}/parent-bond-payoff`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(headers ?? {}) },
          body: JSON.stringify({ parentCorporationId: parentCorpId.toString() }),
        }
      ),
      { params: Promise.resolve({ id: targetCorpId.toString() }) }
    )
  );
}

describe("POST /api/corporations/[id]/parent-bond-payoff — keyed flow", () => {
  it("pays every holder kind once, retires the float, and preserves the body", async () => {
    const f = await setupFixture();

    const res = await postPayoff(f.targetCorpId, f.parentCorpId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({
      success: true,
      paid: 22_000,
      bondsMatured: 2,
      parentCorporationId: f.parentCorpId.toString(),
      targetCorporationId: f.targetCorpId.toString(),
    });

    // One guarded parent debit for the whole face (holders 21_000 + 1_000
    // float); the corp-holder credit is the second corporations write.
    const corpCalls = db.collectionMocks["corporations"]!.updateOne.mock.calls;
    expect(corpCalls).toHaveLength(2);
    const debitCall = corpCalls.find(
      (call) => (call[0] as { _id?: ObjectId })._id?.toString() === f.parentCorpId.toString()
    );
    expect(debitCall?.[0]).toEqual(
      expect.objectContaining({
        _id: f.parentCorpId,
        liquidCapital: { $gte: 22_000 },
        appliedMoneyFlowKeys: { $ne: expect.any(String) },
      })
    );
    expect(debitCall?.[1]).toEqual(
      expect.objectContaining({ $inc: expect.objectContaining({ liquidCapital: -22_000 }) })
    );
    const holderCall = corpCalls.find(
      (call) => (call[0] as { _id?: ObjectId })._id?.toString() === f.holderCorpId.toString()
    );
    expect(holderCall?.[1]).toEqual(
      expect.objectContaining({ $inc: expect.objectContaining({ liquidCapital: 2_000 }) })
    );

    // One resumable credit per holder on its own account and field.
    expect(db.collectionMocks["characters"]!.updateOne).toHaveBeenCalledTimes(1);
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

    // Per-bond maturity claims with the parent_payoff cure stamp.
    const bondCalls = db.collectionMocks["bonds"]!.updateOne.mock.calls;
    expect(bondCalls).toHaveLength(2);
    for (const call of bondCalls) {
      expect(call[1]).toEqual(
        expect.objectContaining({
          $set: expect.objectContaining({
            matured: true,
            marketPrice: 1,
            defaulted: false,
            defaultCure: { cureMethod: "parent_payoff", curedAtTurn: 444 },
          }),
        })
      );
    }

    // Idempotency receipt claimed with a payoff fingerprint.
    const receipts = db.collectionMocks["nonAtomicMoneyFlowReceipts"]!;
    expect(receipts.insertOne).toHaveBeenCalledTimes(1);
    expect((receipts.insertOne.mock.calls[0]?.[0] as { _id: unknown })._id).toEqual(
      expect.any(String)
    );
    expect((receipts.insertOne.mock.calls[0]?.[0] as { fingerprint: string }).fingerprint).toMatch(
      /^bond-payoff:parent_payoff:/
    );

    // Ledger: bond_maturity rows for character/imperial/corp/fund holders;
    // autonomous NPP investment returns stay out of the tx log.
    const { emitTxBulk } = await import("@/lib/financialTxLog/emit");
    expect(vi.mocked(emitTxBulk)).toHaveBeenCalledTimes(1);
    const rows = vi.mocked(emitTxBulk).mock.calls[0]?.[1] as Array<{
      subjectId: ObjectId;
      amount: number;
      meta?: { bondId?: string; units?: number; source?: string; imperial?: boolean };
    }>;
    expect(rows).toHaveLength(4);
    const charRow = rows.find((r) => r.subjectId.toString() === f.charId.toString())!;
    expect(charRow.amount).toBe(12_000);
    expect(charRow.meta).toMatchObject({
      bondId: (f.bondA._id as ObjectId).toString(),
      units: 12,
      source: "parent_bond_payoff",
    });
    const imperialRow = rows.find((r) => r.subjectId.toString() === f.imperialId.toString())!;
    expect(imperialRow.meta).toMatchObject({ units: 4, imperial: true });
    expect(rows.some((r) => r.subjectId.toString() === f.nppId.toString())).toBe(false);
  });

  it("settles without an Idempotency-Key, claiming a minted receipt", async () => {
    const f = await setupFixture();

    const res = await postPayoff(f.targetCorpId, f.parentCorpId);
    expect(res.status).toBe(200);
    expect((await res.json()) as Record<string, unknown>).toMatchObject({
      success: true,
      paid: 22_000,
      bondsMatured: 2,
    });

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
      const res = await postPayoff(f.targetCorpId, f.parentCorpId, { "Idempotency-Key": key });
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
    const headers = { "Idempotency-Key": "parent-payoff-replay" };

    const first = await postPayoff(f.targetCorpId, f.parentCorpId, headers);
    expect(first.status).toBe(200);

    const receipts = db.collectionMocks["nonAtomicMoneyFlowReceipts"]!;
    const fingerprint = (receipts.insertOne.mock.calls[0]?.[0] as { fingerprint: string })
      .fingerprint;
    receipts.insertOne.mockRejectedValueOnce({ code: 11000 });
    receipts.findOne.mockResolvedValue({
      _id: "parent-payoff-replay",
      status: "completed",
      fingerprint,
    });

    const debits = db.collectionMocks["corporations"]!.updateOne.mock.calls.length;
    const second = await postPayoff(f.targetCorpId, f.parentCorpId, headers);
    expect(second.status).toBe(200);
    expect((await second.json()) as Record<string, unknown>).toMatchObject({ success: true });
    expect(db.collectionMocks["corporations"]!.updateOne.mock.calls.length).toBe(debits);
  });

  it("maps a reused key for a different payoff to 409 without moving money", async () => {
    const f = await setupFixture();
    const receipts = db.collectionMocks["nonAtomicMoneyFlowReceipts"]!;
    receipts.insertOne.mockRejectedValueOnce({ code: 11000 });
    // Settled under a different fingerprint: the stored attempt already
    // completed for another payoff, so the conflict stands.
    receipts.findOne.mockResolvedValue({
      _id: "parent-payoff-conflict",
      status: "completed",
      fingerprint: "bond-payoff:parent_payoff:something-else",
    });

    const res = await postPayoff(f.targetCorpId, f.parentCorpId, {
      "Idempotency-Key": "parent-payoff-conflict",
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toContain("different payoff");
    expect(db.collectionMocks["corporations"]!.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks["bonds"]!.updateOne).not.toHaveBeenCalled();
  });

  it("resumes under the same key after a mid-payoff crash instead of conflicting", async () => {
    const f = await setupFixture();
    const headers = { "Idempotency-Key": "parent-payoff-crash" };
    // Crash on the second maturity claim: bond A matured, bond B did not.
    db.collectionMocks["bonds"]!.updateOne.mockResolvedValueOnce({
      matchedCount: 1,
      modifiedCount: 1,
    });
    db.collectionMocks["bonds"]!.updateOne.mockRejectedValueOnce(new Error("INJECTED_CRASH"));

    const crashed = await postPayoff(f.targetCorpId, f.parentCorpId, headers);
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

    // The retry rebuilds from live state: only bond B is still outstanding,
    // so the fingerprint shrinks. Same key must resume, not 409.
    db.collectionMocks["bonds"]!.find.mockReturnValue(makeCursor([f.bondB]));
    receipts.insertOne.mockRejectedValueOnce({ code: 11000 });
    receipts.findOne.mockResolvedValue({
      _id: firstInsert._id,
      status: "in_progress",
      fingerprint: firstInsert.fingerprint,
      bondPayoffPlan: (planUpdate![1] as { $set: { bondPayoffPlan: unknown } }).$set.bondPayoffPlan,
    });

    const retry = await postPayoff(f.targetCorpId, f.parentCorpId, headers);
    expect(retry.status).toBe(200);
    const settled = receipts.updateOne.mock.calls.filter(
      (call) => (call[1] as { $set?: { status?: string } }).$set?.status === "completed"
    );
    expect(settled.length).toBeGreaterThan(0);
    // Bond B's maturity claim ran on the retry.
    const matureB = db.collectionMocks["bonds"]!.updateOne.mock.calls.filter(
      (call) => (call[1] as { $set?: { matured?: boolean } }).$set?.matured === true
    );
    expect(matureB.length).toBeGreaterThan(0);
  });

  it("recovers the stored outcome after the final cure when the live set reads empty", async () => {
    const f = await setupFixture();
    const headers = { "Idempotency-Key": "parent-payoff-final-cure" };

    // A genuinely completed first attempt, captured so the retry below can
    // replay its exact stored plan. Reporting the completed receipt back as
    // `in_progress` models the crash window precisely: every write applied,
    // the completion write lost, every bond matured so the live set is empty.
    const first = await postPayoff(f.targetCorpId, f.parentCorpId, headers);
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

    const retry = await postPayoff(f.targetCorpId, f.parentCorpId, headers);
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual(firstBody);
    const settled = receipts.updateOne.mock.calls.filter(
      (call) => (call[1] as { $set?: { status?: string } }).$set?.status === "completed"
    );
    expect(settled.length).toBeGreaterThan(0);
  });

  it("maps a settled compensated receipt to 409 without moving money again", async () => {
    const f = await setupFixture();
    const headers = { "Idempotency-Key": "parent-payoff-terminal" };

    const first = await postPayoff(f.targetCorpId, f.parentCorpId, headers);
    expect(first.status).toBe(200);

    const receipts = db.collectionMocks["nonAtomicMoneyFlowReceipts"]!;
    const fingerprint = (receipts.insertOne.mock.calls[0]?.[0] as { fingerprint: string })
      .fingerprint;
    const corpWrites = db.collectionMocks["corporations"]!.updateOne.mock.calls.length;
    const bondWrites = db.collectionMocks["bonds"]!.updateOne.mock.calls.length;
    // The stored attempt settled terminally (a later failure compensated its
    // prefix); a retry under the same key must fail closed, not re-attempt.
    receipts.insertOne.mockRejectedValueOnce({ code: 11000 });
    receipts.findOne.mockResolvedValue({
      _id: "parent-payoff-terminal",
      status: "compensated",
      fingerprint,
    });

    const res = await postPayoff(f.targetCorpId, f.parentCorpId, headers);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toContain("already settled");
    expect(db.collectionMocks["corporations"]!.updateOne.mock.calls.length).toBe(corpWrites);
    expect(db.collectionMocks["bonds"]!.updateOne.mock.calls.length).toBe(bondWrites);
  });

  it("maps a terminal receipt to 409 on the empty-remainder path", async () => {
    const f = await setupFixture();
    db.collectionMocks["bonds"]!.find.mockReturnValue(makeCursor([]));
    const receipts = db.collectionMocks["nonAtomicMoneyFlowReceipts"]!;
    receipts.findOne.mockResolvedValue({
      _id: "parent-payoff-empty-terminal",
      status: "failed",
      fingerprint: "bond-payoff:parent_payoff:stale",
    });

    const res = await postPayoff(f.targetCorpId, f.parentCorpId, {
      "Idempotency-Key": "parent-payoff-empty-terminal",
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toContain("already settled");
    expect(db.collectionMocks["corporations"]!.updateOne).not.toHaveBeenCalled();
  });

  it("maps a stored plan naming a different issuer to 409 on the empty-remainder path", async () => {
    const f = await setupFixture();
    const headers = { "Idempotency-Key": "parent-payoff-empty-mismatch" };

    const first = await postPayoff(f.targetCorpId, f.parentCorpId, headers);
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
    // issuer: cross-corp key reuse, fail closed rather than reporting the
    // stored outcome for the wrong payoff.
    db.collectionMocks["bonds"]!.find.mockReturnValue(makeCursor([]));
    receipts.findOne.mockResolvedValue({
      _id: firstInsert._id,
      status: "in_progress",
      fingerprint: firstInsert.fingerprint,
      bondPayoffPlan: { ...storedPlan, issuerCorpIdHex: new ObjectId().toHexString() },
    });

    const res = await postPayoff(f.targetCorpId, f.parentCorpId, headers);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toContain("different payoff");
  });

  it("maps a lost parent-funds race to the historical 400 refusal", async () => {
    const f = await setupFixture();
    // Guard rejects the debit (matchedCount 0, key not yet applied, funds
    // short): the primitive settles failed and the route keeps the 400.
    db.collectionMocks["corporations"]!.updateOne.mockResolvedValueOnce({
      matchedCount: 0,
      modifiedCount: 0,
    });

    const res = await postPayoff(f.targetCorpId, f.parentCorpId);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("Insufficient");
    expect(db.collectionMocks["bonds"]!.updateOne).not.toHaveBeenCalled();
    const { emitTxBulk } = await import("@/lib/financialTxLog/emit");
    expect(vi.mocked(emitTxBulk)).not.toHaveBeenCalled();
  });

  it("aborts before any write when a referenced holder record is missing", async () => {
    const f = await setupFixture();
    db.collectionMocks["characters"]!.find.mockReturnValue({
      project: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
    });

    const res = await postPayoff(f.targetCorpId, f.parentCorpId);
    expect(res.status).toBe(500);
    expect(db.collectionMocks["corporations"]!.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks["bonds"]!.updateOne).not.toHaveBeenCalled();
    const { emitTxBulk } = await import("@/lib/financialTxLog/emit");
    expect(vi.mocked(emitTxBulk)).not.toHaveBeenCalled();
  });

  it("returns 503 when game state is unavailable (no turn=0 leakage)", async () => {
    const f = await setupFixture();
    const { getGameState } = await import("@/lib/gameState");
    vi.mocked(getGameState).mockResolvedValueOnce(null as never);

    const res = await postPayoff(f.targetCorpId, f.parentCorpId);
    expect(res.status).toBe(503);
    expect(db.collectionMocks["bonds"]!.updateOne).not.toHaveBeenCalled();
  });
});
