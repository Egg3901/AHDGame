import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import {
  applyMilitaryRecruitSpend,
  buildMilitaryRecruitFingerprint,
  MILITARY_RECRUIT_ACTION,
  MILITARY_RECRUIT_APPROPRIATION,
  MILITARY_RECRUIT_MANPOWER,
  MILITARY_RECRUIT_UNIT,
  type MilitaryRecruitSpendInput,
} from "./recruitSpend";
import {
  MoneyFlowKeyConflictError,
  MoneyFlowTerminalError,
  NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION,
  keyedInsertId,
  type MoneyFlowReceipt,
} from "@/lib/db/nonAtomicMoneyFlow";
import { manpowerCeilingFor } from "@/lib/military/manpowerPool";

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

// The ceiling feed is live world state (states population + conscription
// stance). Mock it to a fixed value so clamp tests are deterministic; one
// test below re-enables the real implementation against seeded states.
vi.mock("@/lib/military/manpowerPool", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/military/manpowerPool")>();
  return { ...actual, manpowerCeilingFor: vi.fn(async () => 1_000_000) };
});

// ---------------------------------------------------------------------------
// Stateful in-memory fakes honoring exactly the operators the recruit
// primitive emits ($inc incl. dotted balance fields, $set incl. dotted plan
// paths, $push+$each+$slice key records, $unset; _id equality, $ne-on-keys,
// $gte/$lte/$lt/$exists/$in guards, countryId equality, and the $expr
// uncommitted-appropriation guard), so an injected crash between any two
// writes models a real process death between the corresponding sequential
// Mongo writes.
// ---------------------------------------------------------------------------

type Doc = Record<string, unknown>;

/** structuredClone strips BSON class instances, so clone documents by hand. */
function cloneValue<T>(value: T): T {
  if (value instanceof ObjectId) return new ObjectId(value.toHexString()) as T;
  if (value instanceof Date) return new Date(value.getTime()) as T;
  if (Array.isArray(value)) return value.map(cloneValue) as T;
  if (value && typeof value === "object") {
    const out: Doc = {};
    for (const [k, v] of Object.entries(value)) out[k] = cloneValue(v);
    return out as T;
  }
  return value;
}

function docKey(id: unknown): string {
  if (typeof id === "string") return `s:${id}`;
  if (id instanceof ObjectId) return `o:${id.toHexString()}`;
  return `x:${String(id)}`;
}

function valueEquals(actual: unknown, expected: unknown): boolean {
  if (actual instanceof ObjectId && expected instanceof ObjectId) {
    return actual.equals(expected);
  }
  if (Array.isArray(actual) && Array.isArray(expected)) {
    return actual.length === expected.length && actual.every((v, i) => valueEquals(v, expected[i]));
  }
  return actual === expected;
}

function getPath(doc: Doc, path: string): unknown {
  return path.split(".").reduce<unknown>((node, part) => (node as Doc)?.[part], doc);
}

function setPath(doc: Doc, path: string, value: unknown): void {
  const parts = path.split(".");
  let node = doc;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const part = parts[i]!;
    const next = node[part];
    if (typeof next !== "object" || next === null) node[part] = {};
    node = node[part] as Doc;
  }
  node[parts[parts.length - 1]!] = value;
}

function deletePath(doc: Doc, path: string): void {
  const parts = path.split(".");
  let node = doc;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const next = node[parts[i]!] as Doc | undefined;
    if (typeof next !== "object" || next === null) return;
    node = next;
  }
  delete node[parts[parts.length - 1]!];
}

function evalOperand(doc: Doc, node: unknown): unknown {
  if (typeof node === "string" && node.startsWith("$")) return getPath(doc, node.slice(1));
  if (Array.isArray(node)) return node.map((n) => evalOperand(doc, n));
  if (node && typeof node === "object") {
    const ops = node as Record<string, unknown>;
    if ("$ifNull" in ops) {
      const [expr, fallback] = ops.$ifNull as [unknown, unknown];
      const value = evalOperand(doc, expr);
      return value ?? fallback;
    }
    if ("$subtract" in ops) {
      const [a, b] = (ops.$subtract as [unknown, unknown]).map((n) => evalOperand(doc, n));
      return (a as number) - (b as number);
    }
  }
  return node;
}

function evalExpr(doc: Doc, expr: unknown): boolean {
  const ops = expr as Record<string, unknown>;
  if ("$gte" in ops) {
    const [a, b] = (ops.$gte as [unknown, unknown]).map((n) => evalOperand(doc, n));
    return (a as number) >= (b as number);
  }
  throw new Error("unsupported $expr in fake");
}

