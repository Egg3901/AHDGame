import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import {
  applyBondRestructureSpend,
  BOND_RESTRUCTURE_FUNDS,
  BOND_RESTRUCTURE_HOLDER,
  BOND_RESTRUCTURE_MATURE,
  buildBondRestructureFingerprint,
  isBondRestructureOutcome,
  resumeBondRestructureByKey,
  type BondRestructureSpendInput,
} from "./bondRestructureSpend";
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
// Stateful in-memory fakes honoring exactly the operators the restructure
// primitive emits ($inc incl. dotted balance fields, $push+$each+$slice key
// records, $set, $unset for cure reverts; _id equality, $ne-on-keys,
// ObjectId equality), so an injected crash between any two writes models a
// real process death between the corresponding sequential Mongo writes.
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
    if (field === "_id") {
      if (!valueEquals(doc._id, condition)) return false;
      continue;
    }
    const actual = getPath(doc, field);
    if (typeof condition === "object" && condition !== null && !(condition instanceof ObjectId)) {
      const ops = condition as Record<string, unknown>;
      if ("$ne" in ops) {
        const keys = doc[field] as string[] | undefined;
        if (keys?.includes(ops.$ne as string)) return false;
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
    _opts?: unknown
  ): Promise<Record<string, unknown> | null> {
    const doc = this.docs.get(docKey(filter._id));
    if (!doc) return null;
    return structuredClone(doc);
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

const corpId = new ObjectId();
const charId = new ObjectId();
const imperialId = new ObjectId();
const holderCorpId = new ObjectId();
const bondA = new ObjectId();
const bondB = new ObjectId();
const NOW = new Date("2026-09-17T00:00:00Z");

// Salvage 8_500, principal 10_000 + 5_000: net -6_500 is impossible by
// feasibility, so the seeded net is +2_000 (proceeds 17_000, principal 15_000).
const NET = 2_000;

function seedDb(db: FakeDb): void {
  db.collection("corporations").docs.set(corpId.toHexString(), {
    _id: corpId,
    liquidCapital: 1_000,
  });
  db.collection("corporations").docs.set(holderCorpId.toHexString(), {
    _id: holderCorpId,
    liquidCapital: 5_000,
  });
  db.collection("characters").docs.set(charId.toHexString(), { _id: charId, cashOnHand: 100 });
  db.collection("imperialCharacters").docs.set(imperialId.toHexString(), {
    _id: imperialId,
    cashOnHand: 0,
  });
  db.collection("bonds").docs.set(bondA.toHexString(), {
    _id: bondA,
    corporationId: corpId,
    matured: false,
    defaulted: true,
    defaultedAtTurn: 440,
    marketPrice: 0.4,
  });
  db.collection("bonds").docs.set(bondB.toHexString(), {
    _id: bondB,
    corporationId: corpId,
    matured: false,
    defaulted: true,
    defaultedAtTurn: 440,
    marketPrice: 0.5,
  });
}

function holders(): BondRestructureSpendInput["holders"] {
  return [
    { kind: "character", holderId: charId, field: "cashOnHand", amount: 10_000 },
    { kind: "imperial", holderId: imperialId, field: "cashOnHand", amount: 3_000 },
    { kind: "corp", holderId: holderCorpId, field: "liquidCapital", amount: 2_000 },
  ];
}

function restructureInput(
  overrides: Partial<BondRestructureSpendInput> = {}
): BondRestructureSpendInput {
  const holderList = overrides.holders ?? holders();
  const bondList = overrides.bonds ?? [
    { bondId: bondA, priorMarketPrice: 0.4 },
    { bondId: bondB, priorMarketPrice: 0.5 },
  ];
  return {
    corpId,
    netLiquidCapitalDelta: NET,
    holders: holderList,
    bonds: bondList,
    cureTurn: 444,
    now: NOW,
    fingerprint: buildBondRestructureFingerprint({
      corpId,
      netLiquidCapitalDelta: overrides.netLiquidCapitalDelta ?? NET,
      bonds: bondList.map((b) => b.bondId),
      holders: holderList.map((h) => ({ kind: h.kind, holderId: h.holderId, amount: h.amount })),
      cureTurn: 444,
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
    | MoneyFlowReceipt
    | undefined;
  if (!doc) throw new Error(`missing receipt for ${key}`);
  return doc;
}

describe("applyBondRestructureSpend (standalone fallback)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supportMock.mockResolvedValue(false);
  });

  it("nets the corp leg, pays all three holder kinds, and cures both bonds", async () => {
    const db = new FakeDb();
    seedDb(db);

    const result = await applyBondRestructureSpend(
      db as unknown as Db,
      restructureInput({ idempotencyKey: "restructure-happy" })
    );

    expect(result).toEqual({ duplicate: false });
    expect(num(db, "corporations", corpId, "liquidCapital")).toBe(1_000 + NET);
    expect(num(db, "characters", charId, "cashOnHand")).toBe(100 + 10_000);
    expect(num(db, "imperialCharacters", imperialId, "cashOnHand")).toBe(3_000);
    expect(num(db, "corporations", holderCorpId, "liquidCapital")).toBe(5_000 + 2_000);
    for (const id of [bondA, bondB]) {
      const bond = bondDoc(db, id);
      expect(bond.matured).toBe(true);
      expect(bond.marketPrice).toBe(1);
      expect(bond.defaulted).toBe(false);
      expect(bond.defaultCure).toEqual({ cureMethod: "restructure", curedAtTurn: 444 });
      expect(bond.defaultedAtTurn).toBe(440);
    }
    expect(receipt(db, "restructure-happy").status).toBe("completed");
  });

  it("completes without a corp leg when the net is zero", async () => {
    const db = new FakeDb();
    seedDb(db);

    const result = await applyBondRestructureSpend(
      db as unknown as Db,
      restructureInput({ idempotencyKey: "restructure-zero-net", netLiquidCapitalDelta: 0 })
    );

    expect(result).toEqual({ duplicate: false });
    expect(num(db, "corporations", corpId, "liquidCapital")).toBe(1_000);
    expect(num(db, "characters", charId, "cashOnHand")).toBe(100 + 10_000);
    expect(receipt(db, "restructure-zero-net").status).toBe("completed");
  });

  it("replays the same key without moving money again", async () => {
    const db = new FakeDb();
    seedDb(db);
    const input = restructureInput({ idempotencyKey: "restructure-replay" });

    const first = await applyBondRestructureSpend(db as unknown as Db, input);
    const second = await applyBondRestructureSpend(db as unknown as Db, input);

    expect(first).toEqual({ duplicate: false });
    expect(second).toEqual({ duplicate: true });
    expect(num(db, "corporations", corpId, "liquidCapital")).toBe(1_000 + NET);
    expect(num(db, "characters", charId, "cashOnHand")).toBe(100 + 10_000);
  });

  it("converges to exactly one restructure when a crash interrupts any write", async () => {
    // Write order: receipt claim, plan persist, corp leg, 3 holder credits,
    // 2 cure claims. Crashing after each prefix then retrying with the same
    // key must converge: money moved once, both bonds cured.
    const totalWrites = 7;
    for (let crashAfter = 1; crashAfter < totalWrites; crashAfter += 1) {
      const db = new FakeDb();
      seedDb(db);
      const input = restructureInput({ idempotencyKey: `restructure-crash-${crashAfter}` });
      db.crashAfterWrites = crashAfter;
      await expect(applyBondRestructureSpend(db as unknown as Db, input)).rejects.toThrow(
        "INJECTED_CRASH"
      );

      db.crashAfterWrites = Number.POSITIVE_INFINITY;
      db.writeCount = 0;
      const retry = await applyBondRestructureSpend(db as unknown as Db, input);

      expect(retry.duplicate).toBe(true);
      expect(num(db, "corporations", corpId, "liquidCapital")).toBe(1_000 + NET);
      expect(num(db, "characters", charId, "cashOnHand")).toBe(100 + 10_000);
      expect(num(db, "imperialCharacters", imperialId, "cashOnHand")).toBe(3_000);
      expect(num(db, "corporations", holderCorpId, "liquidCapital")).toBe(5_000 + 2_000);
      for (const id of [bondA, bondB]) {
        expect(bondDoc(db, id).matured).toBe(true);
      }
      expect(receipt(db, `restructure-crash-${crashAfter}`).status).toBe("completed");
    }
  });

  it("resumes the stored plan when the retry presents a remainder fingerprint", async () => {
    const db = new FakeDb();
    seedDb(db);
    const key = "restructure-remainder";
    // Crash after claim, plan, corp leg, first holder credit (crash on the
    // second holder credit).
    db.crashAfterWrites = 4;
    await expect(
      applyBondRestructureSpend(db as unknown as Db, restructureInput({ idempotencyKey: key }))
    ).rejects.toThrow("INJECTED_CRASH");

    // The executor rebuilds from live state: bond A now reads matured and its
    // holders drop out, so the live input is a strict remainder.
    db.crashAfterWrites = Number.POSITIVE_INFINITY;
    db.writeCount = 0;
    const remainderHolders: BondRestructureSpendInput["holders"] = [
      { kind: "imperial", holderId: imperialId, field: "cashOnHand", amount: 3_000 },
      { kind: "corp", holderId: holderCorpId, field: "liquidCapital", amount: 2_000 },
    ];
    const remainder = restructureInput({
      idempotencyKey: key,
      holders: remainderHolders,
      bonds: [{ bondId: bondB, priorMarketPrice: 0.5 }],
      fingerprint: buildBondRestructureFingerprint({
        corpId,
        netLiquidCapitalDelta: NET,
        bonds: [bondB],
        holders: remainderHolders.map((h) => ({
          kind: h.kind,
          holderId: h.holderId,
          amount: h.amount,
        })),
        cureTurn: 444,
      }),
    });
    const retry = await applyBondRestructureSpend(db as unknown as Db, remainder);

    expect(retry.duplicate).toBe(true);
    // The STORED plan ran to completion at exactly the attempted amounts.
    expect(num(db, "corporations", corpId, "liquidCapital")).toBe(1_000 + NET);
    expect(num(db, "characters", charId, "cashOnHand")).toBe(100 + 10_000);
    expect(num(db, "imperialCharacters", imperialId, "cashOnHand")).toBe(3_000);
    expect(receipt(db, key).status).toBe("completed");
  });

  it("rejects a same-key retry for a genuinely different restructure", async () => {
    const db = new FakeDb();
    seedDb(db);
    const key = "restructure-conflict";
    await applyBondRestructureSpend(
      db as unknown as Db,
      restructureInput({ idempotencyKey: key })
    );

    const other = restructureInput({
      idempotencyKey: key,
      fingerprint: "bond-restructure:other-corp:entirely-different",
    });
    await expect(applyBondRestructureSpend(db as unknown as Db, other)).rejects.toBeInstanceOf(
      MoneyFlowKeyConflictError
    );
    expect(num(db, "characters", charId, "cashOnHand")).toBe(100 + 10_000);
  });

  it("compensates the prefix when a holder vanished mid-flight", async () => {
    const db = new FakeDb();
    seedDb(db);
    // Imperial holder deleted between the executor's read and the flow.
    db.collection("imperialCharacters").docs.delete(imperialId.toHexString());

    await expect(
      applyBondRestructureSpend(
        db as unknown as Db,
        restructureInput({ idempotencyKey: "restructure-missing" })
      )
    ).rejects.toThrow(new RegExp(`^${BOND_RESTRUCTURE_HOLDER}`));
    // Prefix reversed: corp leg refunded, character credit unwound, no cures.
    expect(num(db, "corporations", corpId, "liquidCapital")).toBe(1_000);
    expect(num(db, "characters", charId, "cashOnHand")).toBe(100);
    expect(bondDoc(db, bondA).matured).toBe(false);
    expect(bondDoc(db, bondB).matured).toBe(false);
    expect(receipt(db, "restructure-missing").status).toBe("compensated");
  });

  it("compensates money moved when a bond raced", async () => {
    const db = new FakeDb();
    seedDb(db);
    bondDoc(db, bondB).matured = true;

    await expect(
      applyBondRestructureSpend(
        db as unknown as Db,
        restructureInput({ idempotencyKey: "restructure-race" })
      )
    ).rejects.toThrow(new RegExp(`^${BOND_RESTRUCTURE_MATURE}`));
    expect(num(db, "corporations", corpId, "liquidCapital")).toBe(1_000);
    expect(num(db, "characters", charId, "cashOnHand")).toBe(100);
    expect(num(db, "imperialCharacters", imperialId, "cashOnHand")).toBe(0);
    expect(num(db, "corporations", holderCorpId, "liquidCapital")).toBe(5_000);
    expect(bondDoc(db, bondA).matured).toBe(false);
    expect(bondDoc(db, bondA).defaulted).toBe(true);
    expect(receipt(db, "restructure-race").status).toBe("compensated");
  });

  it("fails closed when the corp row is gone", async () => {
    const db = new FakeDb();
    seedDb(db);
    db.collection("corporations").docs.delete(corpId.toHexString());

    await expect(
      applyBondRestructureSpend(
        db as unknown as Db,
        restructureInput({ idempotencyKey: "restructure-nocorp" })
      )
    ).rejects.toThrow(new RegExp(`^${BOND_RESTRUCTURE_FUNDS}`));
    expect(num(db, "characters", charId, "cashOnHand")).toBe(100);
    expect(receipt(db, "restructure-nocorp").status).toBe("failed");
  });
});

describe("isBondRestructureOutcome (persisted outcome schema)", () => {
  it("accepts a complete outcome and rejects malformed ones", () => {
    expect(
      isBondRestructureOutcome({
        paid: 15_000,
        bondsMatured: 2,
        sectorsLiquidated: 1,
        proceeds: 17_000,
        residualLiquidCapital: 3_000,
      })
    ).toBe(true);
    expect(isBondRestructureOutcome(undefined)).toBe(false);
    expect(isBondRestructureOutcome(null)).toBe(false);
    expect(isBondRestructureOutcome({})).toBe(false);
    // Missing or mistyped fields are unusable: the caller must keep its
    // public no-default refusal rather than report corrupt numbers.
    expect(
      isBondRestructureOutcome({ paid: 15_000, bondsMatured: 2, sectorsLiquidated: 1 })
    ).toBe(false);
    expect(
      isBondRestructureOutcome({
        paid: 15_000,
        bondsMatured: "2",
        sectorsLiquidated: 1,
        proceeds: 17_000,
        residualLiquidCapital: 3_000,
      })
    ).toBe(false);
  });
});

const RESTRUCTURE_OUTCOME = {
  paid: 15_000,
  bondsMatured: 2,
  sectorsLiquidated: 1,
  proceeds: 17_000,
  residualLiquidCapital: 3_000,
};

describe("resumeBondRestructureByKey (empty-remainder recovery)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supportMock.mockResolvedValue(false);
  });

  it("recovers a crash after the final cure: settles the receipt and reports the stored outcome", async () => {
    const db = new FakeDb();
    seedDb(db);
    const key = "restructure-resume-final-cure";
    // Writes: claim, plan, corp leg, 3 holder credits, cure A, cure B, then
    // the receipt completion — crashing on completion leaves every bond
    // cured with an in_progress receipt and no live defaulted set to rebuild
    // input from.
    db.crashAfterWrites = 8;
    await expect(
      applyBondRestructureSpend(
        db as unknown as Db,
        restructureInput({ idempotencyKey: key, outcome: { ...RESTRUCTURE_OUTCOME } })
      )
    ).rejects.toThrow("INJECTED_CRASH");
    expect(receipt(db, key).status).toBe("in_progress");
    expect(bondDoc(db, bondA).matured).toBe(true);
    expect(bondDoc(db, bondB).matured).toBe(true);

    db.crashAfterWrites = Number.POSITIVE_INFINITY;
    db.writeCount = 0;
    const resumed = await resumeBondRestructureByKey(db as unknown as Db, key, corpId);

    expect(resumed).toEqual({ outcome: RESTRUCTURE_OUTCOME });
    // No duplicate payout on recovery: holders credited exactly once.
    expect(num(db, "characters", charId, "cashOnHand")).toBe(100 + 10_000);
    expect(num(db, "corporations", corpId, "liquidCapital")).toBe(1_000 + NET);
    expect(receipt(db, key).status).toBe("completed");
  });

  it("converges on the same key after recovery without paying again", async () => {
    const db = new FakeDb();
    seedDb(db);
    const key = "restructure-resume-converge";
    db.crashAfterWrites = 8;
    await expect(
      applyBondRestructureSpend(
        db as unknown as Db,
        restructureInput({ idempotencyKey: key, outcome: { ...RESTRUCTURE_OUTCOME } })
      )
    ).rejects.toThrow("INJECTED_CRASH");

    db.crashAfterWrites = Number.POSITIVE_INFINITY;
    db.writeCount = 0;
    await resumeBondRestructureByKey(db as unknown as Db, key, corpId);

    const retry = await applyBondRestructureSpend(
      db as unknown as Db,
      restructureInput({ idempotencyKey: key, outcome: { ...RESTRUCTURE_OUTCOME } })
    );
    expect(retry).toEqual({ duplicate: true });
    expect(num(db, "characters", charId, "cashOnHand")).toBe(100 + 10_000);
  });

  it("returns null when no receipt exists, so the caller keeps its public refusal", async () => {
    const db = new FakeDb();
    seedDb(db);
    await expect(
      resumeBondRestructureByKey(db as unknown as Db, "restructure-absent", corpId)
    ).resolves.toBeNull();
  });

  it("returns null for a completed receipt: genuinely finished work stays historical", async () => {
    const db = new FakeDb();
    seedDb(db);
    const key = "restructure-resume-completed";
    await applyBondRestructureSpend(
      db as unknown as Db,
      restructureInput({ idempotencyKey: key, outcome: { ...RESTRUCTURE_OUTCOME } })
    );
    await expect(resumeBondRestructureByKey(db as unknown as Db, key, corpId)).resolves.toBeNull();
  });

  it("returns null for an in-progress receipt with no usable plan or outcome", async () => {
    // Crash on the plan write: the claim landed but nothing applied yet.
    const db = new FakeDb();
    seedDb(db);
    const key = "restructure-resume-noplan";
    db.crashAfterWrites = 1;
    await expect(
      applyBondRestructureSpend(db as unknown as Db, restructureInput({ idempotencyKey: key }))
    ).rejects.toThrow("INJECTED_CRASH");
    await expect(resumeBondRestructureByKey(db as unknown as Db, key, corpId)).resolves.toBeNull();

    // A stored plan without a persisted outcome cannot report an attempt.
    const db2 = new FakeDb();
    seedDb(db2);
    const key2 = "restructure-resume-nooutcome";
    db2.crashAfterWrites = 7;
    await expect(
      applyBondRestructureSpend(db2 as unknown as Db, restructureInput({ idempotencyKey: key2 }))
    ).rejects.toThrow("INJECTED_CRASH");
    await expect(
      resumeBondRestructureByKey(db2 as unknown as Db, key2, corpId)
    ).resolves.toBeNull();
  });

  it("throws terminal for a settled failed receipt", async () => {
    const db = new FakeDb();
    seedDb(db);
    db.collection("corporations").docs.delete(corpId.toHexString());
    const key = "restructure-resume-terminal";
    await expect(
      applyBondRestructureSpend(
        db as unknown as Db,
        restructureInput({ idempotencyKey: key })
      )
    ).rejects.toThrow(new RegExp(`^${BOND_RESTRUCTURE_FUNDS}`));
    await expect(
      resumeBondRestructureByKey(db as unknown as Db, key, corpId)
    ).rejects.toBeInstanceOf(MoneyFlowTerminalError);
  });

  it("throws conflict when the stored attempt names a different corporation", async () => {
    const db = new FakeDb();
    seedDb(db);
    const key = "restructure-resume-corpmismatch";
    db.crashAfterWrites = 7;
    await expect(
      applyBondRestructureSpend(
        db as unknown as Db,
        restructureInput({ idempotencyKey: key, outcome: { ...RESTRUCTURE_OUTCOME } })
      )
    ).rejects.toThrow("INJECTED_CRASH");
    await expect(
      resumeBondRestructureByKey(db as unknown as Db, key, new ObjectId())
    ).rejects.toBeInstanceOf(MoneyFlowKeyConflictError);

    // The mismatch also holds on a completed receipt (fail closed on
    // cross-corp key reuse even after settlement).
    const db2 = new FakeDb();
    seedDb(db2);
    const key2 = "restructure-resume-completed-mismatch";
    await applyBondRestructureSpend(
      db2 as unknown as Db,
      restructureInput({ idempotencyKey: key2, outcome: { ...RESTRUCTURE_OUTCOME } })
    );
    await expect(
      resumeBondRestructureByKey(db2 as unknown as Db, key2, new ObjectId())
    ).rejects.toBeInstanceOf(MoneyFlowKeyConflictError);
  });
});
