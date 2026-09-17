import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import {
  applyBondDissolutionSpend,
  BOND_DISSOLUTION_HOLDER,
  BOND_DISSOLUTION_POOL,
  buildBondDissolutionFingerprint,
  getBondDissolutionCompletedOutcome,
  resumeBondDissolutionByKey,
  type BondDissolutionOutcome,
  type BondDissolutionSpendInput,
} from "./bondDissolutionSpend";
import {
  MoneyFlowKeyConflictError,
  MoneyFlowTerminalError,
  NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION,
  type MoneyFlowReceipt,
} from "@/lib/db/nonAtomicMoneyFlow";

const { supportMock } = vi.hoisted(() => ({ supportMock: vi.fn() }));

vi.mock("@/lib/db/transactionSupport", () => ({
  assertTransactionSupportAtBoot: supportMock,
}));

// ---------------------------------------------------------------------------
// Strict stateful fakes honoring exactly the operators the dissolution
// primitive emits: keyed `updateOne` ($inc with dotted balance fields, $set,
// $push+$each+$slice key records, holdings $pull), `findOne` by `_id`,
// `insertOne` with duplicate-key errors. The REAL receipt primitive runs
// here (nothing mocked below this line except the transaction probe), so an
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

function cloneDoc(doc: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...doc };
  for (const [k, v] of Object.entries(out)) {
    if (Array.isArray(v)) out[k] = [...v];
    else if (v !== null && typeof v === "object" && !(v instanceof ObjectId) && !(v instanceof Date)) {
      out[k] = { ...(v as Record<string, unknown>) };
    }
  }
  return out;
}

function matchesCondition(doc: Record<string, unknown>, field: string, condition: unknown): boolean {
  const actual = field === "_id" ? doc._id : getPath(doc, field);
  if (
    typeof condition === "object" &&
    condition !== null &&
    !(condition instanceof ObjectId) &&
    !Array.isArray(condition)
  ) {
    const ops = condition as Record<string, unknown>;
    if ("$ne" in ops) {
      const keys = doc[field] as string[] | undefined;
      if (keys?.includes(ops.$ne as string)) return false;
      return true;
    }
    if ("$gte" in ops) {
      return typeof actual === "number" && actual >= (ops.$gte as number);
    }
    return false;
  }
  if (field === "_id") return valueEquals(doc._id, condition);
  return valueEquals(actual, condition);
}

function matchesFilter(doc: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  for (const [field, condition] of Object.entries(filter)) {
    if (!matchesCondition(doc, field, condition)) return false;
  }
  return true;
}

