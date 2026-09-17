import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import {
  applyBondRefinanceSpend,
  BOND_REFINANCE_COUNT,
  BOND_REFINANCE_MATURE,
  buildBondRefinanceFingerprint,
  isBondRefinanceOutcome,
  resumeBondRefinanceByKey,
  type BondRefinanceSpendInput,
} from "./bondRefinanceSpend";
import {
  keyedInsertId,
  MoneyFlowKeyConflictError,
  MoneyFlowTerminalError,
  NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION,
  type MoneyFlowReceipt,
} from "@/lib/db/nonAtomicMoneyFlow";
import { MAX_BOND_DEFAULT_REFINANCES } from "@/lib/constants/bonds";

const { supportMock } = vi.hoisted(() => ({ supportMock: vi.fn() }));

vi.mock("@/lib/db/transactionSupport", () => ({
  assertTransactionSupportAtBoot: supportMock,
}));

// ---------------------------------------------------------------------------
// Stateful in-memory fakes honoring exactly the operators the refinance
// primitive emits ($inc, $push+$each+$slice key records, $set, $unset; _id
// equality, $ne-on-keys, $or/$lt/$exists count guard, ObjectId equality,
// duplicate-key errors on insert), so an injected crash between any two
// writes models a real process death between the corresponding sequential
// Mongo writes.
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

function matchesCondition(
  doc: Record<string, unknown>,
  field: string,
  condition: unknown
): boolean {
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
    if ("$lt" in ops) {
      return typeof actual === "number" && actual < (ops.$lt as number);
    }
    if ("$exists" in ops) {
      const exists = actual !== undefined;
      return ops.$exists ? exists : !exists;
    }
    return false;
  }
  if (field === "_id") return valueEquals(doc._id, condition);
  return valueEquals(actual, condition);
}

