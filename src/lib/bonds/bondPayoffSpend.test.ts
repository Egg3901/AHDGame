import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import {
  applyBondPayoffSpend,
  buildBondPayoffFingerprint,
  isBondPayoffOutcome,
  resumeBondPayoffByKey,
  BOND_PAYOFF_FUNDS,
  BOND_PAYOFF_HOLDER,
  BOND_PAYOFF_MATURE,
  type BondPayoffSpendInput,
} from "./bondPayoffSpend";
import {
  MoneyFlowKeyConflictError,
  MoneyFlowTerminalError,
  NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION,
  type MoneyFlowReceipt,
} from "@/lib/db/nonAtomicMoneyFlow";

const { supportMock, getMongoClientMock } = vi.hoisted(() => ({
  supportMock: vi.fn(),
  getMongoClientMock: vi.fn(),
}));

vi.mock("@/lib/db/transactionSupport", () => ({
  assertTransactionSupportAtBoot: supportMock,
}));

vi.mock("@/lib/mongodb", () => ({
  getMongoClient: getMongoClientMock,
  getDb: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Stateful in-memory fakes honoring exactly the operators the payoff
// primitive emits ($inc incl. dotted balance fields, $push+$each+$slice key
// records, $set, $unset for maturity reverts; _id equality, $ne-on-keys,
// $gte guards, ObjectId equality, duplicate-key errors on insert), so an
// injected crash between any two writes models a real process death between
// the corresponding sequential Mongo writes.
// ---------------------------------------------------------------------------

function docKey(id: unknown): string {
  if (typeof id === "string") return id;
  if (id instanceof ObjectId) return id.toHexString();
  return String(id);
}

function valueEquals(actual: unknown, expected: unknown): boolean {
  if (actual instanceof ObjectId && expected instanceof ObjectId) {
    return actual.equals(expected);
  }
  return actual === expected;
}

function getPath(doc: Record<string, unknown>, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], doc);
}

function setPath(doc: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  let node = doc;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const part = parts[i]!;
    const next = node[part];
    if (typeof next !== "object" || next === null) node[part] = {};
    node = node[part] as Record<string, unknown>;
  }
  node[parts[parts.length - 1]!] = value;
}

function deletePath(doc: Record<string, unknown>, path: string): void {
  const parts = path.split(".");
  let node = doc;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const next = node[parts[i]!] as Record<string, unknown> | undefined;
    if (typeof next !== "object" || next === null) return;
    node = next;
  }
  delete node[parts[parts.length - 1]!];
}

function matchesFilter(doc: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  for (const [field, condition] of Object.entries(filter)) {
    if (field === "_id") continue;
    const actual = getPath(doc, field);
    if (typeof condition === "object" && condition !== null && !(condition instanceof ObjectId)) {
      const ops = condition as Record<string, unknown>;
      if ("$ne" in ops) {
        const keys = doc[field] as string[] | undefined;
        if (keys?.includes(ops.$ne as string)) return false;
        continue;
      }
      if ("$gte" in ops) {
        if (!(typeof actual === "number" && actual >= (ops.$gte as number))) return false;
        continue;
      }
      return false;
    }
    if (!valueEquals(actual, condition)) return false;
  }
  return true;
}

class FakeCollection {
  readonly docs = new Map<string, Record<string, unknown>>();

  constructor(private readonly db: FakeDb) {}

  private countWrite(): void {
    this.db.writeCount += 1;
    if (this.db.writeCount > this.db.crashAfterWrites) {
      throw new Error("INJECTED_CRASH");
    }
  }

  async insertOne(doc: Record<string, unknown>): Promise<{ insertedId: unknown }> {
    this.countWrite();
    const key = docKey(doc._id);
    if (this.docs.has(key)) {
      const error = new Error("E11000 duplicate key error") as Error & { code: number };
      error.code = 11000;
      throw error;
    }
    this.docs.set(key, structuredClone(doc));
    return { insertedId: doc._id };
  }

  async findOne(
    filter: Record<string, unknown>,
    opts?: { projection?: Record<string, unknown> }
  ): Promise<Record<string, unknown> | null> {
    const doc = this.docs.get(docKey(filter._id));
    if (!doc) return null;
    if (!opts?.projection) return structuredClone(doc);
    const out: Record<string, unknown> = { _id: doc._id };
    for (const field of Object.keys(opts.projection)) {
      if (field !== "_id") out[field] = structuredClone(doc[field]);
    }
    return out;
  }