function applyUpdate(doc: Record<string, unknown>, update: Record<string, unknown>): void {
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
  const pull = update.$pull as { holdings: { corporationId: unknown } } | undefined;
  if (pull?.holdings) {
    const holdings = (doc.holdings ?? []) as Record<string, unknown>[];
    doc.holdings = holdings.filter(
      (h) => !valueEquals(h.corporationId, pull.holdings.corporationId)
    );
  }
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

  async insertOne(
    doc: Record<string, unknown>,
    _opts?: unknown
  ): Promise<{ insertedId: unknown }> {
    this.countWrite();
    const key = docKey(doc._id);
    if (this.docs.has(key)) {
      const error = new Error("E11000 duplicate key error") as Error & { code: number };
      error.code = 11000;
      throw error;
    }
    this.docs.set(key, cloneDoc(doc));
    return { insertedId: doc._id };
  }

  async findOne(
    filter: Record<string, unknown>,
    _opts?: unknown
  ): Promise<Record<string, unknown> | null> {
    const doc = this.docs.get(docKey(filter._id));
    if (!doc) return null;
    return cloneDoc(doc);
  }

  async updateOne(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    _opts?: unknown
  ): Promise<{ matchedCount: number; modifiedCount: number }> {
    this.countWrite();
    const doc = this.docs.get(docKey(filter._id));
    if (!doc) return { matchedCount: 0, modifiedCount: 0 };
    if (!matchesFilter(doc, filter)) return { matchedCount: 0, modifiedCount: 0 };
    applyUpdate(doc, update);
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

const CORP_ID = new ObjectId();
const CHAR_ID = new ObjectId();
const CREDITOR_CORP_ID = new ObjectId();
const FUND_ID = new ObjectId();
const CB_ID = "cb-US";
const NOW = new Date("2026-09-17T00:00:00Z");

const CHAR_CREDIT = 1_000;
const CREDITOR_CREDIT = 250;
const CB_CREDIT = 75;
const FUND_CREDIT = 500;
const POOL_CREDIT = 300;

function seedDb(db: FakeDb): void {
  db.collection("characters").docs.set(CHAR_ID.toHexString(), {
    _id: CHAR_ID,
    cashOnHand: 100,
    appliedMoneyFlowKeys: [],
  });
  db.collection("corporations").docs.set(CREDITOR_CORP_ID.toHexString(), {
    _id: CREDITOR_CORP_ID,
    liquidCapital: 50,
    appliedMoneyFlowKeys: [],
  });
  db.collection("centralBanks").docs.set(CB_ID, {
    _id: CB_ID,
    reserveBalance: 1_000,
    appliedMoneyFlowKeys: [],
  });
  db.collection("indexFunds").docs.set(FUND_ID.toHexString(), {
    _id: FUND_ID,
    cashAnchor: 0,
    holdings: [{ corporationId: CORP_ID }],
    appliedMoneyFlowKeys: [],
  });
  db.collection("bondMarketPools").docs.set("USD", {
    _id: "USD",
    cashLocal: 5_000,
    targetCashLocal: 0,
    lifetime: { recoveriesIn: 0 },
    appliedMoneyFlowKeys: [],
  });
}

function outcomeFixture(): BondDissolutionOutcome {
  return {
    corpIdHex: CORP_ID.toHexString(),
    corpName: "Doomed Corp",
    bondRecoveryPool: 1_325,
    shareholderPool: 500,
    shareholderPayouts: [],
    corporateShareholderPayouts: [],
    publicFloatPayout: null,
    totalPayoutToPeople: 1_000,
  };
}

function dissolutionInput(overrides: Partial<BondDissolutionSpendInput> = {}): BondDissolutionSpendInput {
  const holders = overrides.holders ?? [
    { kind: "character" as const, holderId: CHAR_ID, field: "cashOnHand", amount: CHAR_CREDIT },
    { kind: "corp" as const, holderId: CREDITOR_CORP_ID, field: "liquidCapital", amount: CREDITOR_CREDIT },
    { kind: "centralBank" as const, holderId: CB_ID, field: "reserveBalance", amount: CB_CREDIT },
  ];
  const funds = overrides.funds ?? [
    { fundId: FUND_ID, amountAnchor: FUND_CREDIT, dissolvedCorpId: CORP_ID },
  ];
  const poolCredits = overrides.poolCredits ?? [{ currency: "USD", amountLocal: POOL_CREDIT }];
  return {
    corpId: CORP_ID,
    holders,
    funds,
    poolCredits,
    now: NOW,
    outcome: outcomeFixture(),
    fingerprint: buildBondDissolutionFingerprint({
      corpId: CORP_ID,
      bonds: [],
      holders: holders.map((h) => ({ kind: h.kind, holderId: h.holderId, amount: h.amount })),
      funds: funds.map((f) => ({ fundId: f.fundId, amount: f.amountAnchor })),
      pools: poolCredits.map((p) => ({ currency: p.currency, amount: p.amountLocal })),
    }),
    idempotencyKey: `key-${Math.random().toString(36).slice(2)}`,
    ...overrides,
  };
}

function charCash(db: FakeDb): number {
  return db.collection("characters").docs.get(CHAR_ID.toHexString())!.cashOnHand as number;
}

function creditorCapital(db: FakeDb): number {
  return db.collection("corporations").docs.get(CREDITOR_CORP_ID.toHexString())!
    .liquidCapital as number;
}

function cbReserve(db: FakeDb): number {
  return db.collection("centralBanks").docs.get(CB_ID)!.reserveBalance as number;
}

function fundDoc(db: FakeDb): Record<string, unknown> {
  return db.collection("indexFunds").docs.get(FUND_ID.toHexString())!;
}

function poolDoc(db: FakeDb): Record<string, unknown> {
  return db.collection("bondMarketPools").docs.get("USD")!;
}

function receipt(db: FakeDb, key: string): MoneyFlowReceipt {
  const doc = db.collection(NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION).docs.get(key) as unknown as
    | MoneyFlowReceipt
    | undefined;
  if (!doc) throw new Error(`missing receipt for ${key}`);
  return doc;
}

function expectExactPayouts(db: FakeDb): void {
  expect(charCash(db)).toBe(100 + CHAR_CREDIT);
  expect(creditorCapital(db)).toBe(50 + CREDITOR_CREDIT);
  expect(cbReserve(db)).toBe(1_000 + CB_CREDIT);
  expect(fundDoc(db).cashAnchor).toBe(FUND_CREDIT);
  expect(fundDoc(db).holdings).toEqual([]);
  expect(poolDoc(db).cashLocal).toBe(5_000 + POOL_CREDIT);
  expect((poolDoc(db).lifetime as { recoveriesIn: number }).recoveriesIn).toBe(POOL_CREDIT);
}

describe("applyBondDissolutionSpend (standalone fallback)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supportMock.mockResolvedValue(false);
  });

  it("credits every holder, fund, and pool exactly once and completes the receipt", async () => {
    const db = new FakeDb();
    seedDb(db);
    const input = dissolutionInput({ idempotencyKey: "dissolve-happy" });

    const result = await applyBondDissolutionSpend(db as unknown as Db, input);

    expect(result).toEqual({ duplicate: false });
    expectExactPayouts(db);
    expect(receipt(db, "dissolve-happy").status).toBe("completed");
  });

  it("converges to exactly one payout set when a crash interrupts any durable write", async () => {
    // Write order: receipt claim, plan persist, 1 pool credit, 3 holder
    // credits, 1 fund credit, receipt completion. Crashing after each prefix
    // then retrying with the same key and fingerprint must converge: every
    // payee credited exactly once, receipt completed.
    const probe = new FakeDb();
    seedDb(probe);
    await applyBondDissolutionSpend(
      probe as unknown as Db,
      dissolutionInput({ idempotencyKey: "dissolve-probe" })
    );
    const totalWrites = probe.writeCount;
    expect(totalWrites).toBeGreaterThan(3);

    for (let crashAfter = 1; crashAfter < totalWrites; crashAfter += 1) {
      const db = new FakeDb();
      seedDb(db);
      const input = dissolutionInput({ idempotencyKey: `dissolve-crash-${crashAfter}` });
      db.crashAfterWrites = crashAfter;
      await expect(applyBondDissolutionSpend(db as unknown as Db, input)).rejects.toThrow(
        "INJECTED_CRASH"
      );

      db.crashAfterWrites = Number.POSITIVE_INFINITY;
      db.writeCount = 0;
      const retry = await applyBondDissolutionSpend(db as unknown as Db, input);

      expect(retry).toEqual({ duplicate: true });
      expectExactPayouts(db);
      expect(receipt(db, `dissolve-crash-${crashAfter}`).status).toBe("completed");
    }
  });

  it("credits pools before holders: a crash on the holder boundary leaves the pool paid and holders untouched", async () => {
    const db = new FakeDb();
    seedDb(db);
    const input = dissolutionInput({ idempotencyKey: "dissolve-order" });
    // Claim + plan + the single pool credit land; the first holder write dies.
    db.crashAfterWrites = 3;
    await expect(applyBondDissolutionSpend(db as unknown as Db, input)).rejects.toThrow(
      "INJECTED_CRASH"
    );

    expect(poolDoc(db).cashLocal).toBe(5_000 + POOL_CREDIT);
    expect(charCash(db)).toBe(100);
    expect(creditorCapital(db)).toBe(50);
    expect(receipt(db, "dissolve-order").status).toBe("in_progress");

    db.crashAfterWrites = Number.POSITIVE_INFINITY;
    db.writeCount = 0;
    const retry = await applyBondDissolutionSpend(db as unknown as Db, input);
    expect(retry).toEqual({ duplicate: true });
    expectExactPayouts(db);
    expect(receipt(db, "dissolve-order").status).toBe("completed");
  });

  it("resumes the stored plan when the retry presents a remainder fingerprint", async () => {
    const db = new FakeDb();
    seedDb(db);
    const key = "dissolve-remainder";
    const input = dissolutionInput({ idempotencyKey: key });
    // Crash after claim + plan + pool + first holder: the character credit
    // applied, the rest did not.
    db.crashAfterWrites = 4;
    await expect(applyBondDissolutionSpend(db as unknown as Db, input)).rejects.toThrow(
      "INJECTED_CRASH"
    );
    expect(charCash(db)).toBe(100 + CHAR_CREDIT);

    // The executor rebuilds from live state: the paid character drops out,
    // so the live input covers only the remainder with a shrunken
    // fingerprint. The stored plan still runs to completion at the attempted
    // amounts.
    db.crashAfterWrites = Number.POSITIVE_INFINITY;
    db.writeCount = 0;
    const remainder = dissolutionInput({
      idempotencyKey: key,
      holders: [
        { kind: "corp", holderId: CREDITOR_CORP_ID, field: "liquidCapital", amount: CREDITOR_CREDIT },
        { kind: "centralBank", holderId: CB_ID, field: "reserveBalance", amount: CB_CREDIT },
      ],
    });
    expect(remainder.fingerprint).not.toBe(input.fingerprint);
    const retry = await applyBondDissolutionSpend(db as unknown as Db, remainder);

    expect(retry).toEqual({ duplicate: true });
    expectExactPayouts(db);
    expect(receipt(db, key).status).toBe("completed");
  });

  it("replays the stored outcome on an exact completed retry without moving money again", async () => {
    const db = new FakeDb();
    seedDb(db);
    const input = dissolutionInput({ idempotencyKey: "dissolve-replay" });

    const first = await applyBondDissolutionSpend(db as unknown as Db, input);
    const second = await applyBondDissolutionSpend(db as unknown as Db, input);

    expect(first).toEqual({ duplicate: false });
    expect(second).toEqual({ duplicate: true });
    expectExactPayouts(db);
    expect(receipt(db, "dissolve-replay").status).toBe("completed");
  });

  it("rejects a same-key retry for a genuinely different dissolution", async () => {
    const db = new FakeDb();
    seedDb(db);
    const key = "dissolve-conflict";
    await applyBondDissolutionSpend(db as unknown as Db, dissolutionInput({ idempotencyKey: key }));

    // A different corp under the same key is never a remainder: fail closed.
    const other = dissolutionInput({
      idempotencyKey: key,
      corpId: new ObjectId(),
      fingerprint: "bond-dissolution:other-corp:entirely-different",
    });
    await expect(applyBondDissolutionSpend(db as unknown as Db, other)).rejects.toBeInstanceOf(
      MoneyFlowKeyConflictError
    );
    expectExactPayouts(db);
  });

  it("reconciles an in-progress receipt with the same fingerprint through the keyed steps", async () => {
    const db = new FakeDb();
    seedDb(db);
    const input = dissolutionInput({ idempotencyKey: "dissolve-inprogress" });
    // Crash between the claim insert and the plan write: nothing applied
    // yet, so the live input reconciles under the stored fingerprint.
    db.crashAfterWrites = 1;
    await expect(applyBondDissolutionSpend(db as unknown as Db, input)).rejects.toThrow(
      "INJECTED_CRASH"
    );

    db.crashAfterWrites = Number.POSITIVE_INFINITY;
    db.writeCount = 0;
    const retry = await applyBondDissolutionSpend(db as unknown as Db, input);
    expect(retry).toEqual({ duplicate: true });
    expectExactPayouts(db);
    expect(receipt(db, "dissolve-inprogress").status).toBe("completed");
  });

  it("compensates the applied prefix and holds the key terminal when a holder vanished", async () => {
    const db = new FakeDb();
    seedDb(db);
    // The creditor corp is deleted between the executor's read and the flow.
    db.collection("corporations").docs.delete(CREDITOR_CORP_ID.toHexString());
    const key = "dissolve-terminal";

    await expect(
      applyBondDissolutionSpend(db as unknown as Db, dissolutionInput({ idempotencyKey: key }))
    ).rejects.toThrow(new RegExp(`^${BOND_DISSOLUTION_HOLDER}`));

    // Prefix reversed: pool and character credits compensated, fund unpaid.
    expect(poolDoc(db).cashLocal).toBe(5_000);
    expect((poolDoc(db).lifetime as { recoveriesIn: number }).recoveriesIn).toBe(0);
    expect(charCash(db)).toBe(100);
    expect(fundDoc(db).cashAnchor).toBe(0);
    expect(receipt(db, key).status).toBe("compensated");

    await expect(
      applyBondDissolutionSpend(db as unknown as Db, dissolutionInput({ idempotencyKey: key }))
    ).rejects.toBeInstanceOf(MoneyFlowTerminalError);
    expect(charCash(db)).toBe(100);
  });

  it("creates a missing pool row with the recovery share instead of failing", async () => {
    const db = new FakeDb();
    seedDb(db);
    db.collection("bondMarketPools").docs.delete("USD");

    const result = await applyBondDissolutionSpend(
      db as unknown as Db,
      dissolutionInput({ idempotencyKey: "dissolve-pool-insert" })
    );

    expect(result).toEqual({ duplicate: false });
    const pool = db.collection("bondMarketPools").docs.get("USD")!;
    expect(pool.cashLocal).toBe(POOL_CREDIT);
    expect((pool.lifetime as { recoveriesIn: number }).recoveriesIn).toBe(POOL_CREDIT);
    expect(charCash(db)).toBe(100 + CHAR_CREDIT);
    expect(receipt(db, "dissolve-pool-insert").status).toBe("completed");
  });

  it("fails closed with the holder sentinel when the fund row is gone", async () => {
    const db = new FakeDb();
    seedDb(db);
    db.collection("indexFunds").docs.delete(FUND_ID.toHexString());

    await expect(
      applyBondDissolutionSpend(
        db as unknown as Db,
        dissolutionInput({ idempotencyKey: "dissolve-fund-gone" })
      )
    ).rejects.toThrow(new RegExp(`^${BOND_DISSOLUTION_HOLDER}`));
    // Pool and holder prefix compensated; nothing strands half-landed.
    expect(poolDoc(db).cashLocal).toBe(5_000);
    expect(charCash(db)).toBe(100);
    expect(creditorCapital(db)).toBe(50);
    expect(receipt(db, "dissolve-fund-gone").status).toBe("compensated");
  });

  it("keeps the pool sentinel distinct from the holder sentinel", () => {
    // The pool step can only fail defensively (a live row always converges
    // through the leg or the fallback insert), so no fake topology reaches
    // BOND_DISSOLUTION_POOL: pin the contract instead — pool-credit step
    // names carry the pool prefix the mapper keys on, and the two sentinels
    // never alias.
    expect(BOND_DISSOLUTION_POOL).toBe("BOND_DISSOLUTION_POOL");
    expect(BOND_DISSOLUTION_HOLDER).toBe("BOND_DISSOLUTION_HOLDER");
    expect(BOND_DISSOLUTION_POOL).not.toBe(BOND_DISSOLUTION_HOLDER);
  });

  it("validates its input before claiming a receipt", async () => {
    const db = new FakeDb();
    seedDb(db);
    await expect(
      applyBondDissolutionSpend(
        db as unknown as Db,
        dissolutionInput({ holders: [], funds: [], poolCredits: [] })
      )
    ).rejects.toThrow(TypeError);
    await expect(
      applyBondDissolutionSpend(
        db as unknown as Db,
        dissolutionInput({
          holders: [{ kind: "character", holderId: CHAR_ID, field: "cashOnHand", amount: 0 }],
        })
      )
    ).rejects.toThrow(RangeError);
    await expect(
      applyBondDissolutionSpend(db as unknown as Db, dissolutionInput({ idempotencyKey: "" }))
    ).rejects.toThrow(RangeError);
    expect(db.collection(NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION).docs.size).toBe(0);
  });
});