function matchesFilter(doc: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  for (const [field, condition] of Object.entries(filter)) {
    if (field === "$or") {
      const branches = condition as Record<string, unknown>[];
      if (!branches.some((branch) => matchesFilter(doc, branch))) return false;
      continue;
    }
    if (!matchesCondition(doc, field, condition)) return false;
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
const bondA = new ObjectId();
const bondB = new ObjectId();
const charId = new ObjectId();
const NOW = new Date("2026-09-17T00:00:00Z");

function seedDb(db: FakeDb): void {
  db.collection("corporations").docs.set(corpId.toHexString(), {
    _id: corpId,
    liquidCapital: 50_000,
    bondDefaultRefinanceCount: 0,
  });
  db.collection("bonds").docs.set(bondA.toHexString(), {
    _id: bondA,
    corporationId: corpId,
    matured: false,
    defaulted: true,
    defaultedAtTurn: 440,
    marketPrice: 0.4,
    totalIssued: 10_000,
    publicFloat: 0,
    holders: [{ characterId: charId, units: 10 }],
  });
  db.collection("bonds").docs.set(bondB.toHexString(), {
    _id: bondB,
    corporationId: corpId,
    matured: false,
    defaulted: true,
    defaultedAtTurn: 440,
    marketPrice: 0.5,
    totalIssued: 5_000,
    publicFloat: 0,
    holders: [{ characterId: charId, units: 5 }],
  });
}

function refinanceInput(overrides: Partial<BondRefinanceSpendInput> = {}): BondRefinanceSpendInput {
  const bonds = overrides.bonds ?? [
    { bondId: bondA, priorMarketPrice: 0.4 },
    { bondId: bondB, priorMarketPrice: 0.5 },
  ];
  const newBond = overrides.newBond ?? {
    corporationId: corpId,
    faceValue: 1_000,
    couponRate: 7.5,
    maturityTurns: 96,
    issuedAtTurn: 444,
    maturityTurn: 540,
    marketPrice: 1.0,
    totalIssued: 15_000,
    publicFloat: 0,
    holders: [{ characterId: charId, units: 15 }],
    defaulted: false,
    defaultedAtTurn: null,
    matured: false,
    currencyCode: "USD",
    createdAt: NOW,
    updatedAt: NOW,
  };
  return {
    corpId,
    bonds,
    newBond: newBond as BondRefinanceSpendInput["newBond"],
    cureTurn: 444,
    now: NOW,
    fingerprint: buildBondRefinanceFingerprint({
      corpId,
      bonds: bonds.map((b) => b.bondId),
      totalUnits: 15,
      couponRate: 7.5,
      maturityTurns: 96,
      currencyCode: "USD",
      holders: [{ holderId: charId, units: 15 }],
    }),
    idempotencyKey: `key-${Math.random().toString(36).slice(2)}`,
    ...overrides,
  };
}

function bondDoc(db: FakeDb, id: ObjectId): Record<string, unknown> {
  return db.collection("bonds").docs.get(id.toHexString())!;
}

function corpDoc(db: FakeDb): Record<string, unknown> {
  return db.collection("corporations").docs.get(corpId.toHexString())!;
}

function receipt(db: FakeDb, key: string): MoneyFlowReceipt {
  const doc = db.collection(NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION).docs.get(key) as unknown as
    | MoneyFlowReceipt
    | undefined;
  if (!doc) throw new Error(`missing receipt for ${key}`);
  return doc;
}

function bondCount(db: FakeDb): number {
  return db.collection("bonds").docs.size;
}

describe("applyBondRefinanceSpend (standalone fallback)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supportMock.mockResolvedValue(false);
  });

  it("issues one replacement bond, counts once, and cures both bonds", async () => {
    const db = new FakeDb();
    seedDb(db);
    const input = refinanceInput({ idempotencyKey: "refi-happy" });

    const result = await applyBondRefinanceSpend(db as unknown as Db, input);

    expect(result.duplicate).toBe(false);
    expect(result.bondId).toMatch(/^[0-9a-f]{24}$/);
    expect(bondCount(db)).toBe(3);
    const inserted = bondDoc(db, new ObjectId(result.bondId));
    expect(inserted.totalIssued).toBe(15_000);
    expect(inserted.defaulted).toBe(false);
    expect(corpDoc(db).bondDefaultRefinanceCount).toBe(1);
    for (const id of [bondA, bondB]) {
      const bond = bondDoc(db, id);
      expect(bond.matured).toBe(true);
      expect(bond.marketPrice).toBe(1);
      expect(bond.defaulted).toBe(false);
      expect(bond.defaultCure).toEqual({ cureMethod: "refinance", curedAtTurn: 444 });
      // Historical mark preserved for the audit trail.
      expect(bond.defaultedAtTurn).toBe(440);
    }
    expect(receipt(db, "refi-happy").status).toBe("completed");
  });

  it("replays the same key without issuing again", async () => {
    const db = new FakeDb();
    seedDb(db);
    const input = refinanceInput({ idempotencyKey: "refi-replay" });

    const first = await applyBondRefinanceSpend(db as unknown as Db, input);
    const second = await applyBondRefinanceSpend(db as unknown as Db, input);

    expect(second).toEqual({ duplicate: true, bondId: first.bondId });
    expect(bondCount(db)).toBe(3);
    expect(corpDoc(db).bondDefaultRefinanceCount).toBe(1);
  });

  it("converges to exactly one refinance when a crash interrupts any write", async () => {
    // Write order: receipt claim, plan persist, count claim, cure A, cure B,
    // replacement insert. Crashing after each prefix then retrying with the
    // same key must converge: one bond, count 1, both bonds cured.
    const totalWrites = 6;
    for (let crashAfter = 1; crashAfter < totalWrites; crashAfter += 1) {
      const db = new FakeDb();
      seedDb(db);
      const input = refinanceInput({ idempotencyKey: `refi-crash-${crashAfter}` });
      db.crashAfterWrites = crashAfter;
      await expect(applyBondRefinanceSpend(db as unknown as Db, input)).rejects.toThrow(
        "INJECTED_CRASH"
      );

      db.crashAfterWrites = Number.POSITIVE_INFINITY;
      db.writeCount = 0;
      const retry = await applyBondRefinanceSpend(db as unknown as Db, input);

      expect(retry.duplicate).toBe(true);
      expect(bondCount(db)).toBe(3);
      expect(corpDoc(db).bondDefaultRefinanceCount).toBe(1);
      for (const id of [bondA, bondB]) {
        expect(bondDoc(db, id).matured).toBe(true);
      }
      expect(receipt(db, `refi-crash-${crashAfter}`).status).toBe("completed");
    }
  });

  it("resumes the stored plan when the retry presents a remainder fingerprint", async () => {
    const db = new FakeDb();
    seedDb(db);
    const key = "refi-remainder";
    const input = refinanceInput({ idempotencyKey: key });
    // Crash after the count claim + first cure (3 writes: claim, plan, count,
    // cure A — crash on cure B).
    db.crashAfterWrites = 4;
    await expect(applyBondRefinanceSpend(db as unknown as Db, input)).rejects.toThrow(
      "INJECTED_CRASH"
    );

    // The executor rebuilds from live state: bond A now reads matured, so the
    // live input covers only bond B with a shrunken fingerprint.
    db.crashAfterWrites = Number.POSITIVE_INFINITY;
    db.writeCount = 0;
    const remainder = refinanceInput({
      idempotencyKey: key,
      bonds: [{ bondId: bondB, priorMarketPrice: 0.5 }],
      fingerprint: buildBondRefinanceFingerprint({
        corpId,
        bonds: [bondB],
        totalUnits: 5,
        couponRate: 7.5,
        maturityTurns: 96,
        currencyCode: "USD",
        holders: [{ holderId: charId, units: 5 }],
      }),
    });
    const retry = await applyBondRefinanceSpend(db as unknown as Db, remainder);

    expect(retry.duplicate).toBe(true);
    // The STORED plan ran to completion: both bonds cured, full replacement.
    expect(bondCount(db)).toBe(3);
    expect(corpDoc(db).bondDefaultRefinanceCount).toBe(1);
    expect(bondDoc(db, bondA).matured).toBe(true);
    expect(bondDoc(db, bondB).matured).toBe(true);
    expect(receipt(db, key).status).toBe("completed");
  });

  it("rejects a same-key retry for a genuinely different refinance", async () => {
    const db = new FakeDb();
    seedDb(db);
    const key = "refi-conflict";
    await applyBondRefinanceSpend(db as unknown as Db, refinanceInput({ idempotencyKey: key }));

    const other = refinanceInput({
      idempotencyKey: key,
      fingerprint: "bond-refinance:other-corp:entirely-different",
    });
    await expect(applyBondRefinanceSpend(db as unknown as Db, other)).rejects.toBeInstanceOf(
      MoneyFlowKeyConflictError
    );
    expect(bondCount(db)).toBe(3);
  });

  it("holds terminal receipts closed: a failed key cannot be retried", async () => {
    const db = new FakeDb();
    seedDb(db);
    corpDoc(db).bondDefaultRefinanceCount = MAX_BOND_DEFAULT_REFINANCES;
    const key = "refi-terminal";
    await expect(
      applyBondRefinanceSpend(db as unknown as Db, refinanceInput({ idempotencyKey: key }))
    ).rejects.toThrow(new RegExp(`^${BOND_REFINANCE_COUNT}`));

    await expect(
      applyBondRefinanceSpend(db as unknown as Db, refinanceInput({ idempotencyKey: key }))
    ).rejects.toBeInstanceOf(MoneyFlowTerminalError);
    expect(bondCount(db)).toBe(2);
  });

  it("fails closed on the cap without issuing when the count raced", async () => {
    const db = new FakeDb();
    seedDb(db);
    corpDoc(db).bondDefaultRefinanceCount = MAX_BOND_DEFAULT_REFINANCES;

    await expect(
      applyBondRefinanceSpend(db as unknown as Db, refinanceInput({ idempotencyKey: "refi-cap" }))
    ).rejects.toThrow(new RegExp(`^${BOND_REFINANCE_COUNT}`));
    expect(bondCount(db)).toBe(2);
    expect(bondDoc(db, bondA).matured).toBe(false);
    expect(receipt(db, "refi-cap").status).toBe("failed");
  });

  it("compensates the count and earlier cures when a bond raced", async () => {
    const db = new FakeDb();
    seedDb(db);
    // Bond B matured elsewhere between the executor's read and the flow.
    bondDoc(db, bondB).matured = true;

    await expect(
      applyBondRefinanceSpend(
        db as unknown as Db,
        refinanceInput({ idempotencyKey: "refi-race" })
      )
    ).rejects.toThrow(new RegExp(`^${BOND_REFINANCE_MATURE}`));
    // Prefix reversed: count back to 0, bond A uncured, no replacement.
    expect(corpDoc(db).bondDefaultRefinanceCount).toBe(0);
    expect(bondDoc(db, bondA).matured).toBe(false);
    expect(bondDoc(db, bondA).marketPrice).toBe(0.4);
    expect(bondDoc(db, bondA).defaulted).toBe(true);
    expect(bondDoc(db, bondA).defaultCure).toBeUndefined();
    expect(bondCount(db)).toBe(2);
    expect(receipt(db, "refi-race").status).toBe("compensated");
  });
});