  async updateOne(
    filter: Record<string, unknown>,
    update: Record<string, unknown>
  ): Promise<{ matchedCount: number; modifiedCount: number }> {
    this.countWrite();
    const doc = this.docs.get(docKey(filter._id));
    if (!doc) return { matchedCount: 0, modifiedCount: 0 };
    if (!matchesFilter(doc, filter)) return { matchedCount: 0, modifiedCount: 0 };

    const inc = (update.$inc ?? {}) as Record<string, number>;
    for (const [field, delta] of Object.entries(inc)) {
      setPath(doc, field, ((getPath(doc, field) as number | undefined) ?? 0) + delta);
    }
    const push = (update.$push ?? {}) as Record<string, { $each: unknown[]; $slice: number }>;
    for (const [field, spec] of Object.entries(push)) {
      const current = (doc[field] as unknown[] | undefined) ?? [];
      const next = [...current, ...spec.$each];
      doc[field] = spec.$slice < 0 ? next.slice(spec.$slice) : next;
    }
    const set = (update.$set ?? {}) as Record<string, unknown>;
    for (const [field, value] of Object.entries(set)) {
      setPath(doc, field, value);
    }
    const unset = (update.$unset ?? {}) as Record<string, unknown>;
    for (const field of Object.keys(unset)) {
      deletePath(doc, field);
    }
    return { matchedCount: 1, modifiedCount: 1 };
  }
}

class FakeDb {
  writeCount = 0;
  crashAfterWrites = Number.POSITIVE_INFINITY;
  private readonly collections = new Map<string, FakeCollection>();

  collection(name: string): FakeCollection {
    let collection = this.collections.get(name);
    if (!collection) {
      collection = new FakeCollection(this);
      this.collections.set(name, collection);
    }
    return collection;
  }
}

const payerId = new ObjectId();
const issuerId = new ObjectId();
const charId = new ObjectId();
const imperialId = new ObjectId();
const holderCorpId = new ObjectId();
const fundId = new ObjectId();
const nppId = new ObjectId();
const bondA = new ObjectId();
const bondB = new ObjectId();
const NOW = new Date("2026-09-17T00:00:00Z");

// Face is 1_000 per unit. Bond A: 17 held units (17_000) + 50 float units
// (50_000). Bond B: 5 held units (5_000), no float. The payer funds the whole
// 72_000 face; holders receive only their own 22_000.
const DEBIT = 72_000;

function seedDb(db: FakeDb): void {
  db.collection("corporations").docs.set(payerId.toHexString(), {
    _id: payerId,
    liquidCapital: 1_000_000,
    shareEscrowBalance: 50_000,
  });
  db.collection("corporations").docs.set(issuerId.toHexString(), {
    _id: issuerId,
    liquidCapital: 10_000,
  });
  db.collection("corporations").docs.set(holderCorpId.toHexString(), {
    _id: holderCorpId,
    liquidCapital: 5_000,
  });
  db.collection("characters").docs.set(charId.toHexString(), { _id: charId, cashOnHand: 0 });
  db.collection("imperialCharacters").docs.set(imperialId.toHexString(), {
    _id: imperialId,
    cashOnHand: 0,
  });
  db.collection("indexFunds").docs.set(fundId.toHexString(), { _id: fundId, cashAnchor: 100 });
  db.collection("npps").docs.set(nppId.toHexString(), {
    _id: nppId,
    nppInvestmentCashAnchor: 200,
  });
  db.collection("bonds").docs.set(bondA.toHexString(), {
    _id: bondA,
    corporationId: issuerId,
    matured: false,
    defaulted: false,
    marketPrice: 0.9,
    publicFloat: 50,
  });
  db.collection("bonds").docs.set(bondB.toHexString(), {
    _id: bondB,
    corporationId: issuerId,
    matured: false,
    defaulted: true,
    marketPrice: 0.4,
    publicFloat: 0,
  });
}

function holders(): BondPayoffSpendInput["holders"] {
  return [
    { kind: "character", holderId: charId, field: "cashOnHand", amount: 12_000 },
    { kind: "imperial", holderId: imperialId, field: "cashOnHand", amount: 4_000 },
    { kind: "corp", holderId: holderCorpId, field: "liquidCapital", amount: 2_000 },
    { kind: "fund", holderId: fundId, field: "cashAnchor", amount: 3_000 },
    { kind: "npp", holderId: nppId, field: "nppInvestmentCashAnchor", amount: 1_000 },
  ];
}

function payoffInput(overrides: Partial<BondPayoffSpendInput> = {}): BondPayoffSpendInput {
  const holderList = overrides.holders ?? holders();
  return {
    payerCorpId: payerId,
    issuerCorpId: issuerId,
    debitLiquidCapital: DEBIT,
    holders: holderList,
    bonds: [
      { bondId: bondA, priorMarketPrice: 0.9, priorDefaulted: false },
      { bondId: bondB, priorMarketPrice: 0.4, priorDefaulted: true },
    ],
    cureMethod: "parent_payoff",
    onlyDefaulted: false,
    curedAtTurn: 444,
    now: NOW,
    fingerprint: buildBondPayoffFingerprint({
      cureMethod: "parent_payoff",
      payerCorpId: payerId,
      issuerCorpId: issuerId,
      debitLiquidCapital: DEBIT,
      bonds: [bondA, bondB],
      holders: holderList.map((h) => ({ kind: h.kind, holderId: h.holderId, amount: h.amount })),
    }),
    idempotencyKey: `key-${Math.random().toString(36).slice(2)}`,
    ...overrides,
  };
}

function num(db: FakeDb, collection: string, id: ObjectId, field: string): number {
  return db.collection(collection).docs.get(id.toHexString())?.[field] as number;
}