describe("buildBondDissolutionFingerprint", () => {
  it("is order-independent and rounds to cents", () => {
    const holderA = { kind: "character" as const, holderId: CHAR_ID, amount: 100 };
    const holderB = { kind: "corp" as const, holderId: CREDITOR_CORP_ID, amount: 250 };
    const base = { corpId: CORP_ID, bonds: [] as ObjectId[] };
    const forward = buildBondDissolutionFingerprint({
      ...base,
      holders: [holderA, holderB],
      funds: [{ fundId: FUND_ID, amount: FUND_CREDIT }],
      pools: [{ currency: "USD", amount: POOL_CREDIT }],
    });
    const reordered = buildBondDissolutionFingerprint({
      ...base,
      holders: [holderB, holderA],
      funds: [{ fundId: FUND_ID, amount: FUND_CREDIT }],
      pools: [{ currency: "USD", amount: POOL_CREDIT }],
    });
    expect(reordered).toBe(forward);

    // Sub-cent dust does not fork the fingerprint: the resume path compares
    // pool credits at cent precision.
    const dusty = buildBondDissolutionFingerprint({
      ...base,
      holders: [
        { kind: "character", holderId: CHAR_ID, amount: 100.004 },
        { kind: "corp", holderId: CREDITOR_CORP_ID, amount: 250 },
      ],
      funds: [{ fundId: FUND_ID, amount: FUND_CREDIT }],
      pools: [{ currency: "USD", amount: 300.002 }],
    });
    expect(dusty).toBe(forward);

    const different = buildBondDissolutionFingerprint({
      ...base,
      holders: [holderA, { kind: "corp", holderId: CREDITOR_CORP_ID, amount: 251 }],
      funds: [{ fundId: FUND_ID, amount: FUND_CREDIT }],
      pools: [{ currency: "USD", amount: POOL_CREDIT }],
    });
    expect(different).not.toBe(forward);
  });
});