describe("isBondRefinanceOutcome (persisted outcome schema)", () => {
  it("accepts a complete outcome and rejects malformed ones", () => {
    expect(
      isBondRefinanceOutcome({
        faceValueAnchor: 15_000_000,
        couponRate: 7.5,
        maturityTurn: 540,
        bondsMatured: 2,
        retiredBondIds: [bondA.toHexString(), bondB.toHexString()],
      })
    ).toBe(true);
    expect(isBondRefinanceOutcome(undefined)).toBe(false);
    expect(isBondRefinanceOutcome(null)).toBe(false);
    expect(isBondRefinanceOutcome({})).toBe(false);
    // Missing or mistyped fields are unusable: the caller must keep its
    // public no-default result rather than report corrupt numbers.
    expect(
      isBondRefinanceOutcome({
        faceValueAnchor: 15_000_000,
        couponRate: 7.5,
        maturityTurn: 540,
        bondsMatured: 2,
      })
    ).toBe(false);
    expect(
      isBondRefinanceOutcome({
        faceValueAnchor: 15_000_000,
        couponRate: 7.5,
        maturityTurn: 540,
        bondsMatured: "2",
        retiredBondIds: [],
      })
    ).toBe(false);
    expect(
      isBondRefinanceOutcome({
        faceValueAnchor: 15_000_000,
        couponRate: 7.5,
        maturityTurn: 540,
        bondsMatured: 2,
        retiredBondIds: [42],
      })
    ).toBe(false);
  });
});

