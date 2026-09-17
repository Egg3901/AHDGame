/**
 * Tests for POST /api/corporations/[id]/bond-default/refinance (issue #1672).
 *
 * The first block is the financial-ledger regression: refinance is a
 * debt-for-debt swap (defaulted-bond holders migrate to a freshly-issued
 * bond at par, zero cash changes hands), so the emitted row uses amount=0
 * but still records the event with the new bond's principal in
 * `meta.faceValue`. Without this row, "show me all bond-issuance events on
 * turn N" is silently incomplete.
 *
 * The second block covers the public Idempotency-Key contract: missing key,
 * invalid key, replay, conflict, recovery after the final cure, terminal
 * mapping, and the preserved historical HTTP errors.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireBasicAuth: vi.fn() }));
vi.mock("@/lib/api/corporations/resolveQuery", () => ({
  resolveCorporation: vi.fn(),
  requireCeo: vi.fn(),
}));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn(),
  rateLimitResponse: vi.fn(),
}));
vi.mock("@/lib/wireEvent", () => ({
  logWireEvent: vi.fn(),
  wireHeadlineBond: vi.fn().mockReturnValue("Bond issued"),
}));
vi.mock("@/lib/gameState", () => ({
  getGameState: vi.fn().mockResolvedValue({ currentTurn: 444 }),
}));
vi.mock("@/lib/financialTxLog/emit", () => ({
  emitTx: vi.fn().mockResolvedValue(undefined),
  emitTxBulk: vi.fn().mockResolvedValue(undefined),
  loadTxThresholds: vi.fn().mockResolvedValue({}),
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
    "corporateSectors",
    "centralBanks",
    "corporationHistory",
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

describe("POST /api/corporations/[id]/bond-default/refinance — ledger emission", () => {
  it("emits a cashless bond_issuance tx for the new refinance bond", async () => {
    const corpId = new ObjectId();
    const charId = new ObjectId();

    const corporation = {
      _id: corpId,
      name: "Refi Corp",
      countryId: "US",
      liquidCapital: 100_000_000,
      liquidCurrencyCode: "USD",
      bondDefaultRefinanceCount: 0,
      sequentialId: 99,
    };

    const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: true,
      corporation,
    } as never);

    const defaultedBond = {
      _id: new ObjectId(),
      corporationId: corpId,
      currencyCode: "USD",
      matured: false,
      defaulted: true,
      couponRate: 8,
      totalIssued: 10_000_000,
      holders: [{ characterId: charId, units: 10_000 }],
      publicFloat: 0,
    };

    // Both `find` calls (defaulted bonds + all non-matured) return the same
    // single defaulted bond in this fixture.
    db.collectionMocks["bonds"]!.find.mockImplementation(() => makeCursor([defaultedBond]));

    db.collectionMocks["corporateSectors"]!.find.mockReturnValue(makeCursor([]));
    db.collectionMocks["centralBanks"]!.find.mockReturnValue(
      makeCursor([{ countryId: "US", primeRate: 5 }])
    );
    db.collectionMocks["exchangeRates"]!.find.mockReturnValue(makeCursor([]));
    db.collectionMocks["corporationHistory"]!.findOne.mockResolvedValue({
      income: 1_000_000,
    });

    const req = new Request(
      `http://localhost/api/corporations/${corpId.toString()}/bond-default/refinance`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maturityTurns: 96 }),
      }
    );
    const { POST } = await import("./route");
    const res = await POST(req, { params: Promise.resolve({ id: corpId.toString() }) });
    expect(res.status).toBe(200);

    const { emitTx } = await import("@/lib/financialTxLog/emit");
    expect(vi.mocked(emitTx)).toHaveBeenCalled();
    const issuanceCall = vi
      .mocked(emitTx)
      .mock.calls.find(([, entry]) => (entry as { type?: string }).type === "bond_issuance");
    expect(issuanceCall).toBeDefined();
    const entry = issuanceCall![1] as {
      type: string;
      subjectType: string;
      subjectId: ObjectId;
      subjectName: string;
      amount: number;
      currencyCode: string;
      meta?: { bondId?: string; refinance?: boolean; faceValue?: number };
    };
    expect(entry.subjectType).toBe("corporation");
    expect(entry.subjectId.toString()).toBe(corpId.toString());
    expect(entry.subjectName).toBe("Refi Corp");
    // Cash flow is zero — debt-for-debt swap, no investors paid in.
    expect(entry.amount).toBe(0);
    expect(entry.meta?.refinance).toBe(true);
    // The replacement bond carries the deterministic key-derived _id (a
    // retry converges instead of double-issuing), not a minted random id.
    const insertCall = db.collectionMocks["bonds"]!.insertOne.mock.calls[0]!;
    const insertedId = (insertCall[0] as { _id: ObjectId })._id.toString();
    expect(entry.meta?.bondId).toBe(insertedId);
    expect(entry.meta?.faceValue).toBeGreaterThan(0);

    // The retired bond is cured through the keyed per-bond cure claim
    // (guarded updateOne, never a blanket updateMany): flipped to matured +
    // defaulted=false with a defaultCure marker so the Bonds tab can render
    // "DEFAULT CURED (T<x> → refinance)", while defaultedAtTurn (the
    // historical mark) is never overwritten or unset.
    expect(db.collectionMocks["bonds"]!.updateMany).not.toHaveBeenCalled();
    const cureCall = db.collectionMocks["bonds"]!.updateOne.mock.calls.find(
      (call) => (call[0] as { _id?: ObjectId })._id?.toString() === defaultedBond._id.toString()
    );
    expect(cureCall).toBeDefined();
    const cureUpdate = cureCall![1] as {
      $set: {
        matured?: boolean;
        defaulted?: boolean;
        defaultCure?: { cureMethod?: string; curedAtTurn?: number };
      };
      $unset?: Record<string, string>;
    };
    expect(cureUpdate.$set.matured).toBe(true);
    expect(cureUpdate.$set.defaulted).toBe(false);
    expect(cureUpdate.$set.defaultCure?.cureMethod).toBe("refinance");
    expect(cureUpdate.$set.defaultCure?.curedAtTurn).toBe(444);
    expect(cureUpdate.$unset?.defaultedAtTurn).toBeUndefined();
  });
});

describe("POST /api/corporations/[id]/bond-default/refinance — Idempotency-Key contract", () => {
  async function setupRefiFixture(overrides: Record<string, unknown> = {}) {
    const corpId = new ObjectId();
    const charId = new ObjectId();
    const corporation = {
      _id: corpId,
      name: "Refi Corp",
      countryId: "US",
      liquidCapital: 100_000_000,
      liquidCurrencyCode: "USD",
      bondDefaultRefinanceCount: 0,
      sequentialId: 99,
      ...overrides,
    };
    const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({ ok: true, corporation } as never);
    const bond = {
      _id: new ObjectId(),
      corporationId: corpId,
      currencyCode: "USD",
      matured: false,
      defaulted: true,
      couponRate: 8,
      totalIssued: 10_000_000,
      holders: [{ characterId: charId, units: 10_000 }],
      publicFloat: 0,
    };
    db.collection("nonAtomicMoneyFlowReceipts");
    db.collectionMocks["bonds"]!.find.mockImplementation(() => makeCursor([bond]));
    db.collectionMocks["corporateSectors"]!.find.mockReturnValue(makeCursor([]));
    db.collectionMocks["centralBanks"]!.find.mockReturnValue(
      makeCursor([{ countryId: "US", primeRate: 5 }])
    );
    db.collectionMocks["exchangeRates"]!.find.mockReturnValue(makeCursor([]));
    db.collectionMocks["corporationHistory"]!.findOne.mockResolvedValue({ income: 1_000_000 });
    return { corpId, charId, bond, corporation };
  }

  function postRefinance(corpId: ObjectId, headers: Record<string, string> = {}) {
    return import("./route").then(({ POST }) =>
      POST(
        new Request(
          `http://localhost/api/corporations/${corpId.toString()}/bond-default/refinance`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", ...headers },
            body: JSON.stringify({ maturityTurns: 96 }),
          }
        ),
        { params: Promise.resolve({ id: corpId.toString() }) }
      )
    );
  }

  it("settles without an Idempotency-Key, claiming a minted receipt", async () => {
    const f = await setupRefiFixture();

    const res = await postRefinance(f.corpId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; bondId: string };
    expect(body.success).toBe(true);

    // No client key: the attempt is still crash-safe within itself, keyed
    // under a minted id rather than a client-supplied one.
    const receiptInsert = db.collectionMocks["nonAtomicMoneyFlowReceipts"]!.insertOne.mock
      .calls[0]![0] as { _id: string };
    expect(typeof receiptInsert._id).toBe("string");
    expect(receiptInsert._id.length).toBeGreaterThan(0);
  });

  it("rejects an empty or overlong Idempotency-Key without touching money", async () => {
    const f = await setupRefiFixture();

    for (const key of ["", "x".repeat(129)]) {
      const res = await postRefinance(f.corpId, { "Idempotency-Key": key });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe(
        "Invalid Idempotency-Key header"
      );
    }
    expect(db.collectionMocks["nonAtomicMoneyFlowReceipts"]!.insertOne).not.toHaveBeenCalled();
    expect(db.collectionMocks["bonds"]!.insertOne).not.toHaveBeenCalled();
    expect(db.collectionMocks["bonds"]!.updateOne).not.toHaveBeenCalled();
  });

  it("replays the same key without issuing again", async () => {
    const f = await setupRefiFixture();
    const headers = { "Idempotency-Key": "refi-route-replay" };

    const first = await postRefinance(f.corpId, headers);
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as { bondId: string };

    const receipts = db.collectionMocks["nonAtomicMoneyFlowReceipts"]!;
    const fingerprint = (receipts.insertOne.mock.calls[0]?.[0] as { fingerprint: string })
      .fingerprint;
    receipts.insertOne.mockRejectedValueOnce({ code: 11000 });
    receipts.findOne.mockResolvedValue({
      _id: "refi-route-replay",
      status: "completed",
      fingerprint,
    });

    const inserts = db.collectionMocks["bonds"]!.insertOne.mock.calls.length;
    const second = await postRefinance(f.corpId, headers);
    expect(second.status).toBe(200);
    expect(((await second.json()) as { bondId: string }).bondId).toBe(firstBody.bondId);
    expect(db.collectionMocks["bonds"]!.insertOne.mock.calls.length).toBe(inserts);
  });

  it("maps a reused key for a different refinance to 409 without issuing", async () => {
    const f = await setupRefiFixture();
    const receipts = db.collectionMocks["nonAtomicMoneyFlowReceipts"]!;
    receipts.insertOne.mockRejectedValueOnce({ code: 11000 });
    receipts.findOne.mockResolvedValue({
      _id: "refi-route-conflict",
      status: "completed",
      fingerprint: "bond-refinance:something-else",
    });

    const res = await postRefinance(f.corpId, { "Idempotency-Key": "refi-route-conflict" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toContain("different refinance");
    expect(db.collectionMocks["bonds"]!.insertOne).not.toHaveBeenCalled();
    expect(db.collectionMocks["bonds"]!.updateOne).not.toHaveBeenCalled();
  });

  it("recovers the stored outcome after the final cure when the live set reads empty", async () => {
    const f = await setupRefiFixture();
    const headers = { "Idempotency-Key": "refi-route-final-cure" };

    // A genuinely completed first attempt, captured so the retry below can
    // replay its exact stored plan. Reporting the completed receipt back as
    // `in_progress` models the crash window precisely: every write applied,
    // the completion write lost, every bond cured so the live set is empty.
    const first = await postRefinance(f.corpId, headers);
    expect(first.status).toBe(200);
    const firstBody = await first.json();

    const receipts = db.collectionMocks["nonAtomicMoneyFlowReceipts"]!;
    const firstInsert = receipts.insertOne.mock.calls[0]?.[0] as {
      _id: string;
      fingerprint: string;
    };
    const planUpdate = receipts.updateOne.mock.calls.find(
      (call) => (call[1] as { $set?: { bondRefinancePlan?: unknown } }).$set?.bondRefinancePlan
    );
    expect(planUpdate).toBeDefined();

    db.collectionMocks["bonds"]!.find.mockImplementation(() => makeCursor([]));
    receipts.insertOne.mockRejectedValueOnce({ code: 11000 });
    receipts.findOne.mockResolvedValue({
      _id: firstInsert._id,
      status: "in_progress",
      fingerprint: firstInsert.fingerprint,
      bondRefinancePlan: (planUpdate![1] as { $set: { bondRefinancePlan: unknown } }).$set
        .bondRefinancePlan,
    });

    const retry = await postRefinance(f.corpId, headers);
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual(firstBody);
    const settled = receipts.updateOne.mock.calls.filter(
      (call) => (call[1] as { $set?: { status?: string } }).$set?.status === "completed"
    );
    expect(settled.length).toBeGreaterThan(0);
  });

  it("maps a settled failed receipt to 409", async () => {
    const f = await setupRefiFixture();
    const headers = { "Idempotency-Key": "refi-route-terminal" };
    // Force the cure claim to lose its race: the first attempt compensates
    // its count prefix and settles terminally behind the 400 bond-state
    // surface. A retry under the same key must fail closed, not re-attempt.
    db.collectionMocks["bonds"]!.updateOne.mockResolvedValueOnce({
      matchedCount: 0,
      modifiedCount: 0,
    } as never);
    const failed = await postRefinance(f.corpId, headers);
    expect(failed.status).toBe(400);

    const receipts = db.collectionMocks["nonAtomicMoneyFlowReceipts"]!;
    const fingerprint = (receipts.insertOne.mock.calls[0]?.[0] as { fingerprint: string })
      .fingerprint;
    receipts.insertOne.mockRejectedValueOnce({ code: 11000 });
    receipts.findOne.mockResolvedValue({
      _id: "refi-route-terminal",
      status: "compensated",
      fingerprint,
    });

    const res = await postRefinance(f.corpId, headers);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toContain("already settled");
    expect(db.collectionMocks["bonds"]!.insertOne).not.toHaveBeenCalled();
  });

  it("preserves the no-default 400 without a key", async () => {
    const f = await setupRefiFixture();
    db.collectionMocks["bonds"]!.find.mockImplementation(() => makeCursor([]));

    const res = await postRefinance(f.corpId);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe(
      "No defaulted bonds to refinance"
    );
    expect(db.collectionMocks["nonAtomicMoneyFlowReceipts"]!.insertOne).not.toHaveBeenCalled();
  });

  it("preserves the lifetime-cap 400", async () => {
    const { MAX_BOND_DEFAULT_REFINANCES } = await import("@/lib/constants/bonds");
    const f = await setupRefiFixture({ bondDefaultRefinanceCount: MAX_BOND_DEFAULT_REFINANCES });

    const res = await postRefinance(f.corpId);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("Refinance limit reached");
    expect(db.collectionMocks["nonAtomicMoneyFlowReceipts"]!.insertOne).not.toHaveBeenCalled();
  });

  it("preserves the national-corporation 400", async () => {
    const f = await setupRefiFixture({ countryOwnerId: new ObjectId() });

    const res = await postRefinance(f.corpId);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe(
      "Not available for national corporations"
    );
  });

  it("preserves the IMF-restructuring 400", async () => {
    const f = await setupRefiFixture({ imfBailoutActive: true });

    const res = await postRefinance(f.corpId);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("IMF restructuring");
  });

  it("preserves the game-state 503", async () => {
    const f = await setupRefiFixture();
    const { getGameState } = await import("@/lib/gameState");
    vi.mocked(getGameState).mockResolvedValueOnce(null as never);

    const res = await postRefinance(f.corpId);
    expect(res.status).toBe(503);
    expect(db.collectionMocks["bonds"]!.insertOne).not.toHaveBeenCalled();
  });

  it("preserves the debt-limit 400 when equity cannot carry the roll", async () => {
    const f = await setupRefiFixture({ liquidCapital: 1_000 });

    const res = await postRefinance(f.corpId);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain(
      "Cannot refinance within debt limits"
    );
    expect(db.collectionMocks["bonds"]!.insertOne).not.toHaveBeenCalled();
  });
});