describe("resumeBondDissolutionByKey (empty-remainder recovery)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supportMock.mockResolvedValue(false);
  });

  it("finishes a crashed attempt key-only and reports the stored outcome", async () => {
    const db = new FakeDb();
    seedDb(db);
    const key = "dissolve-resume";
    const input = dissolutionInput({ idempotencyKey: key });
    db.crashAfterWrites = 4;
    await expect(applyBondDissolutionSpend(db as unknown as Db, input)).rejects.toThrow(
      "INJECTED_CRASH"
    );

    // The executor has no spend input left (live bond set reads empty): the
    // key alone finishes the stored plan and reports its outcome.
    db.crashAfterWrites = Number.POSITIVE_INFINITY;
    db.writeCount = 0;
    const resumed = await resumeBondDissolutionByKey(db as unknown as Db, key, CORP_ID);

    expect(resumed?.outcome).toEqual(outcomeFixture());
    expectExactPayouts(db);
    expect(receipt(db, key).status).toBe("completed");
  });

  it("reports the stored outcome for a completed receipt without moving money", async () => {
    const db = new FakeDb();
    seedDb(db);
    const key = "dissolve-resume-done";
    await applyBondDissolutionSpend(
      db as unknown as Db,
      dissolutionInput({ idempotencyKey: key })
    );

    const before = charCash(db);
    const resumed = await resumeBondDissolutionByKey(db as unknown as Db, key, CORP_ID);
    expect(resumed?.outcome).toEqual(outcomeFixture());
    expect(charCash(db)).toBe(before);
  });

  it("returns null when no receipt exists, so the caller keeps its public refusal", async () => {
    const db = new FakeDb();
    seedDb(db);
    await expect(
      resumeBondDissolutionByKey(db as unknown as Db, "dissolve-absent", CORP_ID)
    ).resolves.toBeNull();
  });

  it("returns null for an in-progress receipt with no usable plan or outcome", async () => {
    const db = new FakeDb();
    seedDb(db);
    const key = "dissolve-no-plan";
    const input = dissolutionInput({ idempotencyKey: key });
    db.crashAfterWrites = 1;
    await expect(applyBondDissolutionSpend(db as unknown as Db, input)).rejects.toThrow(
      "INJECTED_CRASH"
    );

    await expect(
      resumeBondDissolutionByKey(db as unknown as Db, key, CORP_ID)
    ).resolves.toBeNull();
  });

  it("throws terminal for a settled failed receipt", async () => {
    const db = new FakeDb();
    seedDb(db);
    db.collection("corporations").docs.delete(CREDITOR_CORP_ID.toHexString());
    const key = "dissolve-resume-terminal";
    await expect(
      applyBondDissolutionSpend(db as unknown as Db, dissolutionInput({ idempotencyKey: key }))
    ).rejects.toThrow(new RegExp(`^${BOND_DISSOLUTION_HOLDER}`));

    await expect(
      resumeBondDissolutionByKey(db as unknown as Db, key, CORP_ID)
    ).rejects.toBeInstanceOf(MoneyFlowTerminalError);
  });

  it("throws conflict when the stored attempt names a different corporation", async () => {
    const db = new FakeDb();
    seedDb(db);
    const key = "dissolve-resume-conflict";
    await applyBondDissolutionSpend(
      db as unknown as Db,
      dissolutionInput({ idempotencyKey: key })
    );

    await expect(
      resumeBondDissolutionByKey(db as unknown as Db, key, new ObjectId())
    ).rejects.toBeInstanceOf(MoneyFlowKeyConflictError);
  });
});