const REFINANCE_OUTCOME = {
  faceValueAnchor: 15_000_000,
  couponRate: 7.5,
  maturityTurn: 540,
  bondsMatured: 2,
  retiredBondIds: [bondA.toHexString(), bondB.toHexString()],
};

describe("resumeBondRefinanceByKey (empty-remainder recovery)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supportMock.mockResolvedValue(false);
  });

  it("recovers a crash after the final cure: finishes the insert and reports the stored outcome", async () => {
    const db = new FakeDb();
    seedDb(db);
    const key = "refi-resume-final-cure";
    // Writes: claim, plan, count, cure A, cure B, then the replacement
    // insert — crashing on the insert leaves every bond cured with an
    // in_progress receipt and no live defaulted set to rebuild input from.
    db.crashAfterWrites = 5;
    await expect(
      applyBondRefinanceSpend(
        db as unknown as Db,
        refinanceInput({ idempotencyKey: key, outcome: { ...REFINANCE_OUTCOME } })
      )
    ).rejects.toThrow("INJECTED_CRASH");
    expect(receipt(db, key).status).toBe("in_progress");
    expect(bondDoc(db, bondA).matured).toBe(true);
    expect(bondDoc(db, bondB).matured).toBe(true);
    expect(bondCount(db)).toBe(2);

    db.crashAfterWrites = Number.POSITIVE_INFINITY;
    db.writeCount = 0;
    const resumed = await resumeBondRefinanceByKey(db as unknown as Db, key, corpId);

    expect(resumed).toEqual({
      bondId: keyedInsertId(key, "bond-refinance").toHexString(),
      outcome: REFINANCE_OUTCOME,
    });
    // Exactly one replacement: no duplicate issuance on recovery.
    expect(bondCount(db)).toBe(3);
    expect(corpDoc(db).bondDefaultRefinanceCount).toBe(1);
    expect(receipt(db, key).status).toBe("completed");
  });

  it("converges on the same key after recovery without issuing again", async () => {
    const db = new FakeDb();
    seedDb(db);
    const key = "refi-resume-converge";
    db.crashAfterWrites = 5;
    await expect(
      applyBondRefinanceSpend(
        db as unknown as Db,
        refinanceInput({ idempotencyKey: key, outcome: { ...REFINANCE_OUTCOME } })
      )
    ).rejects.toThrow("INJECTED_CRASH");

    db.crashAfterWrites = Number.POSITIVE_INFINITY;
    db.writeCount = 0;
    await resumeBondRefinanceByKey(db as unknown as Db, key, corpId);

    const retry = await applyBondRefinanceSpend(
      db as unknown as Db,
      refinanceInput({ idempotencyKey: key, outcome: { ...REFINANCE_OUTCOME } })
    );
    expect(retry.duplicate).toBe(true);
    expect(bondCount(db)).toBe(3);
    expect(corpDoc(db).bondDefaultRefinanceCount).toBe(1);
  });

  it("returns null when no receipt exists, so the caller keeps its public result", async () => {
    const db = new FakeDb();
    seedDb(db);
    await expect(resumeBondRefinanceByKey(db as unknown as Db, "refi-absent", corpId)).resolves
      .toBeNull();
  });

  it("returns null for a completed receipt: genuinely finished work stays historical", async () => {
    const db = new FakeDb();
    seedDb(db);
    const key = "refi-resume-completed";
    await applyBondRefinanceSpend(
      db as unknown as Db,
      refinanceInput({ idempotencyKey: key, outcome: { ...REFINANCE_OUTCOME } })
    );
    await expect(resumeBondRefinanceByKey(db as unknown as Db, key, corpId)).resolves.toBeNull();
  });

  it("returns null for an in-progress receipt with no usable plan or outcome", async () => {
    // Crash on the plan write: the claim landed but nothing applied yet.
    const db = new FakeDb();
    seedDb(db);
    const key = "refi-resume-noplan";
    db.crashAfterWrites = 1;
    await expect(
      applyBondRefinanceSpend(db as unknown as Db, refinanceInput({ idempotencyKey: key }))
    ).rejects.toThrow("INJECTED_CRASH");
    await expect(resumeBondRefinanceByKey(db as unknown as Db, key, corpId)).resolves.toBeNull();

    // A stored plan without a persisted outcome cannot report an attempt.
    const db2 = new FakeDb();
    seedDb(db2);
    const key2 = "refi-resume-nooutcome";
    db2.crashAfterWrites = 4;
    await expect(
      applyBondRefinanceSpend(db2 as unknown as Db, refinanceInput({ idempotencyKey: key2 }))
    ).rejects.toThrow("INJECTED_CRASH");
    await expect(resumeBondRefinanceByKey(db2 as unknown as Db, key2, corpId)).resolves.toBeNull();
  });

  it("throws terminal for a settled failed receipt", async () => {
    const db = new FakeDb();
    seedDb(db);
    corpDoc(db).bondDefaultRefinanceCount = MAX_BOND_DEFAULT_REFINANCES;
    const key = "refi-resume-terminal";
    await expect(
      applyBondRefinanceSpend(db as unknown as Db, refinanceInput({ idempotencyKey: key }))
    ).rejects.toThrow(new RegExp(`^${BOND_REFINANCE_COUNT}`));
    await expect(resumeBondRefinanceByKey(db as unknown as Db, key, corpId)).rejects.toBeInstanceOf(
      MoneyFlowTerminalError
    );
  });

  it("throws conflict when the stored attempt names a different corporation", async () => {
    const db = new FakeDb();
    seedDb(db);
    const key = "refi-resume-corpmismatch";
    db.crashAfterWrites = 4;
    await expect(
      applyBondRefinanceSpend(
        db as unknown as Db,
        refinanceInput({ idempotencyKey: key, outcome: { ...REFINANCE_OUTCOME } })
      )
    ).rejects.toThrow("INJECTED_CRASH");
    await expect(
      resumeBondRefinanceByKey(db as unknown as Db, key, new ObjectId())
    ).rejects.toBeInstanceOf(MoneyFlowKeyConflictError);

    // The mismatch also holds on a completed receipt (fail closed on
    // cross-corp key reuse even after settlement).
    const db2 = new FakeDb();
    seedDb(db2);
    const key2 = "refi-resume-completed-mismatch";
    await applyBondRefinanceSpend(
      db2 as unknown as Db,
      refinanceInput({ idempotencyKey: key2, outcome: { ...REFINANCE_OUTCOME } })
    );
    await expect(
      resumeBondRefinanceByKey(db2 as unknown as Db, key2, new ObjectId())
    ).rejects.toBeInstanceOf(MoneyFlowKeyConflictError);
  });
});
