import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { recordAudit } from "@/lib/audit/recordAudit";
import { isLedgerShadowEnabled } from "@/lib/ledger/featureFlag";
import type { Corporation } from "@/lib/db/types";
import { unlockTechNode } from "@/lib/corporations/commands/techTree/unlockTechNode";
import {
  buildTechUnlockFlushAudit,
  buildTechUnlockRefundUpdate,
  buildTechUnlockTxEntry,
  flushNppTechUnlockLedger,
  type TechUnlockLedgerInput,
} from "@/lib/corporations/techTree/techUnlockLedger";
import { maybePushNppTechUnlock } from "@/lib/turn/npp/corpBehaviorConfig";
import { corpNodeId } from "@/lib/constants/techTree";

vi.mock("@/lib/ledger/featureFlag", () => ({
  isLedgerShadowEnabled: vi.fn().mockResolvedValue(false),
}));
vi.mock("@/lib/audit/recordAudit", () => ({
  recordAudit: vi.fn(),
  recordAuditBulk: vi.fn(),
}));

function makeCorp(overrides: Partial<Corporation> = {}): Corporation {
  return {
    _id: new ObjectId(),
    type: "energy",
    rdScore: 300,
    liquidCapital: 2_136_615_281,
    unlockedTechNodeIds: [],
    techDecadeLane: {},
    userId: new ObjectId(),
    ceoId: new ObjectId(),
    name: "Linee Italiane",
    countryId: "IT",
    ...overrides,
  } as unknown as Corporation;
}

/** In-memory mock db: corporations.updateOne applies $inc, tx rows are captured. */
function mockDb(
  opts: {
    revenues?: number[];
    modifiedCount?: number;
    failTxInserts?: number;
    postOwned?: string[];
    existingRows?: Record<string, unknown>[];
  } = {}
) {
  const {
    revenues = [2_000_000],
    modifiedCount = 1,
    failTxInserts = 0,
    postOwned = [],
    existingRows = [],
  } = opts;
  const corpsUpdateOne = vi.fn().mockResolvedValue({ modifiedCount });
  const txInserts: Record<string, unknown>[] = [];
  let failuresLeft = failTxInserts;
  const txInsertOne = vi.fn((doc: Record<string, unknown>) => {
    if (failuresLeft > 0) {
      failuresLeft -= 1;
      return Promise.reject(new Error("transient ledger outage"));
    }
    txInserts.push(doc);
    return Promise.resolve({ insertedId: doc._id });
  });
  // Stable per-collection instances so tests can override find post-hoc.
  const corpOwnedDocs = postOwned.map((nodeId) => ({
    _id: new ObjectId(),
    unlockedTechNodeIds: [nodeId],
  }));
  const collections: Record<string, any> = {
    corporateSectors: {
      find: () => ({ toArray: () => Promise.resolve(revenues.map((r) => ({ revenue: r }))) }),
    },
    corporations: {
      updateOne: corpsUpdateOne,
      find: () => ({ toArray: () => Promise.resolve(corpOwnedDocs) }),
    },
    financialTxLog: {
      insertOne: txInsertOne,
      find: () => ({ toArray: () => Promise.resolve(existingRows) }),
    },
    gameConfig: { findOne: () => Promise.resolve(null) },
    systemSettings: { findOne: () => Promise.resolve(null) },
    exchangeRates: { find: () => ({ toArray: () => Promise.resolve([]) }) },
  };
  const db = {
    collection: (name: string) => collections[name] ?? { findOne: () => Promise.resolve(null) },
  } as unknown as Db;
  return { db, corpsUpdateOne, txInsertOne, txInserts, collections };
}

const NODE_1950_1 = corpNodeId("1950", 1); // Management by Objectives, rd cost 8
const CASH_1950_1 = Math.round(2_000_000 * 0.15); // 300_000

beforeEach(() => {
  vi.clearAllMocks();
});

function duplicateKeyError(): Error & { code?: number } {
  const err = new Error("E11000 duplicate key error collection") as Error & { code?: number };
  err.code = 11000;
  return err;
}

/**
 * Simulate an insert that applies server-side but loses its acknowledgement,
 * so the retry with the same deterministic _id hits E11000. `mutateStored`
 * corrupts the stored row to simulate a same-_id collision with a different
 * write; `store: false` simulates the row going missing after the duplicate.
 */