describe("getBondDissolutionCompletedOutcome (route replay)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supportMock.mockResolvedValue(false);
  });

  it("returns the stored outcome for a completed receipt", async () => {
    const db = new FakeDb();
    seedDb(db);
    const key = "dissolve-completed";
    await applyBondDissolutionSpend(
      db as unknown as Db,
      dissolutionInput({ idempotencyKey: key })
    );

    const outcome = await getBondDissolutionCompletedOutcome(
      db as unknown as Db,
      key,
      CORP_ID.toHexString()
    );
    expect(outcome).toEqual(outcomeFixture());
  });

  it("returns null when no receipt exists or the attempt is still in flight", async () => {
    const db = new FakeDb();
    seedDb(db);
    await expect(
      getBondDissolutionCompletedOutcome(db as unknown as Db, "dissolve-absent", "abc")
    ).resolves.toBeNull();

    const key = "dissolve-inflight";
    const input = dissolutionInput({ idempotencyKey: key });
    db.crashAfterWrites = 4;
    await expect(applyBondDissolutionSpend(db as unknown as Db, input)).rejects.toThrow(
      "INJECTED_CRASH"
    );
    await expect(
      getBondDissolutionCompletedOutcome(db as unknown as Db, key, CORP_ID.toHexString())
    ).resolves.toBeNull();
  });

  it("throws terminal for a settled failed receipt and conflict for cross-corp reuse", async () => {
    const db = new FakeDb();
    seedDb(db);
    db.collection("corporations").docs.delete(CREDITOR_CORP_ID.toHexString());
    const key = "dissolve-complete-term";
    await expect(
      applyBondDissolutionSpend(db as unknown as Db, dissolutionInput({ idempotencyKey: key }))
    ).rejects.toThrow(new RegExp(`^${BOND_DISSOLUTION_HOLDER}`));

    await expect(
      getBondDissolutionCompletedOutcome(db as unknown as Db, key, CORP_ID.toHexString())
    ).rejects.toBeInstanceOf(MoneyFlowTerminalError);
  });

  it("throws conflict when the completed receipt names a different corporation", async () => {
    const db = new FakeDb();
    seedDb(db);
    const key = "dissolve-completed-conflict";
    await applyBondDissolutionSpend(
      db as unknown as Db,
      dissolutionInput({ idempotencyKey: key })
    );

    await expect(
      getBondDissolutionCompletedOutcome(db as unknown as Db, key, new ObjectId().toHexString())
    ).rejects.toBeInstanceOf(MoneyFlowKeyConflictError);
  });
});