function bondDoc(db: FakeDb, id: ObjectId): Record<string, unknown> {
  return db.collection("bonds").docs.get(id.toHexString())!;
}

function receipt(db: FakeDb, key: string): MoneyFlowReceipt {
  const doc = db.collection(NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION).docs.get(key) as unknown as
    MoneyFlowReceipt | undefined;
  if (!doc) throw new Error(`missing receipt for ${key}`);
  return doc;
}

describe("applyBondPayoffSpend (standalone fallback)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supportMock.mockResolvedValue(false);
  });

  it("pays all five holder kinds once and matures both bonds", async () => {
    const db = new FakeDb();
    seedDb(db);
    const input = payoffInput({ idempotencyKey: "payoff-happy" });

    const result = await applyBondPayoffSpend(db as unknown as Db, input);

    expect(result).toEqual({ duplicate: false });
    expect(num(db, "corporations", payerId, "liquidCapital")).toBe(1_000_000 - DEBIT);
    expect(num(db, "characters", charId, "cashOnHand")).toBe(12_000);
    expect(num(db, "imperialCharacters", imperialId, "cashOnHand")).toBe(4_000);
    expect(num(db, "corporations", holderCorpId, "liquidCapital")).toBe(5_000 + 2_000);
    expect(num(db, "indexFunds", fundId, "cashAnchor")).toBe(100 + 3_000);
    expect(num(db, "npps", nppId, "nppInvestmentCashAnchor")).toBe(200 + 1_000);
    for (const id of [bondA, bondB]) {
      const bond = bondDoc(db, id);
      expect(bond.matured).toBe(true);
      expect(bond.marketPrice).toBe(1);
      expect(bond.defaulted).toBe(false);
      expect(bond.defaultCure).toEqual({ cureMethod: "parent_payoff", curedAtTurn: 444 });
    }
    // The public float is retired with the bond, not paid out to anyone.
    expect(bondDoc(db, bondA).publicFloat).toBe(50);
    expect(receipt(db, "payoff-happy").status).toBe("completed");
  });

  it("retires public-float face with no holder credit", async () => {
    const db = new FakeDb();
    seedDb(db);
    // Float face (50_000) is funded by the payer debit but credited to
    // nobody: the debit covers the whole bond face while holder credits sum
    // only held units.
    const input = payoffInput({ idempotencyKey: "payoff-float" });

    await applyBondPayoffSpend(db as unknown as Db, input);

    const credited =
      num(db, "characters", charId, "cashOnHand") +
      num(db, "imperialCharacters", imperialId, "cashOnHand") +
      (num(db, "corporations", holderCorpId, "liquidCapital") - 5_000) +
      (num(db, "indexFunds", fundId, "cashAnchor") - 100) +
      (num(db, "npps", nppId, "nppInvestmentCashAnchor") - 200);
    expect(credited).toBe(22_000);
    expect(num(db, "corporations", payerId, "liquidCapital")).toBe(1_000_000 - 72_000);
  });

  it("converges after a crash between holder credits", async () => {
    const db = new FakeDb();
    seedDb(db);
    const input = payoffInput({ idempotencyKey: "payoff-crash-holders" });
    // Writes: receipt insert, resume-plan store, payer debit, then one per
    // holder in order. Crash after the debit and the first holder credit
    // landed.
    db.crashAfterWrites = 5;

    await expect(applyBondPayoffSpend(db as unknown as Db, input)).rejects.toThrow(
      "INJECTED_CRASH"
    );
    expect(receipt(db, "payoff-crash-holders").status).toBe("in_progress");
    db.crashAfterWrites = Number.POSITIVE_INFINITY;

    const recovery = await applyBondPayoffSpend(db as unknown as Db, input);
    expect(recovery).toEqual({ duplicate: true });
    expect(num(db, "corporations", payerId, "liquidCapital")).toBe(1_000_000 - DEBIT);
    expect(num(db, "characters", charId, "cashOnHand")).toBe(12_000);
    expect(num(db, "imperialCharacters", imperialId, "cashOnHand")).toBe(4_000);
    expect(num(db, "corporations", holderCorpId, "liquidCapital")).toBe(5_000 + 2_000);
    expect(num(db, "indexFunds", fundId, "cashAnchor")).toBe(100 + 3_000);
    expect(num(db, "npps", nppId, "nppInvestmentCashAnchor")).toBe(200 + 1_000);
    expect(bondDoc(db, bondA).matured).toBe(true);
    expect(bondDoc(db, bondB).matured).toBe(true);
    expect(receipt(db, "payoff-crash-holders").status).toBe("completed");
  });

  it("converges after a crash between the two maturity claims", async () => {
    const db = new FakeDb();
    seedDb(db);
    const input = payoffInput({ idempotencyKey: "payoff-crash-mature" });
    // Writes: receipt insert, resume-plan store, payer debit, five holder
    // credits, then one per bond. Crash after the first bond matured.
    db.crashAfterWrites = 9;

    await expect(applyBondPayoffSpend(db as unknown as Db, input)).rejects.toThrow(
      "INJECTED_CRASH"
    );
    expect(bondDoc(db, bondA).matured).toBe(true);
    expect(bondDoc(db, bondB).matured).toBe(false);
    db.crashAfterWrites = Number.POSITIVE_INFINITY;

    const recovery = await applyBondPayoffSpend(db as unknown as Db, input);
    expect(recovery).toEqual({ duplicate: true });
    expect(bondDoc(db, bondB).matured).toBe(true);
    expect(num(db, "corporations", payerId, "liquidCapital")).toBe(1_000_000 - DEBIT);
    expect(num(db, "characters", charId, "cashOnHand")).toBe(12_000);
    expect(receipt(db, "payoff-crash-mature").status).toBe("completed");
  });

  it("settles failed with no effect when the payer cannot cover the debit", async () => {
    const db = new FakeDb();
    seedDb(db);
    db.collection("corporations").docs.get(payerId.toHexString())!.liquidCapital = 1_000;
    const input = payoffInput({ idempotencyKey: "payoff-funds" });

    await expect(applyBondPayoffSpend(db as unknown as Db, input)).rejects.toThrow(
      `${BOND_PAYOFF_FUNDS}:guard-rejected`
    );
    expect(receipt(db, "payoff-funds").status).toBe("failed");
    expect(num(db, "corporations", payerId, "liquidCapital")).toBe(1_000);
    expect(num(db, "characters", charId, "cashOnHand")).toBe(0);
    expect(bondDoc(db, bondA).matured).toBe(false);
  });

  it("compensates the prefix when a bond loses the maturity race", async () => {
    const db = new FakeDb();
    seedDb(db);
    // Bond B was matured elsewhere (takeover completed, turn settled it)
    // after this attempt's holder snapshot was taken.
    bondDoc(db, bondB).matured = true;
    const input = payoffInput({ idempotencyKey: "payoff-mature-race" });

    await expect(applyBondPayoffSpend(db as unknown as Db, input)).rejects.toThrow(
      `${BOND_PAYOFF_MATURE}:guard-rejected`
    );
    expect(receipt(db, "payoff-mature-race").status).toBe("compensated");
    // Full reversal: payer refunded, every holder un-credited, the applied
    // maturity flag on bond A restored from snapshot.
    expect(num(db, "corporations", payerId, "liquidCapital")).toBe(1_000_000);
    expect(num(db, "characters", charId, "cashOnHand")).toBe(0);
    expect(num(db, "imperialCharacters", imperialId, "cashOnHand")).toBe(0);
    expect(num(db, "corporations", holderCorpId, "liquidCapital")).toBe(5_000);
    expect(num(db, "indexFunds", fundId, "cashAnchor")).toBe(100);
    expect(num(db, "npps", nppId, "nppInvestmentCashAnchor")).toBe(200);
    const restored = bondDoc(db, bondA);
    expect(restored.matured).toBe(false);
    expect(restored.marketPrice).toBe(0.9);
    expect(restored.defaulted).toBe(false);
    expect(restored.defaultCure).toBeUndefined();
  });

  it("compensates when a holder row vanishes mid-flight", async () => {
    const db = new FakeDb();
    seedDb(db);
    db.collection("indexFunds").docs.delete(fundId.toHexString());
    const input = payoffInput({ idempotencyKey: "payoff-holder-gone" });

    await expect(applyBondPayoffSpend(db as unknown as Db, input)).rejects.toThrow(
      `${BOND_PAYOFF_HOLDER}:missing`
    );
    expect(receipt(db, "payoff-holder-gone").status).toBe("compensated");
    expect(num(db, "corporations", payerId, "liquidCapital")).toBe(1_000_000);
    expect(num(db, "characters", charId, "cashOnHand")).toBe(0);
    expect(bondDoc(db, bondA).matured).toBe(false);
  });

  it("settles a zero-holder payoff: debit plus maturity claims only", async () => {
    const db = new FakeDb();
    seedDb(db);
    const holderList: BondPayoffSpendInput["holders"] = [];
    const input = payoffInput({
      idempotencyKey: "payoff-zero-holders",
      holders: holderList,
      fingerprint: buildBondPayoffFingerprint({
        cureMethod: "parent_payoff",
        payerCorpId: payerId,
        issuerCorpId: issuerId,
        debitLiquidCapital: DEBIT,
        bonds: [bondA, bondB],
        holders: [],
      }),
    });

    const result = await applyBondPayoffSpend(db as unknown as Db, input);

    expect(result).toEqual({ duplicate: false });
    expect(num(db, "corporations", payerId, "liquidCapital")).toBe(1_000_000 - DEBIT);
    expect(bondDoc(db, bondA).matured).toBe(true);
    expect(bondDoc(db, bondB).matured).toBe(true);
    expect(receipt(db, "payoff-zero-holders").status).toBe("completed");
  });

  it("pays a holder that is also the payer without skipping either leg", async () => {
    const db = new FakeDb();
    seedDb(db);
    // The parent holds some of the target's bonds: the payer debit and the
    // corp credit land on the SAME document. Per-step sub-keys keep both from
    // colliding (one shared key would trip the second leg's $ne guard and
    // silently skip the credit).
    const holderList: BondPayoffSpendInput["holders"] = [
      { kind: "corp", holderId: payerId, field: "liquidCapital", amount: 2_000 },
    ];
    const input = payoffInput({
      idempotencyKey: "payoff-self-holder",
      debitLiquidCapital: 52_000,
      holders: holderList,
      bonds: [{ bondId: bondA, priorMarketPrice: 0.9, priorDefaulted: false }],
      fingerprint: buildBondPayoffFingerprint({
        cureMethod: "parent_payoff",
        payerCorpId: payerId,
        issuerCorpId: issuerId,
        debitLiquidCapital: 52_000,
        bonds: [bondA],
        holders: [{ kind: "corp", holderId: payerId, amount: 2_000 }],
      }),
    });

    await applyBondPayoffSpend(db as unknown as Db, input);

    expect(num(db, "corporations", payerId, "liquidCapital")).toBe(1_000_000 - 52_000 + 2_000);
    expect(bondDoc(db, bondA).matured).toBe(true);
  });

  it("draws the escrow slice atomically with the liquid debit", async () => {
    const db = new FakeDb();
    seedDb(db);
    const input = payoffInput({
      idempotencyKey: "payoff-escrow",
      debitLiquidCapital: 60_000,
      debitEscrow: 12_000,
      fingerprint: buildBondPayoffFingerprint({
        cureMethod: "cash",
        payerCorpId: payerId,
        issuerCorpId: payerId,
        debitLiquidCapital: 60_000,
        debitEscrow: 12_000,
        bonds: [bondA, bondB],
        holders: holders().map((h) => ({
          kind: h.kind,
          holderId: h.holderId,
          amount: h.amount,
        })),
      }),
    });

    await applyBondPayoffSpend(db as unknown as Db, input);

    expect(num(db, "corporations", payerId, "liquidCapital")).toBe(1_000_000 - 60_000);
    expect(num(db, "corporations", payerId, "shareEscrowBalance")).toBe(50_000 - 12_000);
    expect(receipt(db, "payoff-escrow").status).toBe("completed");
  });

  it("rejects the debit when the escrow slice is short", async () => {
    const db = new FakeDb();
    seedDb(db);
    db.collection("corporations").docs.get(payerId.toHexString())!.shareEscrowBalance = 100;
    const input = payoffInput({
      idempotencyKey: "payoff-escrow-short",
      debitLiquidCapital: 60_000,
      debitEscrow: 12_000,
      fingerprint: buildBondPayoffFingerprint({
        cureMethod: "cash",
        payerCorpId: payerId,
        issuerCorpId: payerId,
        debitLiquidCapital: 60_000,
        debitEscrow: 12_000,
        bonds: [bondA, bondB],
        holders: holders().map((h) => ({
          kind: h.kind,
          holderId: h.holderId,
          amount: h.amount,
        })),
      }),
    });

    await expect(applyBondPayoffSpend(db as unknown as Db, input)).rejects.toThrow(
      BOND_PAYOFF_FUNDS
    );
    expect(receipt(db, "payoff-escrow-short").status).toBe("failed");
    expect(num(db, "corporations", payerId, "liquidCapital")).toBe(1_000_000);
    expect(num(db, "characters", charId, "cashOnHand")).toBe(0);
  });

  it("rejects a key reused for a different payoff", async () => {
    const db = new FakeDb();
    seedDb(db);
    await applyBondPayoffSpend(
      db as unknown as Db,
      payoffInput({ idempotencyKey: "payoff-conflict" })
    );

    await expect(
      applyBondPayoffSpend(
        db as unknown as Db,
        payoffInput({ idempotencyKey: "payoff-conflict", fingerprint: "bond-payoff:other" })
      )
    ).rejects.toBeInstanceOf(MoneyFlowKeyConflictError);
    expect(num(db, "corporations", payerId, "liquidCapital")).toBe(1_000_000 - DEBIT);
  });

  it("fails closed on a settled terminal key: a retry needs a new key", async () => {
    const db = new FakeDb();
    seedDb(db);
    db.collection("corporations").docs.get(payerId.toHexString())!.liquidCapital = 1_000;
    const input = payoffInput({ idempotencyKey: "payoff-terminal" });

    await expect(applyBondPayoffSpend(db as unknown as Db, input)).rejects.toThrow(
      BOND_PAYOFF_FUNDS
    );
    expect(receipt(db, "payoff-terminal").status).toBe("failed");
    await expect(applyBondPayoffSpend(db as unknown as Db, input)).rejects.toBeInstanceOf(
      MoneyFlowTerminalError
    );
    expect(num(db, "corporations", payerId, "liquidCapital")).toBe(1_000);
  });

  it("replays a completed key without moving money again", async () => {
    const db = new FakeDb();
    seedDb(db);
    const input = payoffInput({ idempotencyKey: "payoff-replay" });

    await applyBondPayoffSpend(db as unknown as Db, input);
    const replay = await applyBondPayoffSpend(db as unknown as Db, input);

    expect(replay).toEqual({ duplicate: true });
    expect(num(db, "corporations", payerId, "liquidCapital")).toBe(1_000_000 - DEBIT);
    expect(num(db, "characters", charId, "cashOnHand")).toBe(12_000);
  });

  it("resumes under the same key when the retry presents the post-crash remainder", async () => {
    // The route-realistic retry: after bond A matured and the process died,
    // the route rebuilds from live state (bond B only, a smaller debit, a
    // smaller fingerprint). The old scheme rejected this with a key conflict
    // and stranded the receipt; the stored plan resumes it instead.
    const db = new FakeDb();
    seedDb(db);
    const key = "payoff-resume-remainder";
    db.crashAfterWrites = 9;

    await expect(
      applyBondPayoffSpend(db as unknown as Db, payoffInput({ idempotencyKey: key }))
    ).rejects.toThrow("INJECTED_CRASH");
    expect(bondDoc(db, bondA).matured).toBe(true);
    expect(bondDoc(db, bondB).matured).toBe(false);
    expect(receipt(db, key).status).toBe("in_progress");
    db.crashAfterWrites = Number.POSITIVE_INFINITY;

    const remainderHolders: BondPayoffSpendInput["holders"] = [
      { kind: "npp", holderId: nppId, field: "nppInvestmentCashAnchor", amount: 1_000 },
    ];
    const retry = payoffInput({
      idempotencyKey: key,
      debitLiquidCapital: 5_000,
      holders: remainderHolders,
      bonds: [{ bondId: bondB, priorMarketPrice: 0.4, priorDefaulted: true }],
      fingerprint: buildBondPayoffFingerprint({
        cureMethod: "parent_payoff",
        payerCorpId: payerId,
        issuerCorpId: issuerId,
        debitLiquidCapital: 5_000,
        bonds: [bondB],
        holders: remainderHolders.map((h) => ({
          kind: h.kind,
          holderId: h.holderId,
          amount: h.amount,
        })),
      }),
    });

    const recovery = await applyBondPayoffSpend(db as unknown as Db, retry);
    expect(recovery).toEqual({ duplicate: true });
    // Exactly once at the STORED amounts: the full debit landed in the
    // crashed attempt and is skipped, not re-applied at the remainder size.
    expect(num(db, "corporations", payerId, "liquidCapital")).toBe(1_000_000 - DEBIT);
    expect(num(db, "characters", charId, "cashOnHand")).toBe(12_000);
    expect(num(db, "npps", nppId, "nppInvestmentCashAnchor")).toBe(200 + 1_000);
    expect(bondDoc(db, bondA).matured).toBe(true);
    expect(bondDoc(db, bondB).matured).toBe(true);
    expect(receipt(db, key).status).toBe("completed");
  });

  it("keeps a key conflict for a genuinely different payoff over an in-flight attempt", async () => {
    const db = new FakeDb();
    seedDb(db);
    const key = "payoff-resume-conflict";
    db.crashAfterWrites = 5;

    await expect(
      applyBondPayoffSpend(db as unknown as Db, payoffInput({ idempotencyKey: key }))
    ).rejects.toThrow("INJECTED_CRASH");
    expect(receipt(db, key).status).toBe("in_progress");
    db.crashAfterWrites = Number.POSITIVE_INFINITY;

    // Same key, but a different payer and an unknown bond: not a remainder of
    // the stored attempt, so the conflict stands and nothing further moves.
    const otherPayer = new ObjectId();
    db.collection("corporations").docs.set(otherPayer.toHexString(), {
      _id: otherPayer,
      liquidCapital: 1_000_000,
    });
    const otherBond = new ObjectId();
    const conflicting = payoffInput({
      idempotencyKey: key,
      payerCorpId: otherPayer,
      bonds: [{ bondId: otherBond, priorMarketPrice: 1, priorDefaulted: false }],
      fingerprint: buildBondPayoffFingerprint({
        cureMethod: "parent_payoff",
        payerCorpId: otherPayer,
        issuerCorpId: issuerId,
        debitLiquidCapital: DEBIT,
        bonds: [otherBond],
        holders: holders().map((h) => ({
          kind: h.kind,
          holderId: h.holderId,
          amount: h.amount,
        })),
      }),
    });

    await expect(applyBondPayoffSpend(db as unknown as Db, conflicting)).rejects.toBeInstanceOf(
      MoneyFlowKeyConflictError
    );
    expect(receipt(db, key).status).toBe("in_progress");
    expect(num(db, "corporations", otherPayer, "liquidCapital")).toBe(1_000_000);
    expect(num(db, "corporations", payerId, "liquidCapital")).toBe(1_000_000 - DEBIT);
  });

  it("compensates a resumed attempt at the stored amounts, not the remainder", async () => {
    // Crash after the full debit landed, then a holder row vanishes before
    // the same-key retry. The resume runs the STORED plan, so its failure
    // reverses the full debit — a remainder-sized reversal would strand the
    // difference on the payer.
    const db = new FakeDb();
    seedDb(db);
    const key = "payoff-resume-compensate";
    db.crashAfterWrites = 3;

    await expect(
      applyBondPayoffSpend(db as unknown as Db, payoffInput({ idempotencyKey: key }))
    ).rejects.toThrow("INJECTED_CRASH");
    db.crashAfterWrites = Number.POSITIVE_INFINITY;
    db.collection("indexFunds").docs.delete(fundId.toHexString());

    const retry = payoffInput({
      idempotencyKey: key,
      debitLiquidCapital: 5_000,
      holders: [{ kind: "character", holderId: charId, field: "cashOnHand", amount: 12_000 }],
      bonds: [{ bondId: bondB, priorMarketPrice: 0.4, priorDefaulted: true }],
      fingerprint: buildBondPayoffFingerprint({
        cureMethod: "parent_payoff",
        payerCorpId: payerId,
        issuerCorpId: issuerId,
        debitLiquidCapital: 5_000,
        bonds: [bondB],
        holders: [{ kind: "character", holderId: charId, amount: 12_000 }],
      }),
    });

    await expect(applyBondPayoffSpend(db as unknown as Db, retry)).rejects.toThrow(
      `${BOND_PAYOFF_HOLDER}:missing`
    );
    expect(receipt(db, key).status).toBe("compensated");
    expect(num(db, "corporations", payerId, "liquidCapital")).toBe(1_000_000);
    expect(num(db, "characters", charId, "cashOnHand")).toBe(0);
    expect(bondDoc(db, bondA).matured).toBe(false);
    expect(bondDoc(db, bondB).matured).toBe(false);
  });

  it("reconciles live input when the crash predates the plan write", async () => {
    // Crash between the claim insert and the resume-plan write: nothing
    // applied yet, so the retry adopts the stored fingerprint and runs its
    // live input to completion instead of stranding the receipt.
    const db = new FakeDb();
    seedDb(db);
    const key = "payoff-no-plan";
    db.collection(NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION).docs.set(key, {
      _id: key,
      status: "in_progress",
      fingerprint: "bond-payoff:original-attempt",
      createdAt: NOW,
      updatedAt: NOW,
    });

    const result = await applyBondPayoffSpend(
      db as unknown as Db,
      payoffInput({ idempotencyKey: key })
    );

    expect(result).toEqual({ duplicate: true });
    expect(num(db, "corporations", payerId, "liquidCapital")).toBe(1_000_000 - DEBIT);
    expect(num(db, "characters", charId, "cashOnHand")).toBe(12_000);
    expect(bondDoc(db, bondA).matured).toBe(true);
    expect(bondDoc(db, bondB).matured).toBe(true);
    expect(receipt(db, key).status).toBe("completed");
  });
});