function mockAppliedButUnackedTx(
  db: Db,
  txInserts: Record<string, unknown>[],
  opts: {
    mutateStored?: (doc: Record<string, unknown>) => Record<string, unknown>;
    store?: boolean;
  } = {}
) {
  const { mutateStored, store = true } = opts;
  const stored: Record<string, unknown>[] = [];
  let calls = 0;
  (db.collection("financialTxLog") as any).insertOne = vi.fn((doc: Record<string, unknown>) => {
    calls += 1;
    if (calls === 1) {
      if (store) {
        const row = mutateStored ? mutateStored(doc) : doc;
        stored.push(row);
        txInserts.push(row);
      }
      return Promise.reject(new Error("network timeout after apply"));
    }
    return Promise.reject(duplicateKeyError());
  });
  (db.collection("financialTxLog") as any).findOne = (filter: Record<string, any>) =>
    Promise.resolve(stored.find((d) => d._id === filter._id) ?? null);
  return { stored };
}

describe("tech unlock ledger (ticket #1998)", () => {
  it("negative control: the pre-fix cash-only debit moves cash with no ledger row", async () => {
    const corp = makeCorp();
    const { db, txInserts, corpsUpdateOne } = mockDb();
    const res = await db
      .collection("corporations")
      .updateOne(
        { _id: corp._id, liquidCapital: { $gte: CASH_1950_1 } },
        { $inc: { liquidCapital: -CASH_1950_1 } }
      );
    expect(res.modifiedCount).toBe(1);
    expect(corpsUpdateOne).toHaveBeenCalledOnce();
    expect(txInserts).toHaveLength(0);
  });

  it("manual unlock records an exact non-USD debit that reconciles cash", async () => {
    const corp = makeCorp();
    const open = corp.liquidCapital;
    const { db, txInserts } = mockDb();
    const res = await unlockTechNode(db, corp, NODE_1950_1, 1953, 82);

    expect(res).toMatchObject({
      ok: true,
      cashSpent: CASH_1950_1,
      cashRemaining: open - CASH_1950_1,
    });
    expect(txInserts).toHaveLength(1);
    const row = txInserts[0] as Record<string, any>;
    expect(row.type).toBe("corp_tech_unlock");
    expect(row.amount).toBe(-CASH_1950_1);
    expect(row.currencyCode).toBe("ITL");
    expect(row.turn).toBe(82);
    expect(row.subjectId).toEqual(corp._id);
    expect(row.meta.nodeId).toBe(NODE_1950_1);
    expect(row.meta.nodeName).toBe("Management by Objectives");
    // Reconciliation: beginning cash + visible entries = ending cash.
    if (res.ok) {
      expect(open + row.amount).toBe(res.cashRemaining);
    } else {
      throw new Error("expected unlock success");
    }
  });

  it("rejected unlocks write neither cash nor ledger rows", async () => {
    const corp = makeCorp({ liquidCapital: 1_000 });
    const { db, txInserts, corpsUpdateOne } = mockDb();
    const res = await unlockTechNode(db, corp, NODE_1950_1, 1953, 82);
    expect(res).toMatchObject({ ok: false, status: 402 });
    expect(corpsUpdateOne).not.toHaveBeenCalled();
    expect(txInserts).toHaveLength(0);
  });

  it("a raced (guarded-update loser) unlock emits no ledger row", async () => {
    const corp = makeCorp();
    const { db, txInserts } = mockDb({ modifiedCount: 0 });
    const res = await unlockTechNode(db, corp, NODE_1950_1, 1953, 82);
    expect(res).toMatchObject({ ok: false, status: 409 });
    expect(txInserts).toHaveLength(0);
  });

  it("retry after success hits already-owned: exactly one debit, one row", async () => {
    const corp = makeCorp();
    const { db, txInserts, corpsUpdateOne } = mockDb();
    const first = await unlockTechNode(db, corp, NODE_1950_1, 1953, 82);
    expect(first.ok).toBe(true);
    corp.unlockedTechNodeIds = [NODE_1950_1];
    corp.techDecadeLane = { "1950": "generic" };
    const second = await unlockTechNode(db, corp, NODE_1950_1, 1953, 82);
    expect(second).toMatchObject({ ok: false, reason: "already-owned" });
    expect(corpsUpdateOne).toHaveBeenCalledOnce();
    expect(txInserts).toHaveLength(1);
  });

  it("transient ledger failure retries and still records the debit", async () => {
    const corp = makeCorp();
    const { db, txInserts, txInsertOne } = mockDb({ failTxInserts: 1 });
    const res = await unlockTechNode(db, corp, NODE_1950_1, 1953, 82);
    expect(res.ok).toBe(true);
    expect(txInsertOne.mock.calls.length).toBeGreaterThan(1);
    expect(txInserts).toHaveLength(1);
  });

  it("persistent ledger failure rolls the unlock back: no debit, no row", async () => {
    const corp = makeCorp();
    const { db, txInserts, corpsUpdateOne } = mockDb({ failTxInserts: 10 });
    const res = await unlockTechNode(db, corp, NODE_1950_1, 1953, 82);
    expect(res).toMatchObject({ ok: false, status: 500 });
    expect(txInserts).toHaveLength(0);
    expect(corpsUpdateOne.mock.calls.length).toBe(2);
    const [, refund] = corpsUpdateOne.mock.calls[1];
    expect(refund.$inc.liquidCapital).toBe(CASH_1950_1);
    expect(refund.$inc.rdScore).toBe(8);
    expect(refund.$pull).toEqual({ unlockedTechNodeIds: NODE_1950_1 });
  });

  it("an applied-but-unacked ledger insert is adopted, not rolled back", async () => {
    const corp = makeCorp();
    const { db, txInserts, corpsUpdateOne } = mockDb();
    // First attempt: the row is applied server-side but the ack is lost.
    // Retries reuse the same _id, so they hit the unique _id index (E11000).
    mockAppliedButUnackedTx(db, txInserts);

    const res = await unlockTechNode(db, corp, NODE_1950_1, 1953, 82);
    // The debit IS visible, so the unlock must stand: exactly one row, no refund.
    expect(res).toMatchObject({ ok: true, cashSpent: CASH_1950_1 });
    expect(txInserts).toHaveLength(1);
    expect(corpsUpdateOne).toHaveBeenCalledOnce();
    // The adoption completes the audit fan exactly once for the visible debit.
    expect(vi.mocked(recordAudit)).toHaveBeenCalledOnce();
    const envelope = vi.mocked(recordAudit).mock.calls[0][0] as {
      refs: { financialTxLogId: unknown };
    };
    expect(envelope.refs.financialTxLogId).toBe((txInserts[0] as { _id: unknown })._id);
  });

  it("adoption emits one shadow entry and one audit row, never duplicates", async () => {
    const corp = makeCorp();
    const { db, txInserts, corpsUpdateOne, collections } = mockDb();
    type ShadowDoc = { legs: Array<{ amount: number }> };
    const ledgerInsertMany = vi.fn((_docs: ShadowDoc[]) => Promise.resolve({ insertedCount: 1 }));
    collections.ledgerEntries = { insertMany: ledgerInsertMany };
    vi.mocked(isLedgerShadowEnabled).mockResolvedValueOnce(true);
    mockAppliedButUnackedTx(db, txInserts);

    const res = await unlockTechNode(db, corp, NODE_1950_1, 1953, 82);
    expect(res).toMatchObject({ ok: true, cashSpent: CASH_1950_1 });
    expect(corpsUpdateOne).toHaveBeenCalledOnce();
    // The lost ack happened at the insert, before either fan ran, so adoption
    // emits each downstream exactly once from the adopted row.
    expect(ledgerInsertMany).toHaveBeenCalledOnce();
    const shadowDocs = ledgerInsertMany.mock.calls[0][0];
    expect(shadowDocs).toHaveLength(1);
    expect(shadowDocs[0].legs[0].amount).toBe(-CASH_1950_1);
    expect(shadowDocs[0].legs[1].amount).toBe(CASH_1950_1);
    expect(vi.mocked(recordAudit)).toHaveBeenCalledOnce();
  });

  it("a same-_id row with different content is rejected and rolled back", async () => {
    const corp = makeCorp();
    const { db, txInserts, corpsUpdateOne } = mockDb();
    // Same _id, but the stored row is a different write: different amount,
    // node, and ledger key. Matching on type alone would wrongly adopt this.
    mockAppliedButUnackedTx(db, txInserts, {
      mutateStored: (doc) => ({
        ...doc,
        amount: (doc.amount as number) - 1,
        meta: {
          ...(doc.meta as Record<string, unknown>),
          nodeId: "other-node",
          ledgerKey: "other-key",
        },
      }),
    });

    const res = await unlockTechNode(db, corp, NODE_1950_1, 1953, 82);
    // Must fail loudly, never adopted as success: the debit is refunded.
    expect(res).toMatchObject({ ok: false, status: 500 });
    expect(corpsUpdateOne.mock.calls.length).toBe(2);
    const [, refund] = corpsUpdateOne.mock.calls[1];
    expect(refund.$inc.liquidCapital).toBe(CASH_1950_1);
    expect(refund.$inc.rdScore).toBe(8);
    expect(refund.$pull).toEqual({ unlockedTechNodeIds: NODE_1950_1 });
    expect(vi.mocked(recordAudit)).not.toHaveBeenCalled();
  });

  it("a duplicate key with no stored row stays a hard failure and rolls back", async () => {
    const corp = makeCorp();
    const { db, txInserts, corpsUpdateOne } = mockDb();
    (db.collection("financialTxLog") as any).insertOne = vi.fn(() =>
      Promise.reject(duplicateKeyError())
    );
    (db.collection("financialTxLog") as any).findOne = () => Promise.resolve(null);

    const res = await unlockTechNode(db, corp, NODE_1950_1, 1953, 82);
    // Nothing to adopt, so strict failure stands: no row, full refund.
    expect(res).toMatchObject({ ok: false, status: 500 });
    expect(txInserts).toHaveLength(0);
    expect(corpsUpdateOne.mock.calls.length).toBe(2);
    const [, refund] = corpsUpdateOne.mock.calls[1];
    expect(refund.$inc.liquidCapital).toBe(CASH_1950_1);
    expect(refund.$pull).toEqual({ unlockedTechNodeIds: NODE_1950_1 });
    expect(vi.mocked(recordAudit)).not.toHaveBeenCalled();
  });

  it("refund builder reverses the unlock exactly", () => {
    const refund = buildTechUnlockRefundUpdate({
      nodeId: NODE_1950_1,
      decadeId: "1950",
      rdCost: 8,
      cashCost: CASH_1950_1,
      committing: true,
    });
    expect(refund.$inc).toMatchObject({ rdScore: 8, liquidCapital: CASH_1950_1 });
    expect(refund.$pull).toEqual({ unlockedTechNodeIds: NODE_1950_1 });
    expect(refund.$unset?.["techDecadeLane.1950"]).toBe("");
  });

  it("builder stamps identity, currency, turn, and exact cost", () => {
    const corpId = new ObjectId();
    const entry = buildTechUnlockTxEntry({
      corporationId: corpId,
      corporationName: "Linee Italiane",
      nodeId: NODE_1950_1,
      nodeName: "Management by Objectives",
      decadeId: "1950",
      lane: "generic",
      slot: 1,
      rdCost: 8,
      cashCost: CASH_1950_1,
      currencyCode: "ITL",
      turn: 82,
      createdAt: new Date("1953-01-01"),
      alreadyOwned: [],
    });
    expect(entry).toMatchObject({
      type: "corp_tech_unlock",
      amount: -CASH_1950_1,
      currencyCode: "ITL",
      turn: 82,
      subjectType: "corporation",
      subjectId: corpId,
    });
    expect(entry.meta).toMatchObject({ nodeId: NODE_1950_1, nodeName: "Management by Objectives" });
  });
});

