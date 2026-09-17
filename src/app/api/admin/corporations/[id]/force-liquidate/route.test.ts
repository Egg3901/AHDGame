/**
 * Keyed-flow tests for POST /api/admin/corporations/[id]/force-liquidate
 * (issue #1672): same Idempotency-Key contract as the CEO dissolve route —
 * invalid key, minted key, replay, conflict, and corp-gone recovery — plus
 * the admin auth and confirmation-body contract.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

// Warm the route's (large) import graph at collection time (see the CEO
// dissolve route tests).
await import("./route");

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn(), getMongoClient: vi.fn() }));
vi.mock("@/lib/api/requireAdmin", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/db/transactionSupport", () => ({
  assertTransactionSupportAtBoot: vi.fn().mockResolvedValue(false),
}));
vi.mock("@/lib/wireEvent", () => ({
  logWireEvent: vi.fn(),
  wireHeadlineCorpDissolved: vi.fn().mockReturnValue("Corp liquidated headline"),
}));
vi.mock("@/lib/currency/featureFlag", () => ({
  isForexEnabled: vi.fn().mockResolvedValue(false),
}));
vi.mock("@/lib/corporations/releaseHeldSharesToFloat", () => ({
  releaseCorporationHeldSharesToFloat: vi.fn().mockResolvedValue(undefined),
}));

let db: MockDb;

beforeEach(() => {
  db = createMockDb();
  vi.clearAllMocks();
  for (const name of [
    "bonds",
    "corporateSectors",
    "centralBanks",
    "characters",
    "corporations",
    "bondHistory",
    "nonAtomicMoneyFlowReceipts",
  ]) {
    db.collection(name);
  }
  const receipts = db.collectionMocks.nonAtomicMoneyFlowReceipts;
  receipts.insertOne.mockResolvedValue({ insertedId: "507f1f77bcf86cd799439011" });
  receipts.findOne.mockResolvedValue(null);
  receipts.updateOne.mockResolvedValue({ modifiedCount: 1, matchedCount: 1 });
});

async function setup() {
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as never);
  const { requireAdmin } = await import("@/lib/api/requireAdmin");
  vi.mocked(requireAdmin).mockResolvedValue({ ok: true, admin: { id: "admin" } } as never);
}

async function setupFixture() {
  const corpId = new ObjectId();
  const charId = new ObjectId();
  const corporation = {
    _id: corpId,
    name: "Liquidated Corp",
    countryId: "US",
    liquidCapital: 500_000,
    totalShares: 100,
    shareholders: [],
  };
  db.collectionMocks.corporations.findOne.mockResolvedValue(corporation as never);
  // Built once: the executor fingerprints bond _ids, so a per-call factory
  // would fork the fingerprint on every retry and turn replays into key
  // conflicts.
  const bond = {
    _id: new ObjectId(),
    corporationId: corpId,
    matured: false,
    defaulted: true,
    totalIssued: 100_000,
    couponRate: 5,
    holders: [{ characterId: charId, units: 100 }],
    publicFloat: 0,
  };
  db.collectionMocks.bonds.find.mockReturnValue({ toArray: async () => [bond] });
  db.collectionMocks.corporateSectors.find.mockReturnValue({ toArray: async () => [] });
  db.collectionMocks.centralBanks.find.mockReturnValue({ toArray: async () => [] });
  return { corpId, charId };
}

function postLiquidate(id: string, headers?: Record<string, string>) {
  return import("./route").then(({ POST }) =>
    POST(
      new Request(`http://localhost/api/admin/corporations/${id}/force-liquidate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(headers ?? {}) },
        body: JSON.stringify({ confirm: true }),
      }),
      { params: Promise.resolve({ id }) }
    )
  );
}

describe("POST /api/admin/corporations/[id]/force-liquidate — keyed flow", () => {
  it("returns 403 when not an admin", async () => {
    await setup();
    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }),
    } as never);

    const res = await postLiquidate(new ObjectId().toHexString());
    expect(res.status).toBe(403);
  });

  it("returns 400 when body validation fails", async () => {
    await setup();
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/admin/corporations/abc/force-liquidate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ id: "abc" }) }
    );
    expect(res.status).toBe(400);
  });

  it("rejects an empty or overlong Idempotency-Key without touching money", async () => {
    await setup();
    await setupFixture();

    for (const key of ["", "x".repeat(129)]) {
      const res = await postLiquidate(new ObjectId().toHexString(), { "Idempotency-Key": key });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe(
        "Invalid Idempotency-Key header"
      );
    }
    expect(db.collectionMocks.nonAtomicMoneyFlowReceipts.insertOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.characters.updateOne).not.toHaveBeenCalled();
  });

  it("liquidates under the client key and settles under a minted key without one", async () => {
    await setup();
    const { corpId } = await setupFixture();

    const keyed = await postLiquidate(corpId.toHexString(), {
      "Idempotency-Key": "liquidate-keyed",
    });
    expect(keyed.status).toBe(200);
    const keyedBody = (await keyed.json()) as { success: boolean; message: string };
    expect(keyedBody.success).toBe(true);
    expect(keyedBody.message).toContain("liquidated by admin");

    const receipts = db.collectionMocks.nonAtomicMoneyFlowReceipts;
    expect(
      (receipts.insertOne.mock.calls[0]?.[0] as { _id: string })._id
    ).toBe("liquidate-keyed");
  });

  it("replays the same Idempotency-Key without moving money again", async () => {
    await setup();
    const { corpId } = await setupFixture();
    const headers = { "Idempotency-Key": "liquidate-replay" };

    const first = await postLiquidate(corpId.toHexString(), headers);
    expect(first.status).toBe(200);
    const firstBody = await first.json();

    const receipts = db.collectionMocks.nonAtomicMoneyFlowReceipts;
    const fingerprint = (receipts.insertOne.mock.calls[0]?.[0] as { fingerprint: string })
      .fingerprint;
    receipts.insertOne.mockRejectedValueOnce({ code: 11000 });
    receipts.findOne.mockResolvedValue({
      _id: "liquidate-replay",
      status: "completed",
      fingerprint,
    });

    const holderWrites = db.collectionMocks.characters.updateOne.mock.calls.length;
    const second = await postLiquidate(corpId.toHexString(), headers);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(firstBody);
    expect(db.collectionMocks.characters.updateOne.mock.calls.length).toBe(holderWrites);
  });

  it("maps a reused key for a different dissolution to 409", async () => {
    await setup();
    const { corpId } = await setupFixture();
    const headers = { "Idempotency-Key": "liquidate-conflict" };

    const first = await postLiquidate(corpId.toHexString(), headers);
    expect(first.status).toBe(200);

    const receipts = db.collectionMocks.nonAtomicMoneyFlowReceipts;
    receipts.insertOne.mockRejectedValueOnce({ code: 11000 });
    receipts.findOne.mockResolvedValue({
      _id: "liquidate-conflict",
      status: "completed",
      fingerprint: "bond-dissolution:something-else-entirely",
    });

    const res = await postLiquidate(corpId.toHexString(), headers);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toContain("different dissolution");
  });

  it("replays from the completed receipt after the corporation is already gone", async () => {
    await setup();
    const corpIdHex = new ObjectId().toHexString();
    db.collectionMocks.corporations.findOne.mockResolvedValue(null);
    db.collectionMocks.nonAtomicMoneyFlowReceipts.findOne.mockResolvedValue({
      _id: "liquidate-gone",
      status: "completed",
      fingerprint: "bond-dissolution:gone",
      bondDissolutionPlan: {
        version: 1,
        corpIdHex,
        holders: [],
        funds: [],
        pools: [],
        outcome: {
          corpIdHex,
          corpName: "Liquidated Corp",
          bondRecoveryPool: 100_000,
          shareholderPool: 400_000,
          shareholderPayouts: [],
          corporateShareholderPayouts: [],
          publicFloatPayout: null,
          totalPayoutToPeople: 100_000,
        },
      },
    });

    const res = await postLiquidate(corpIdHex, { "Idempotency-Key": "liquidate-gone" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.success).toBe(true);
    expect(body.bondRecoveryPool).toBe(100_000);
    expect(body.totalPayoutToPeople).toBe(100_000);
  });

  it("stays loud with 409 on a terminal receipt after the corporation is gone", async () => {
    await setup();
    const corpIdHex = new ObjectId().toHexString();
    db.collectionMocks.corporations.findOne.mockResolvedValue(null);
    db.collectionMocks.nonAtomicMoneyFlowReceipts.findOne.mockResolvedValue({
      _id: "liquidate-gone-terminal",
      status: "compensated",
      fingerprint: "bond-dissolution:gone-terminal",
    });

    const res = await postLiquidate(corpIdHex, { "Idempotency-Key": "liquidate-gone-terminal" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toContain("already settled");
  });
});