describe("isBondPayoffOutcome (persisted outcome schema)", () => {
  it("accepts a complete outcome and rejects malformed ones", () => {
    expect(isBondPayoffOutcome({ paid: 22_000, bondsMatured: 2 })).toBe(true);
    expect(isBondPayoffOutcome(undefined)).toBe(false);
    expect(isBondPayoffOutcome(null)).toBe(false);
    expect(isBondPayoffOutcome({})).toBe(false);
    // Missing or mistyped fields are unusable: the caller must keep its
    // public no-bonds result rather than report corrupt numbers.
    expect(isBondPayoffOutcome({ paid: 22_000 })).toBe(false);
    expect(isBondPayoffOutcome({ paid: "22000", bondsMatured: 2 })).toBe(false);
  });
});

const PAYOFF_OUTCOME = { paid: 22_000, bondsMatured: 2 };

describe("resumeBondPayoffByKey (empty-remainder recovery)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supportMock.mockResolvedValue(false);
  });

  it("recovers a crash after the final maturity claim: settles the receipt and reports the stored outcome", async () => {
    const db = new FakeDb();
    seedDb(db);
    const key = "payoff-resume-final-cure";
    // Writes: claim, plan, payer debit, 5 holder credits, mature A, mature
    // B, then the receipt completion — crashing on completion leaves every
    // bond matured with an in_progress receipt and no live bond set to
    // rebuild input from.
    db.crashAfterWrites = 10;
    await expect(
      applyBondPayoffSpend(
        db as unknown as Db,
        payoffInput({ idempotencyKey: key, outcome: { ...PAYOFF_OUTCOME } })
      )
    ).rejects.toThrow("INJECTED_CRASH");
    expect(receipt(db, key).status).toBe("in_progress");
    expect(bondDoc(db, bondA).matured).toBe(true);
    expect(bondDoc(db, bondB).matured).toBe(true);

    db.crashAfterWrites = Number.POSITIVE_INFINITY;
    db.writeCount = 0;
    const resumed = await resumeBondPayoffByKey(db as unknown as Db, key, payerId, issuerId);

    expect(resumed).toEqual({ outcome: PAYOFF_OUTCOME });
    // No duplicate payout on recovery: every holder credited exactly once.
    expect(num(db, "corporations", payerId, "liquidCapital")).toBe(1_000_000 - DEBIT);
    expect(num(db, "characters", charId, "cashOnHand")).toBe(12_000);
    expect(num(db, "indexFunds", fundId, "cashAnchor")).toBe(100 + 3_000);
    expect(receipt(db, key).status).toBe("completed");
  });

  it("converges on the same key after recovery without paying again", async () => {
    const db = new FakeDb();
    seedDb(db);
    const key = "payoff-resume-converge";
    db.crashAfterWrites = 10;
    await expect(
      applyBondPayoffSpend(
        db as unknown as Db,
        payoffInput({ idempotencyKey: key, outcome: { ...PAYOFF_OUTCOME } })
      )
    ).rejects.toThrow("INJECTED_CRASH");

    db.crashAfterWrites = Number.POSITIVE_INFINITY;
    db.writeCount = 0;
    await resumeBondPayoffByKey(db as unknown as Db, key, payerId, issuerId);

    const retry = await applyBondPayoffSpend(
      db as unknown as Db,
      payoffInput({ idempotencyKey: key, outcome: { ...PAYOFF_OUTCOME } })
    );
    expect(retry).toEqual({ duplicate: true });
    expect(num(db, "characters", charId, "cashOnHand")).toBe(12_000);
  });

  it("returns null when no receipt exists, so the caller keeps its public result", async () => {
    const db = new FakeDb();
    seedDb(db);
    await expect(
      resumeBondPayoffByKey(db as unknown as Db, "payoff-absent", payerId, issuerId)
    ).resolves.toBeNull();
  });

  it("returns null for a completed receipt: genuinely finished work stays historical", async () => {
    const db = new FakeDb();
    seedDb(db);
    const key = "payoff-resume-completed";
    await applyBondPayoffSpend(
      db as unknown as Db,
      payoffInput({ idempotencyKey: key, outcome: { ...PAYOFF_OUTCOME } })
    );
    await expect(
      resumeBondPayoffByKey(db as unknown as Db, key, payerId, issuerId)
    ).resolves.toBeNull();
  });

  it("returns null for an in-progress receipt with no usable plan or outcome", async () => {
    // Crash on the plan write: the claim landed but nothing applied yet.
    const db = new FakeDb();
    seedDb(db);
    const key = "payoff-resume-noplan";
    db.crashAfterWrites = 1;
    await expect(
      applyBondPayoffSpend(db as unknown as Db, payoffInput({ idempotencyKey: key }))
    ).rejects.toThrow("INJECTED_CRASH");
    await expect(
      resumeBondPayoffByKey(db as unknown as Db, key, payerId, issuerId)
    ).resolves.toBeNull();

    // A stored plan without a persisted outcome cannot report an attempt.
    const db2 = new FakeDb();
    seedDb(db2);
    const key2 = "payoff-resume-nooutcome";
    db2.crashAfterWrites = 9;
    await expect(
      applyBondPayoffSpend(db2 as unknown as Db, payoffInput({ idempotencyKey: key2 }))
    ).rejects.toThrow("INJECTED_CRASH");
    await expect(
      resumeBondPayoffByKey(db2 as unknown as Db, key2, payerId, issuerId)
    ).resolves.toBeNull();
  });

  it("throws terminal for a settled failed receipt", async () => {
    const db = new FakeDb();
    seedDb(db);
    // The payer cannot cover the debit: the receipt settles failed with no
    // effect, so a retry needs a new key.
    db.collection("corporations").docs.get(payerId.toHexString())!.liquidCapital = 1;
    const key = "payoff-resume-terminal";
    await expect(
      applyBondPayoffSpend(db as unknown as Db, payoffInput({ idempotencyKey: key }))
    ).rejects.toThrow(new RegExp(`^${BOND_PAYOFF_FUNDS}`));
    await expect(
      resumeBondPayoffByKey(db as unknown as Db, key, payerId, issuerId)
    ).rejects.toBeInstanceOf(MoneyFlowTerminalError);
  });

  it("throws conflict when the stored attempt names a different payer or issuer", async () => {
    const db = new FakeDb();
    seedDb(db);
    const key = "payoff-resume-mismatch";
    db.crashAfterWrites = 9;
    await expect(
      applyBondPayoffSpend(
        db as unknown as Db,
        payoffInput({ idempotencyKey: key, outcome: { ...PAYOFF_OUTCOME } })
      )
    ).rejects.toThrow("INJECTED_CRASH");
    await expect(
      resumeBondPayoffByKey(db as unknown as Db, key, new ObjectId(), issuerId)
    ).rejects.toBeInstanceOf(MoneyFlowKeyConflictError);
    await expect(
      resumeBondPayoffByKey(db as unknown as Db, key, payerId, new ObjectId())
    ).rejects.toBeInstanceOf(MoneyFlowKeyConflictError);

    // The mismatch also holds on a completed receipt (fail closed on
    // cross-corp key reuse even after settlement).
    const db2 = new FakeDb();
    seedDb(db2);
    const key2 = "payoff-resume-completed-mismatch";
    await applyBondPayoffSpend(
      db2 as unknown as Db,
      payoffInput({ idempotencyKey: key2, outcome: { ...PAYOFF_OUTCOME } })
    );
    await expect(
      resumeBondPayoffByKey(db2 as unknown as Db, key2, new ObjectId(), issuerId)
    ).rejects.toBeInstanceOf(MoneyFlowKeyConflictError);
  });
});