function matchesCondition(actual: unknown, condition: unknown): boolean {
  if (condition !== null && typeof condition === "object" && !(condition instanceof ObjectId)) {
    const ops = condition as Record<string, unknown>;
    if ("$ne" in ops) {
      if (Array.isArray(actual)) return !actual.includes(ops.$ne);
      return !valueEquals(actual, ops.$ne);
    }
    if ("$gte" in ops) return typeof actual === "number" && actual >= (ops.$gte as number);
    if ("$lte" in ops) return typeof actual === "number" && actual <= (ops.$lte as number);
    if ("$lt" in ops) return typeof actual === "number" && actual < (ops.$lt as number);
    if ("$gt" in ops) return typeof actual === "number" && actual > (ops.$gt as number);
    if ("$exists" in ops) {
      return ((actual !== undefined) as boolean) === (ops.$exists as boolean);
    }
    if ("$in" in ops) {
      const options = ops.$in as unknown[];
      if (Array.isArray(actual)) return actual.some((v) => options.some((o) => valueEquals(v, o)));
      return options.some((o) => valueEquals(actual, o));
    }
    return false;
  }
  return valueEquals(actual, condition);
}

function matchesFilter(doc: Doc, filter: Doc): boolean {
  for (const [field, condition] of Object.entries(filter)) {
    if (field === "$expr") {
      if (!evalExpr(doc, condition)) return false;
      continue;
    }
    if (field === "_id") {
      if (!matchesCondition(doc._id, condition)) return false;
      continue;
    }
    if (!matchesCondition(getPath(doc, field), condition)) return false;
  }
  return true;
}

class FakeCollection {
  readonly docs = new Map<string, Doc>();

  constructor(private readonly db: FakeDb) {}

  private countWrite(label: string): void {
    this.db.writeCount += 1;
    this.db.writes.push(label);
    if (this.db.writeCount > this.db.crashAfterWrites) {
      throw new Error("INJECTED_CRASH");
    }
  }

  async insertOne(doc: Doc): Promise<{ insertedId: unknown }> {
    this.countWrite(`insert:${this.db.nameOf(this)}`);
    const key = docKey(doc._id);
    if (this.docs.has(key)) {
      const error = new Error("E11000 duplicate key error") as Error & { code: number };
      error.code = 11000;
      throw error;
    }
    this.docs.set(key, cloneValue(doc));
    return { insertedId: doc._id };
  }

  async findOne(filter: Doc, opts?: { projection?: Doc }): Promise<Doc | null> {
    for (const doc of this.docs.values()) {
      if (!matchesFilter(doc, filter)) continue;
      if (!opts?.projection) return cloneValue(doc);
      const out: Doc = { _id: doc._id };
      for (const field of Object.keys(opts.projection)) {
        if (field !== "_id") out[field] = cloneValue(doc[field]);
      }
      return out;
    }
    return null;
  }

  find(filter: Doc = {}): { toArray: () => Promise<Doc[]> } {
    const matched = [...this.docs.values()]
      .filter((doc) => matchesFilter(doc, filter))
      .map((doc) => cloneValue(doc));
    return { toArray: async () => matched };
  }

  async updateOne(
    filter: Doc,
    update: Doc
  ): Promise<{ matchedCount: number; modifiedCount: number }> {
    this.countWrite(`update:${this.db.nameOf(this)}`);
    for (const doc of this.docs.values()) {
      if (!matchesFilter(doc, filter)) continue;
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
      const set = (update.$set ?? {}) as Doc;
      for (const [field, value] of Object.entries(set)) {
        setPath(doc, field, value);
      }
      const unset = (update.$unset ?? {}) as Doc;
      for (const field of Object.keys(unset)) {
        deletePath(doc, field);
      }
      return { matchedCount: 1, modifiedCount: 1 };
    }
    return { matchedCount: 0, modifiedCount: 0 };
  }
}

class FakeDb {
  writeCount = 0;
  writes: string[] = [];
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

  nameOf(collection: FakeCollection): string {
    for (const [name, col] of this.collections) {
      if (col === collection) return name;
    }
    return "?";
  }
}

const memberId = new ObjectId();
const manpowerId = new ObjectId();
const arsenalId = new ObjectId();
const BUDGET_ID = "federal";
const PERSONNEL = 12_000;
const PRICE = 4_160_000_000;
const NEEDED = 4;

const ZERO_STOCK = { ground: 0, naval: 0, air: 0, rocket: 0, space: 0, marine: 0 };