describe("NPP tech unlock ledger", () => {
  function nppSetup() {
    const corp = makeCorp({ ceoType: "npp" });
    const dailyGrossRevenueLocal = 2_000_000;
    const corpUpdates: Parameters<typeof maybePushNppTechUnlock>[0]["corpUpdates"] = [];
    const techLedger: TechUnlockLedgerInput[] = [];
    return { corp, dailyGrossRevenueLocal, corpUpdates, techLedger };
  }

  it("autonomous unlock intent flushes an exact ITL debit once committed", async () => {
    const { corp, dailyGrossRevenueLocal, corpUpdates, techLedger } = nppSetup();
    maybePushNppTechUnlock({
      corp,
      dailyGrossRevenueLocal,
      techCurrentYear: 1953,
      turn: 82,
      now: new Date("1953-01-01"),
      corpUpdates,
      techLedger,
    });
    expect(corpUpdates).toHaveLength(1);
    expect(techLedger).toHaveLength(1);
    const intent = techLedger[0];
    expect(intent.currencyCode).toBe("ITL");
    expect(intent.turn).toBe(82);

    const { db, txInserts } = mockDb({
      postOwned: [intent.nodeId],
      existingRows: [],
    });
    // Post-write snapshot shows the node owned.
    (db.collection("corporations").find as any) = () => ({
      toArray: () => Promise.resolve([{ _id: corp._id, unlockedTechNodeIds: [intent.nodeId] }]),
    });
    const result = await flushNppTechUnlockLedger(db, techLedger);
    expect(result).toMatchObject({ attempted: 1, emitted: 1 });
    expect(txInserts).toHaveLength(1);
    const row = txInserts[0] as Record<string, any>;
    expect(row.amount).toBe(-intent.cashCost);
    expect(row.amount).toBe(corpUpdates[0].update.$inc!.liquidCapital);
    expect(row.currencyCode).toBe("ITL");
    expect(row.meta.nodeName).toBe(intent.nodeName);
  });

  it("uncommitted NPP unlocks emit nothing", async () => {
    const { corp, dailyGrossRevenueLocal, corpUpdates, techLedger } = nppSetup();
    maybePushNppTechUnlock({
      corp,
      dailyGrossRevenueLocal,
      techCurrentYear: 1953,
      turn: 82,
      now: new Date(),
      corpUpdates,
      techLedger,
    });
    const { db, txInserts } = mockDb();
    (db.collection("corporations").find as any) = () => ({
      toArray: () => Promise.resolve([{ _id: corp._id, unlockedTechNodeIds: [] }]),
    });
    const result = await flushNppTechUnlockLedger(db, techLedger);
    expect(result).toMatchObject({ skippedUncommitted: 1, emitted: 0 });
    expect(txInserts).toHaveLength(0);
  });

  it("persistently failing NPP ledger rows refund the unlock, not the row", async () => {
    const { corp, dailyGrossRevenueLocal, corpUpdates, techLedger } = nppSetup();
    maybePushNppTechUnlock({
      corp,
      dailyGrossRevenueLocal,
      techCurrentYear: 1953,
      turn: 82,
      now: new Date(),
      corpUpdates,
      techLedger,
    });
    const intent = techLedger[0];
    const { db, txInserts, corpsUpdateOne } = mockDb({ failTxInserts: 10 });
    (db.collection("corporations").find as any) = () => ({
      toArray: () => Promise.resolve([{ _id: corp._id, unlockedTechNodeIds: [intent.nodeId] }]),
    });
    const result = await flushNppTechUnlockLedger(db, techLedger);
    expect(result).toMatchObject({ attempted: 1, emitted: 0, refunded: 1 });
    expect(txInserts).toHaveLength(0);
    expect(corpsUpdateOne).toHaveBeenCalledOnce();
    const [filter, refund] = corpsUpdateOne.mock.calls[0];
    expect(filter).toMatchObject({ _id: corp._id });
    expect(refund.$inc.liquidCapital).toBe(intent.cashCost);
    expect(refund.$pull).toEqual({ unlockedTechNodeIds: intent.nodeId });
  });

  it("already-logged NPP unlocks are not duplicated", async () => {
    const { corp, dailyGrossRevenueLocal, corpUpdates, techLedger } = nppSetup();
    maybePushNppTechUnlock({
      corp,
      dailyGrossRevenueLocal,
      techCurrentYear: 1953,
      turn: 82,
      now: new Date(),
      corpUpdates,
      techLedger,
    });
    const intent = techLedger[0];
    const { db, txInserts } = mockDb();
    (db.collection("corporations").find as any) = () => ({
      toArray: () => Promise.resolve([{ _id: corp._id, unlockedTechNodeIds: [intent.nodeId] }]),
    });
    (db.collection("financialTxLog").find as any) = () => ({
      toArray: () =>
        Promise.resolve([
          {
            subjectId: corp._id,
            turn: 82,
            meta: {
              ledgerKey: `tech-unlock:${corp._id.toString()}:${intent.nodeId}:t82`,
              nodeId: intent.nodeId,
            },
          },
        ]),
    });
    const result = await flushNppTechUnlockLedger(db, techLedger);
    expect(result).toMatchObject({ skippedDuplicate: 1, emitted: 0 });
    expect(txInserts).toHaveLength(0);
  });

  it("omits a turn audit when every intended ledger row was emitted", () => {
    expect(
      buildTechUnlockFlushAudit({
        attempted: 2,
        emitted: 2,
        skippedUncommitted: 0,
        skippedDuplicate: 0,
        refunded: 0,
      })
    ).toBeNull();
  });

  it("summarizes exceptional NPP flush outcomes for the turn audit", () => {
    expect(
      buildTechUnlockFlushAudit({
        attempted: 3,
        emitted: 1,
        skippedUncommitted: 1,
        skippedDuplicate: 0,
        refunded: 1,
      })
    ).toMatchObject({
      action: "corp.tech_unlock_ledger",
      outcome: "error",
      meta: { attempted: 3, emitted: 1, skippedUncommitted: 1, refunded: 1 },
    });
  });
});