function seedDb(
  db: FakeDb,
  opts: {
    stock?: number;
    grade?: number;
    pool?: number;
    actions?: number;
    balance?: number;
    noArsenal?: boolean;
  } = {}
): void {
  db.collection("cabinetMembers").docs.set(docKey(memberId), {
    _id: memberId,
    countryId: "US",
    positionId: "secretary_of_defense",
    characterId: new ObjectId("000000000000000000000001"),
    ministerialActions: opts.actions ?? 2,
  });
  db.collection("nationalManpower").docs.set(docKey(manpowerId), {
    _id: manpowerId,
    countryId: "US",
    pool: opts.pool ?? 500_000,
    mode: "trained",
  });
  db.collection("federalBudget").docs.set(docKey(BUDGET_ID), {
    _id: BUDGET_ID,
    countryId: "US",
    treasuryBalance: 10_000_000_000,
    gdp: 387_000_000_000,
    defenseAppropriation: {
      balance: opts.balance ?? 10_000_000_000,
      accruedThroughTurn: 0,
      arrearsRatio: 0,
    },
  });
  if (!opts.noArsenal) {
    db.collection("nationalArsenal").docs.set(docKey(arsenalId), {
      _id: arsenalId,
      countryId: "US",
      stock: { ...ZERO_STOCK, ground: opts.stock ?? 9_999 },
      grade: { ...ZERO_STOCK, ground: opts.grade ?? 2 },
    });
  }
  db.collection("states").docs.set("s:US-CA", {
    _id: "US-CA",
    countryId: "US",
    population: 100_000_000,
  });
}

function spendInput(overrides: Partial<MilitaryRecruitSpendInput> = {}): MilitaryRecruitSpendInput {
  const base = {
    countryId: "US" as const,
    memberId,
    actionsBefore: 2,
    manpowerDocId: manpowerId,
    poolBefore: 500_000,
    personnel: PERSONNEL,
    budgetId: BUDGET_ID,
    price: PRICE,
    domain: "ground" as const,
    arsenalDocId: arsenalId,
    neededLots: NEEDED,
    plannedDrawn: NEEDED,
    arsenalGrade: 2,
    unit: {
      branchId: "army",
      name: "3rd Vanguard",
      type: "Infantry Division",
      icon: "infantry",
      basePower: 100,
      upkeepBase: 10,
    },
    createdTurn: 42,
    readyAtTurn: 48,
  };
  const fingerprint =
    overrides.fingerprint ??
    buildMilitaryRecruitFingerprint({
      countryId: base.countryId,
      memberId: base.memberId,
      branchId: base.unit.branchId,
      type: base.unit.type,
      name: base.unit.name,
      createdTurn: base.createdTurn,
      personnel: overrides.personnel ?? base.personnel,
      price: overrides.price ?? base.price,
    });
  return {
    ...base,
    ...overrides,
    fingerprint,
    idempotencyKey: overrides.idempotencyKey ?? `recruit-${Math.random().toString(36).slice(2)}`,
  };
}

function num(db: FakeDb, collection: string, id: ObjectId | string, field: string): number {
  return getPath(db.collection(collection).docs.get(docKey(id))!, field) as number;
}

function receipt(db: FakeDb, key: string): MoneyFlowReceipt {
  const doc = db.collection(NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION).docs.get(docKey(key));
  if (!doc) throw new Error(`missing receipt for ${key}`);
  return doc as unknown as MoneyFlowReceipt;
}

function units(db: FakeDb): Doc[] {
  return [...db.collection("militaryUnits").docs.values()];
}

function storedPlan(db: FakeDb, key: string): Doc {
  return (receipt(db, key) as unknown as Doc).militaryRecruitPlan as Doc;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(manpowerCeilingFor).mockResolvedValue(1_000_000);
});

describe("applyMilitaryRecruitSpend (standalone fallback)", () => {
  it("raises a fully-equipped unit and moves all five resources exactly once", async () => {
    const db = new FakeDb();
    seedDb(db);
    const input = spendInput({ idempotencyKey: "recruit-full" });

    const first = await applyMilitaryRecruitSpend(db as unknown as Db, input);

    expect(first.duplicate).toBe(false);
    expect(first.outcome).toEqual({
      price: PRICE,
      actionsRemaining: 1,
      manpowerRemaining: 488_000,
      appropriationRemaining: 10_000_000_000 - PRICE,
      unitIdHex: keyedInsertId("recruit-full", "military-recruit").toHexString(),
    });
    // The five mutations: action, manpower, appropriation, arsenal, unit row.
    expect(num(db, "cabinetMembers", memberId, "ministerialActions")).toBe(1);
    expect(num(db, "nationalManpower", manpowerId, "pool")).toBe(488_000);
    expect(num(db, "federalBudget", BUDGET_ID, "defenseAppropriation.balance")).toBe(
      10_000_000_000 - PRICE
    );
    expect(num(db, "nationalArsenal", arsenalId, "stock.ground")).toBe(9_999 - NEEDED);
    expect(units(db)).toHaveLength(1);
    expect(units(db)[0]).toMatchObject({
      _id: keyedInsertId("recruit-full", "military-recruit"),
      countryId: "US",
      branchId: "army",
      domain: "ground",
      name: "3rd Vanguard",
      type: "Infantry Division",
      posture: "standard",
      techTier: 2,
      personnel: PERSONNEL,
      readiness: 70,
      vet: 1,
      xp: 0,
      equipment: { firepower: 3, protection: 3, support: 3 },
      drill: null,
      theaterId: "reserve",
      assignedGeneralId: null,
      createdTurn: 42,
      readyAtTurn: 48,
    });
    expect(receipt(db, "recruit-full").status).toBe("completed");
    // The degraded path resolved full: pinned on the plan for retry stability.
    expect(storedPlan(db, "recruit-full").drawnLots).toBe(NEEDED);
  });

  it("raises a hollow unit when no arsenal document exists, with no arsenal write", async () => {
    const db = new FakeDb();
    seedDb(db, { noArsenal: true });
    const input = spendInput({
      idempotencyKey: "recruit-hollow",
      arsenalDocId: null,
      plannedDrawn: 0,
      arsenalGrade: 0,
    });

    const first = await applyMilitaryRecruitSpend(db as unknown as Db, input);

    expect(first.duplicate).toBe(false);
    expect(units(db)).toHaveLength(1);
    expect(units(db)[0]).toMatchObject({
      techTier: 0,
      equipment: { firepower: 0, protection: 0, support: 0 },
    });
    expect(db.collection("nationalArsenal").docs.size).toBe(0);
    expect(storedPlan(db, "recruit-hollow").drawnLots).toBe(0);
    expect(receipt(db, "recruit-hollow").status).toBe("completed");
  });

  it("degrades tracks fractionally on a partial fill while keeping the full tier", async () => {
    const db = new FakeDb();
    seedDb(db, { stock: 1, grade: 2 });
    const input = spendInput({ idempotencyKey: "recruit-partial", plannedDrawn: 1 });

    await applyMilitaryRecruitSpend(db as unknown as Db, input);

    // Fill 1/4: each track carries 3 * 0.25. Grade/fill stay orthogonal, so
    // the tier is still the full grade-2 stamp.
    expect(units(db)[0]).toMatchObject({
      techTier: 2,
      equipment: { firepower: 0.75, protection: 0.75, support: 0.75 },
    });
    expect(num(db, "nationalArsenal", arsenalId, "stock.ground")).toBe(0);
    expect(storedPlan(db, "recruit-partial").drawnLots).toBe(1);
  });

  it("rounds the issue tier from a fractional grade", async () => {
    const db = new FakeDb();
    seedDb(db, { stock: 9_999, grade: 2.5 });
    const input = spendInput({
      idempotencyKey: "recruit-grade-round",
      arsenalGrade: 2.5,
    });

    await applyMilitaryRecruitSpend(db as unknown as Db, input);

    expect(units(db)[0]).toMatchObject({ techTier: 3 });
  });

  it("draws the live remainder when a concurrent order took the planned lots", async () => {
    const db = new FakeDb();
    // Plan assumed a full store (4 lots); only 2 are actually there.
    seedDb(db, { stock: 2, grade: 1 });
    const input = spendInput({
      idempotencyKey: "recruit-remainder",
      plannedDrawn: 4,
      arsenalGrade: 1,
    });

    await applyMilitaryRecruitSpend(db as unknown as Db, input);

    expect(units(db)[0]).toMatchObject({
      techTier: 1,
      equipment: { firepower: 1.5, protection: 1.5, support: 1.5 },
    });
    expect(num(db, "nationalArsenal", arsenalId, "stock.ground")).toBe(0);
    expect(storedPlan(db, "recruit-remainder").drawnLots).toBe(2);
  });

  it("converges to hollow when the remainder draw also loses its race", async () => {
    const db = new FakeDb();
    seedDb(db, { stock: 5, grade: 2 });
    // Every arsenal write misses: both the planned and the remainder draw
    // report guard-rejected, so the historical partial path reports zero too.
    const arsenals = db.collection("nationalArsenal");
    arsenals.updateOne = (async () => ({
      matchedCount: 0,
      modifiedCount: 0,
    })) as unknown as FakeCollection["updateOne"];
    const input = spendInput({ idempotencyKey: "recruit-drained", plannedDrawn: 4 });

    await applyMilitaryRecruitSpend(db as unknown as Db, input);

    expect(units(db)[0]).toMatchObject({
      techTier: 0,
      equipment: { firepower: 0, protection: 0, support: 0 },
    });
    expect(num(db, "nationalArsenal", arsenalId, "stock.ground")).toBe(5);
    expect(storedPlan(db, "recruit-drained").drawnLots).toBe(0);
  });

  it("converges after a crash at every durable crash point", async () => {
    const probe = new FakeDb();
    seedDb(probe);
    await applyMilitaryRecruitSpend(
      probe as unknown as Db,
      spendInput({ idempotencyKey: "probe" })
    );
    const totalWrites = probe.writeCount;
    expect(totalWrites).toBeGreaterThan(0);

    for (let crashAt = 0; crashAt <= totalWrites; crashAt += 1) {
      const db = new FakeDb();
      seedDb(db);
      const input = spendInput({ idempotencyKey: `recruit-crash-${crashAt}` });
      db.crashAfterWrites = crashAt;
      let firstThrew = false;
      try {
        await applyMilitaryRecruitSpend(db as unknown as Db, input);
      } catch (error) {
        expect((error as Error).message).toBe("INJECTED_CRASH");
        firstThrew = true;
      }
      if (crashAt >= totalWrites) expect(firstThrew).toBe(false);

      db.crashAfterWrites = Number.POSITIVE_INFINITY;
      const retry = await applyMilitaryRecruitSpend(db as unknown as Db, input);

      expect(receipt(db, input.idempotencyKey!).status).toBe("completed");
      expect(retry.outcome).toEqual({
        price: PRICE,
        actionsRemaining: 1,
        manpowerRemaining: 488_000,
        appropriationRemaining: 10_000_000_000 - PRICE,
        unitIdHex: keyedInsertId(input.idempotencyKey!, "military-recruit").toHexString(),
      });
      // Exactly one of everything, no matter where the crash landed.
      expect(num(db, "cabinetMembers", memberId, "ministerialActions")).toBe(1);
      expect(num(db, "nationalManpower", manpowerId, "pool")).toBe(488_000);
      expect(num(db, "federalBudget", BUDGET_ID, "defenseAppropriation.balance")).toBe(
        10_000_000_000 - PRICE
      );
      expect(num(db, "nationalArsenal", arsenalId, "stock.ground")).toBe(9_999 - NEEDED);
      expect(units(db)).toHaveLength(1);
      expect(storedPlan(db, input.idempotencyKey!).drawnLots).toBe(NEEDED);
    }
  });

  it("reconciles live input when the crash predates the plan write", async () => {
    const db = new FakeDb();
    seedDb(db);
    // The claim lands, the plan write dies mid-crash (no settle runs — a
    // real crash runs no code at all): nothing applied yet, so the live
    // input reconciles exactly.
    const input = spendInput({ idempotencyKey: "recruit-no-plan" });
    db.crashAfterWrites = 1;
    await expect(applyMilitaryRecruitSpend(db as unknown as Db, input)).rejects.toThrow(
      "INJECTED_CRASH"
    );
    expect(receipt(db, "recruit-no-plan").status).toBe("in_progress");

    db.crashAfterWrites = Number.POSITIVE_INFINITY;
    const retry = await applyMilitaryRecruitSpend(db as unknown as Db, input);

    expect(retry.duplicate).toBe(true);
    expect(receipt(db, "recruit-no-plan").status).toBe("completed");
    expect(units(db)).toHaveLength(1);
    expect(num(db, "nationalManpower", manpowerId, "pool")).toBe(488_000);
  });

  it("replays a completed key without moving resources again", async () => {
    const db = new FakeDb();
    seedDb(db);
    const input = spendInput({ idempotencyKey: "recruit-replay" });
    const first = await applyMilitaryRecruitSpend(db as unknown as Db, input);

    // A third party moves the appropriation between the attempts: the replay
    // still reports the stored numbers.
    await db
      .collection("federalBudget")
      .updateOne({ _id: BUDGET_ID }, { $inc: { "defenseAppropriation.balance": 999 } });
    const second = await applyMilitaryRecruitSpend(db as unknown as Db, input);

    expect(second.duplicate).toBe(true);
    expect(second.outcome).toEqual(first.outcome);
    expect(num(db, "cabinetMembers", memberId, "ministerialActions")).toBe(1);
    expect(num(db, "nationalManpower", manpowerId, "pool")).toBe(488_000);
    expect(num(db, "federalBudget", BUDGET_ID, "defenseAppropriation.balance")).toBe(
      10_000_000_000 - PRICE + 999
    );
    expect(num(db, "nationalArsenal", arsenalId, "stock.ground")).toBe(9_999 - NEEDED);
    expect(units(db)).toHaveLength(1);
  });

  it("raises one unit for two concurrent same-key attempts", async () => {
    const db = new FakeDb();
    seedDb(db);
    const input = spendInput({ idempotencyKey: "recruit-concurrent" });

    const [a, b] = await Promise.all([
      applyMilitaryRecruitSpend(db as unknown as Db, input),
      applyMilitaryRecruitSpend(db as unknown as Db, { ...input }),
    ]);

    expect([a.duplicate, b.duplicate].sort()).toEqual([false, true]);
    expect(a.outcome).toEqual(b.outcome);
    expect(units(db)).toHaveLength(1);
    expect(num(db, "cabinetMembers", memberId, "ministerialActions")).toBe(1);
    expect(num(db, "nationalManpower", manpowerId, "pool")).toBe(488_000);
    expect(num(db, "federalBudget", BUDGET_ID, "defenseAppropriation.balance")).toBe(
      10_000_000_000 - PRICE
    );
  });

  it("rejects a key reused for a different recruit without spending", async () => {
    const db = new FakeDb();
    seedDb(db);
    const first = spendInput({ idempotencyKey: "recruit-shared" });
    await applyMilitaryRecruitSpend(db as unknown as Db, first);

    const second = spendInput({
      idempotencyKey: "recruit-shared",
      unit: { ...first.unit, name: "4th Vanguard" },
    });
    // The fingerprint names the new unit, so the claim must fail closed.
    second.fingerprint = buildMilitaryRecruitFingerprint({
      countryId: "US",
      memberId,
      branchId: "army",
      type: "Infantry Division",
      name: "4th Vanguard",
      createdTurn: 42,
      personnel: PERSONNEL,
      price: PRICE,
    });

    await expect(applyMilitaryRecruitSpend(db as unknown as Db, second)).rejects.toBeInstanceOf(
      MoneyFlowKeyConflictError
    );
    expect(units(db)).toHaveLength(1);
    expect(num(db, "nationalManpower", manpowerId, "pool")).toBe(488_000);
  });

  it("settles failed with no effect when the action debit loses its race", async () => {
    const db = new FakeDb();
    seedDb(db, { actions: 0 });
    const input = spendInput({ idempotencyKey: "recruit-action-race", actionsBefore: 0 });

    await expect(applyMilitaryRecruitSpend(db as unknown as Db, input)).rejects.toThrow(
      new RegExp(`^${MILITARY_RECRUIT_ACTION}:`)
    );
    expect(receipt(db, "recruit-action-race").status).toBe("failed");
    expect(num(db, "nationalManpower", manpowerId, "pool")).toBe(500_000);
    expect(num(db, "federalBudget", BUDGET_ID, "defenseAppropriation.balance")).toBe(
      10_000_000_000
    );
    expect(units(db)).toHaveLength(0);
  });

  it("compensates the action when the manpower draw loses its race", async () => {
    const db = new FakeDb();
    // The input was built from a stale ample read; the live pool is short.
    seedDb(db, { pool: 5_000 });
    const input = spendInput({ idempotencyKey: "recruit-manpower-race" });

    await expect(applyMilitaryRecruitSpend(db as unknown as Db, input)).rejects.toThrow(
      new RegExp(`^${MILITARY_RECRUIT_MANPOWER}:`)
    );
    expect(receipt(db, "recruit-manpower-race").status).toBe("compensated");
    expect(num(db, "cabinetMembers", memberId, "ministerialActions")).toBe(2);
    expect(num(db, "nationalManpower", manpowerId, "pool")).toBe(5_000);
    expect(num(db, "federalBudget", BUDGET_ID, "defenseAppropriation.balance")).toBe(
      10_000_000_000
    );
    expect(num(db, "nationalArsenal", arsenalId, "stock.ground")).toBe(9_999);
    expect(units(db)).toHaveLength(0);
  });

  it("compensates action and manpower when the appropriation is short", async () => {
    const db = new FakeDb();
    seedDb(db, { balance: 1_000 });
    const input = spendInput({ idempotencyKey: "recruit-appropriation-short" });

    await expect(applyMilitaryRecruitSpend(db as unknown as Db, input)).rejects.toThrow(
      new RegExp(`^${MILITARY_RECRUIT_APPROPRIATION}:`)
    );
    expect(receipt(db, "recruit-appropriation-short").status).toBe("compensated");
    expect(num(db, "cabinetMembers", memberId, "ministerialActions")).toBe(2);
    expect(num(db, "nationalManpower", manpowerId, "pool")).toBe(500_000);
    expect(num(db, "federalBudget", BUDGET_ID, "defenseAppropriation.balance")).toBe(1_000);
    expect(num(db, "nationalArsenal", arsenalId, "stock.ground")).toBe(9_999);
    expect(units(db)).toHaveLength(0);
  });

  it("refuses the appropriation debit against encumbered money", async () => {
    const db = new FakeDb();
    seedDb(db);
    // Balance covers the price, but open contracts encumber all but a dollar.
    const budget = db.collection("federalBudget").docs.get(docKey(BUDGET_ID))!;
    (budget.defenseAppropriation as Doc).encumbered = 10_000_000_000 - 1;
    const input = spendInput({ idempotencyKey: "recruit-encumbered" });

    await expect(applyMilitaryRecruitSpend(db as unknown as Db, input)).rejects.toThrow(
      new RegExp(`^${MILITARY_RECRUIT_APPROPRIATION}:`)
    );
    expect(receipt(db, "recruit-encumbered").status).toBe("compensated");
    expect(num(db, "cabinetMembers", memberId, "ministerialActions")).toBe(2);
    expect(num(db, "nationalManpower", manpowerId, "pool")).toBe(500_000);
  });

  it("compensates the full prefix when the unit insert fails", async () => {
    const db = new FakeDb();
    seedDb(db);
    const unitCol = db.collection("militaryUnits");
    unitCol.insertOne = (async () => {
      throw new Error("insert exploded");
    }) as unknown as FakeCollection["insertOne"];
    const input = spendInput({ idempotencyKey: "recruit-insert-fails" });

    await expect(applyMilitaryRecruitSpend(db as unknown as Db, input)).rejects.toThrow(
      new RegExp(`^${MILITARY_RECRUIT_UNIT}:`)
    );
    expect(receipt(db, "recruit-insert-fails").status).toBe("compensated");
    expect(num(db, "cabinetMembers", memberId, "ministerialActions")).toBe(2);
    expect(num(db, "nationalManpower", manpowerId, "pool")).toBe(500_000);
    expect(num(db, "federalBudget", BUDGET_ID, "defenseAppropriation.balance")).toBe(
      10_000_000_000
    );
    expect(num(db, "nationalArsenal", arsenalId, "stock.ground")).toBe(9_999);
    expect(units(db)).toHaveLength(0);
  });

  it("converges compensation when the crash lands mid-revert", async () => {
    const db = new FakeDb();
    seedDb(db);
    const unitCol = db.collection("militaryUnits");
    unitCol.insertOne = (async () => {
      throw new Error("insert exploded");
    }) as unknown as FakeCollection["insertOne"];
    const input = spendInput({ idempotencyKey: "recruit-crash-revert" });
    // Fail the run once the insert has failed and two reverts have landed.
    const probe = new FakeDb();
    seedDb(probe);
    const probeUnits = probe.collection("militaryUnits");
    probeUnits.insertOne = (async () => {
      throw new Error("insert exploded");
    }) as unknown as FakeCollection["insertOne"];
    try {
      await applyMilitaryRecruitSpend(probe as unknown as Db, spendInput({ idempotencyKey: "p" }));
    } catch {
      // Expected unit-insert failure; the probe only calibrates write counts.
    }
    // Crash right after the insert failure's first revert writes.
    db.crashAfterWrites = probe.writeCount - 2;
    await expect(applyMilitaryRecruitSpend(db as unknown as Db, input)).rejects.toThrow(
      /INJECTED_CRASH/
    );

    db.crashAfterWrites = Number.POSITIVE_INFINITY;
    await expect(applyMilitaryRecruitSpend(db as unknown as Db, input)).rejects.toThrow(
      new RegExp(`^${MILITARY_RECRUIT_UNIT}:`)
    );
    expect(receipt(db, "recruit-crash-revert").status).toBe("compensated");
    expect(num(db, "cabinetMembers", memberId, "ministerialActions")).toBe(2);
    expect(num(db, "nationalManpower", manpowerId, "pool")).toBe(500_000);
    expect(num(db, "federalBudget", BUDGET_ID, "defenseAppropriation.balance")).toBe(
      10_000_000_000
    );
    expect(num(db, "nationalArsenal", arsenalId, "stock.ground")).toBe(9_999);
    expect(units(db)).toHaveLength(0);
  });

  it("fails closed on a settled terminal key: a retry needs a new key", async () => {
    const db = new FakeDb();
    seedDb(db, { balance: 1_000 });
    const input = spendInput({ idempotencyKey: "recruit-terminal" });
    await expect(applyMilitaryRecruitSpend(db as unknown as Db, input)).rejects.toThrow(
      new RegExp(`^${MILITARY_RECRUIT_APPROPRIATION}:`)
    );

    await expect(applyMilitaryRecruitSpend(db as unknown as Db, input)).rejects.toBeInstanceOf(
      MoneyFlowTerminalError
    );
    expect(num(db, "cabinetMembers", memberId, "ministerialActions")).toBe(2);
    expect(units(db)).toHaveLength(0);
  });

  it("clamps the manpower refund at the live ceiling", async () => {
    const db = new FakeDb();
    // Pre-existing excess over the ceiling (a stance downgrade can leave the
    // pool above it): the draw succeeds, but the revert must not refund past
    // the ceiling.
    seedDb(db, { pool: 600_000 });
    vi.mocked(manpowerCeilingFor).mockResolvedValue(595_000);
    const unitCol = db.collection("militaryUnits");
    unitCol.insertOne = (async () => {
      throw new Error("insert exploded");
    }) as unknown as FakeCollection["insertOne"];
    const input = spendInput({
      idempotencyKey: "recruit-clamp",
      poolBefore: 600_000,
    });

    await expect(applyMilitaryRecruitSpend(db as unknown as Db, input)).rejects.toThrow(
      new RegExp(`^${MILITARY_RECRUIT_UNIT}:`)
    );
    // Drew 12k (588k), refunded only the 7k of headroom: back at the ceiling.
    expect(num(db, "nationalManpower", manpowerId, "pool")).toBe(595_000);
  });

  it("refunds manpower through the real ceiling feed", async () => {
    const actual = await vi.importActual<typeof import("@/lib/military/manpowerPool")>(
      "@/lib/military/manpowerPool"
    );
    vi.mocked(manpowerCeilingFor).mockImplementationOnce(actual.manpowerCeilingFor);
    const db = new FakeDb();
    seedDb(db);
    const unitCol = db.collection("militaryUnits");
    unitCol.insertOne = (async () => {
      throw new Error("insert exploded");
    }) as unknown as FakeCollection["insertOne"];
    const input = spendInput({ idempotencyKey: "recruit-real-ceiling" });

    await expect(applyMilitaryRecruitSpend(db as unknown as Db, input)).rejects.toThrow(
      new RegExp(`^${MILITARY_RECRUIT_UNIT}:`)
    );
    // 100M population leaves ample headroom: the full draw comes back.
    expect(num(db, "nationalManpower", manpowerId, "pool")).toBe(500_000);
  });

  it("moves the stored price amount exactly, with no hidden rounding", async () => {
    const db = new FakeDb();
    seedDb(db);
    // Legs move exact stored amounts; rounding to appropriation units happens
    // at the command boundary (mirroring `debitAppropriation`'s Math.round).
    const input = spendInput({ idempotencyKey: "recruit-fractional", price: 100.6 });
    await applyMilitaryRecruitSpend(db as unknown as Db, input);
    expect(num(db, "federalBudget", BUDGET_ID, "defenseAppropriation.balance")).toBe(
      10_000_000_000 - 100.6
    );
  });
});

describe("buildMilitaryRecruitFingerprint", () => {
  it("is stable for the same recruit and distinct across recruits", () => {
    const fields = {
      countryId: "US",
      memberId,
      branchId: "army",
      type: "Infantry Division",
      name: "3rd Vanguard",
      createdTurn: 42,
      personnel: PERSONNEL,
      price: PRICE,
    };
    expect(buildMilitaryRecruitFingerprint(fields)).toBe(buildMilitaryRecruitFingerprint(fields));
    expect(buildMilitaryRecruitFingerprint({ ...fields, name: "4th Vanguard" })).not.toBe(
      buildMilitaryRecruitFingerprint(fields)
    );
    expect(buildMilitaryRecruitFingerprint({ ...fields, price: PRICE + 1 })).not.toBe(
      buildMilitaryRecruitFingerprint(fields)
    );
  });
});
