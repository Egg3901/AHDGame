import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import {
  MoneyFlowKeyConflictError,
  NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION,
} from "@/lib/db/nonAtomicMoneyFlow";
import {
  buildShareFillMoneyFingerprint,
  buildShareFillMoneyKey,
  executeShareFillMoneyFlow,
  recoverShareFillMoneyByFillKey,
  recoverShareFillMoneyOrphans,
  SHARE_FILL_MONEY_INSUFFICIENT_FUNDS,
  SHARE_FILL_MONEY_LIQUIDITY_SHARES,
  SHARE_FILL_MONEY_ORPHAN_MIN_AGE_MS,
  SHARE_FILL_MONEY_SELLER_SHARES,
  type ShareFillMoneyPlan,
} from "./shareFillMoney";

vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn().mockRejectedValue(new Error("no-real-db-in-share-fill-money-tests")),
  getMongoClient: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Stateful in-memory fake honoring exactly the operators the share-fill money
// flow emits: keyed `$inc` legs with `$gte` + `$ne: key` guards, keyed
// positional cap-table updates (`shareholders.$`) with `$elemMatch`
// sufficiency or dotted-array equality guards, inc/push/inc credit triples
// under one subkey, fund `holdings.$` updates with the same shapes, plain
// `$pull` zero-row cleanup, `$push` key records in `$each`+`$slice` form,
// receipt insert/find/update with dotted `$set` paths, and duplicate-key
// (11000) receipt inserts. An injected fault on the Nth write models a
// process death between the corresponding sequential Mongo writes: the write
// never lands and the error propagates with the receipt left `in_progress`,
// exactly like a crash.
// ---------------------------------------------------------------------------

type Doc = Record<string, unknown>;

function docKey(id: unknown): string {
  if (id instanceof ObjectId) return id.toHexString();
  return String(id);
}

function clone<T>(value: T): T {
  if (value instanceof ObjectId) return value;
  if (value instanceof Date) return new Date(value.getTime()) as unknown as T;
  if (Array.isArray(value)) return value.map(clone) as unknown as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clone(v)])) as T;
  }
  return value;
}

function getPath(doc: Doc, path: string): unknown {
  return path.split(".").reduce<unknown>((node, part) => (node as Doc)?.[part], doc);
}

function setPath(doc: Doc, path: string, value: unknown): void {
  const parts = path.split(".");
  let node: Doc = doc;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const part = parts[i]!;
    const next = node[part];
    if (typeof next !== "object" || next === null) node[part] = {};
    node = node[part] as Doc;
  }
  node[parts[parts.length - 1]!] = clone(value);
}

function valueEquals(actual: unknown, expected: unknown): boolean {
  if (actual instanceof ObjectId && expected instanceof ObjectId) return actual.equals(expected);
  if (actual instanceof ObjectId || expected instanceof ObjectId) {
    return docKey(actual) === docKey(expected);
  }
  return actual === expected;
}

function matchesElem(match: Doc, entry: Doc): boolean {
  return Object.entries(match).every(([field, cond]) => {
    const actual = entry[field];
    if (cond && typeof cond === "object" && !Array.isArray(cond) && !(cond instanceof ObjectId)) {
      const ops = cond as Doc;
      if ("$gte" in ops && !((actual as number) >= (ops.$gte as number))) return false;
      if ("$lte" in ops && !((actual as number) <= (ops.$lte as number))) return false;
      if ("$eq" in ops && !valueEquals(actual, ops.$eq)) return false;
      if ("$ne" in ops && valueEquals(actual, ops.$ne)) return false;
      return true;
    }
    return valueEquals(actual, cond);
  });
}

/** Resolve the positional `$` index for an update filter, or -1 when the filter names no element. */
function positionalIndex(doc: Doc, filter: Doc, arrayField: string): number {
  const rows = doc[arrayField];
  if (!Array.isArray(rows)) return -1;
  const elem = filter[arrayField];
  if (elem && typeof elem === "object" && "$elemMatch" in (elem as Doc)) {
    const match = (elem as Doc).$elemMatch as Doc;
    return (rows as Doc[]).findIndex((row) => matchesElem(match, row));
  }
  const dottedPrefix = `${arrayField}.`;
  const dotted = Object.entries(filter).filter(([k]) => k.startsWith(dottedPrefix));
  if (dotted.length > 0) {
    return (rows as Doc[]).findIndex((row) =>
      dotted.every(([k, v]) => valueEquals(row[k.slice(dottedPrefix.length)!], v))
    );
  }
  return -1;
}

function matchesFilter(doc: Doc, filter: Doc): boolean {
  return Object.entries(filter).every(([key, cond]) => {
    if (
      key === "_id" &&
      cond &&
      typeof cond === "object" &&
      !(cond instanceof ObjectId) &&
      !Array.isArray(cond)
    ) {
      // Keyset bounds the rotation scan emits (`$gt` tail, `$lte` wrap head).
      const ops = cond as Doc;
      const actual = String(doc._id);
      if ("$gt" in ops && !(actual > String(ops.$gt))) return false;
      if ("$gte" in ops && !(actual >= String(ops.$gte))) return false;
      if ("$lt" in ops && !(actual < String(ops.$lt))) return false;
      if ("$lte" in ops && !(actual <= String(ops.$lte))) return false;
      if ("$gt" in ops || "$gte" in ops || "$lt" in ops || "$lte" in ops) return true;
    }
    if (key === "_id") return valueEquals(doc._id, cond);
    if (key === "shareholders" || key === "holdings") {
      const rows = (doc[key] as Doc[] | undefined) ?? [];
      if (cond && typeof cond === "object" && "$elemMatch" in (cond as Doc)) {
        return rows.some((row) => matchesElem((cond as Doc).$elemMatch as Doc, row));
      }
      if (cond && typeof cond === "object" && "$not" in (cond as Doc)) {
        const not = (cond as Doc).$not as Doc;
        return !rows.some((row) => matchesElem(not.$elemMatch as Doc, row));
      }
      return false;
    }
    if (key === "appliedMoneyFlowKeys") {
      const keys = (doc.appliedMoneyFlowKeys as string[] | undefined) ?? [];
      if (cond && typeof cond === "object" && "$ne" in (cond as Doc)) {
        return !keys.includes((cond as Doc).$ne as string);
      }
      return false;
    }
    if (key.includes(".")) {
      // Dotted array equality (`shareholders.characterId`): match when any element matches.
      const [head, ...rest] = key.split(".");
      if ((head === "shareholders" || head === "holdings") && rest.length === 1) {
        const rows = (doc[head] as Doc[] | undefined) ?? [];
        return rows.some((row) => valueEquals(row[rest[0]!], cond));
      }
      const actual = getPath(doc, key);
      if (cond && typeof cond === "object" && "$gte" in (cond as Doc)) {
        return (actual as number) >= ((cond as Doc).$gte as number);
      }
      return valueEquals(actual, cond);
    }
    const actual = doc[key];
    if (cond && typeof cond === "object" && !(cond instanceof ObjectId) && !Array.isArray(cond)) {
      const ops = cond as Doc;
      if ("$gte" in ops) return (actual as number) >= (ops.$gte as number);
      if ("$ne" in ops) return !valueEquals(actual, ops.$ne);
      if ("$exists" in ops) {
        return ops.$exists ? actual !== undefined : actual === undefined;
      }
    }
    return valueEquals(actual, cond);
  });
}

interface FakeDb {
  docs: Map<string, Map<string, Doc>>;
  writes: number;
  faultAt: number | null;
}

function makeFakeDb(): FakeDb {
  return { docs: new Map(), writes: 0, faultAt: null };
}

function collName(name: string): string {
  return name;
}

function getColl(db: FakeDb, name: string): Map<string, Doc> {
  let coll = db.docs.get(name);
  if (!coll) {
    coll = new Map();
    db.docs.set(name, coll);
  }
  return coll;
}

function maybeFault(db: FakeDb): void {
  db.writes += 1;
  if (db.faultAt !== null && db.writes === db.faultAt) {
    throw new Error("injected-crash");
  }
}

function applyUpdate(doc: Doc, update: Doc, filter: Doc): void {
  for (const [path, delta] of Object.entries((update.$inc as Doc | undefined) ?? {})) {
    if (path.includes(".$.")) {
      const [arrayField] = path.split(".$.");
      const idx = positionalIndex(doc, filter, arrayField!);
      if (idx < 0) {
        throw new Error("positional operator did not find the match");
      }
      const leaf = path.split(".$.")[1]!;
      const rows = doc[arrayField!] as Doc[];
      rows[idx]![leaf] = ((rows[idx]![leaf] as number) ?? 0) + (delta as number);
    } else {
      setPath(doc, path, ((getPath(doc, path) as number) ?? 0) + (delta as number));
    }
  }
  for (const [path, value] of Object.entries((update.$set as Doc | undefined) ?? {})) {
    if (path.includes(".$.")) {
      const [arrayField] = path.split(".$.");
      const idx = positionalIndex(doc, filter, arrayField!);
      if (idx < 0) {
        throw new Error("positional operator did not find the match");
      }
      const leaf = path.split(".$.")[1]!;
      (doc[arrayField!] as Doc[])[idx]![leaf] = clone(value);
    } else {
      setPath(doc, path, value);
    }
  }
  const push = update.$push as Doc | undefined;
  if (push) {
    for (const [path, spec] of Object.entries(push)) {
      if (path === "appliedMoneyFlowKeys" && spec && typeof spec === "object") {
        const each = (spec as Doc).$each as string[];
        const keys = ((doc.appliedMoneyFlowKeys as string[] | undefined) ?? []).concat(each);
        const slice = (spec as Doc).$slice as number | undefined;
        doc.appliedMoneyFlowKeys = slice !== undefined ? keys.slice(slice) : keys;
      } else if (path === "shareholders" || path === "holdings") {
        (doc[path] as Doc[] | undefined) ?? (doc[path] = [] as unknown as Doc[]);
        (doc[path] as Doc[]).push(clone(spec as Doc));
      }
    }
  }
  const pull = update.$pull as Doc | undefined;
  if (pull) {
    for (const [path, spec] of Object.entries(pull)) {
      const rows = doc[path] as Doc[] | undefined;
      if (Array.isArray(rows)) {
        doc[path] = rows.filter((row) => !matchesElem(spec as Doc, row));
      }
    }
  }
}

function fakeCollection(db: FakeDb, name: string): Record<string, (...args: never[]) => unknown> {
  const coll = () => getColl(db, collName(name));
  return {
    insertOne: async (doc: Doc) => {
      maybeFault(db);
      const key = docKey(doc._id);
      if (coll().has(key)) {
        const err = new Error("duplicate key") as Error & { code?: number };
        err.code = 11000;
        throw err;
      }
      coll().set(key, clone(doc));
      return { insertedId: doc._id };
    },
    findOne: async (filter: Doc) => {
      for (const doc of coll().values()) {
        if (matchesFilter(doc, filter)) return clone(doc);
      }
      return null;
    },
    updateOne: async (filter: Doc, update: Doc) => {
      maybeFault(db);
      for (const doc of coll().values()) {
        if (matchesFilter(doc, filter)) {
          applyUpdate(doc, update, filter);
          return { matchedCount: 1, modifiedCount: 1 };
        }
      }
      return { matchedCount: 0, modifiedCount: 0 };
    },
    find: (filter: Doc) => {
      const rows = [...coll().values()].filter((doc) => matchesFilter(doc, filter));
      const sortRows = (spec: Record<string, 1 | -1>): Doc[] => {
        const [[sortKey, direction]] = Object.entries(spec);
        return [...rows].sort((a, b) => {
          const left = String(getPath(a, sortKey!));
          const right = String(getPath(b, sortKey!));
          const cmp = left < right ? -1 : left > right ? 1 : 0;
          return direction === -1 ? -cmp : cmp;
        });
      };
      return {
        limit: (n: number) => ({
          toArray: async () => clone(rows.slice(0, n)) as Doc[],
        }),
        toArray: async () => clone(rows) as Doc[],
        sort: (spec: Record<string, 1 | -1>) => {
          const sorted = sortRows(spec);
          return {
            toArray: async () => clone(sorted) as Doc[],
            limit: (n: number) => ({
              toArray: async () => clone(sorted.slice(0, n)) as Doc[],
            }),
          };
        },
      };
    },
  };
}

/**
 * In-memory stand-in for a Db handle: collection fakes plus the optional
 * driver identity props (`client` / `databaseName`) the orphan cursor
 * rotation keys on. Everything downstream casts through `as never`, so this
 * only has to describe the fake itself, not the real `Db`.
 */
type FakeDbHandle = {
  collection: (name: string) => Record<string, (...args: never[]) => unknown>;
  client?: object;
  databaseName?: string;
};

function fakeDb(db: FakeDb, overrides?: { client?: object; databaseName?: string }): FakeDbHandle {
  return {
    collection: (name: string) => fakeCollection(db, name),
    // Stable client identity + database name, mirroring the production
    // driver's `Db.client` / `Db.databaseName`. Two wrappers sharing both
    // over one `FakeDb` store model two `getDb()` calls against one world;
    // omitting them models the legacy handle-keyed fake.
    ...(overrides?.client
      ? { client: overrides.client, databaseName: overrides.databaseName ?? "fake-db" }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CORP_ID = new ObjectId();
const FILLER_ID = new ObjectId();
const SELLER_ID = new ObjectId();
const BUYER_CORP_ID = new ObjectId();
const FUND_ID = new ObjectId();

function seedCorp(
  db: FakeDb,
  opts: {
    corpId?: ObjectId;
    liquidCapital?: number;
    shareholders?: Doc[];
    float?: number;
  } = {}
): void {
  getColl(db, "corporations").set(docKey(opts.corpId ?? CORP_ID), {
    _id: opts.corpId ?? CORP_ID,
    liquidCapital: opts.liquidCapital ?? 0,
    publicFloat: opts.float ?? 0,
    shareholders: opts.shareholders ?? [],
  });
}

function seedCharacter(
  db: FakeDb,
  id: ObjectId,
  balance: number,
  collection = "characters",
  field = "currencyBalances.personal.USD"
): void {
  const doc: Doc = { _id: id };
  setPath(doc, field, balance);
  getColl(db, collection).set(docKey(id), doc);
}

function seedFund(db: FakeDb, cashAnchor: number, holdings: Doc[] = []): void {
  getColl(db, "indexFunds").set(docKey(FUND_ID), {
    _id: FUND_ID,
    cashAnchor,
    holdings,
  });
}

function charShares(db: FakeDb, corpId: ObjectId, charId: ObjectId): number {
  const corp = getColl(db, "corporations").get(docKey(corpId));
  const rows = (corp?.shareholders as Doc[] | undefined) ?? [];
  return (rows.find((r) => valueEquals(r.characterId, charId))?.shares as number) ?? 0;
}

function capEntry(db: FakeDb, corpId: ObjectId, field: string, id: ObjectId): Doc | undefined {
  const corp = getColl(db, "corporations").get(docKey(corpId));
  const rows = (corp?.shareholders as Doc[] | undefined) ?? [];
  return rows.find((r) => valueEquals(r[field], id));
}

function walletOf(db: FakeDb, collection: string, id: ObjectId, field: string): number {
  const doc = getColl(db, collection).get(docKey(id));
  return (getPath(doc ?? {}, field) as number) ?? 0;
}

function moneyReceipt(db: FakeDb, fillKey: string): Doc | undefined {
  return getColl(db, NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION).get(`${fillKey}:money`);
}

/**
 * Fixed clock for the orphan age grace: every receipt the periodic pass is
 * expected to touch is backdated to look crashed, not freshly written by a
 * live fill. Freshness is tested explicitly with injected `now` values,
 * never with the real clock.
 */
const NOW = new Date("2026-09-25T12:00:00.000Z");
const AGED_AT = new Date(NOW.getTime() - 10 * 60 * 1000);

function seedMoneyReceipt(state: FakeDb, fillKey: string, plan: ShareFillMoneyPlan): void {
  getColl(state, NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION).set(`${fillKey}:money`, {
    _id: `${fillKey}:money`,
    status: "in_progress",
    fingerprint: buildShareFillMoneyFingerprint(plan),
    shareFillMoneyPlan: clone(plan),
    createdAt: AGED_AT,
    updatedAt: AGED_AT,
  });
}

function backdateMoneyReceipt(state: FakeDb, moneyKey: string, at: Date): void {
  const receipt = getColl(state, NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION).get(moneyKey);
  if (receipt) {
    receipt.createdAt = new Date(at.getTime());
    receipt.updatedAt = new Date(at.getTime());
  }
}

function moneyReceiptStatus(state: FakeDb, moneyKey: string): unknown {
  return getColl(state, NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION).get(moneyKey)?.status;
}

let fillSeq = 0;

function sellPlan(overrides: Partial<ShareFillMoneyPlan> = {}): ShareFillMoneyPlan {
  fillSeq += 1;
  return {
    version: 1,
    fillKey: `fill-${fillSeq}`,
    orderIdHex: new ObjectId().toHexString(),
    corpIdHex: CORP_ID.toHexString(),
    direction: "sell-fill",
    shares: 10,
    turn: 7,
    nowIso: new Date("2026-09-17T12:00:00Z").toISOString(),
    fillerDebit: {
      collection: "characters",
      idHex: FILLER_ID.toHexString(),
      field: "currencyBalances.personal.USD",
      amount: 1000,
    },
    fillerCredit: null,
    sellerDebit: {
      field: "characterId",
      idHex: SELLER_ID.toHexString(),
      pricePerShare: 90,
    },
    buyerCredit: {
      field: "characterId",
      idHex: FILLER_ID.toHexString(),
      pricePerShare: 100,
    },
    fundInventoryDebit: null,
    buyerHoldingsCredit: null,
    sellerProceeds: {
      collection: "characters",
      idHex: SELLER_ID.toHexString(),
      field: "currencyBalances.personal.USD",
      amount: 1000,
    },
    ...overrides,
  };
}

function seedSellBaseline(db: FakeDb): void {
  seedCorp(db, {
    shareholders: [{ characterId: SELLER_ID, shares: 50, avgCostPerShare: 90 }],
  });
  seedCharacter(db, FILLER_ID, 5000);
  seedCharacter(db, SELLER_ID, 200);
}

describe("share-fill keyed money legs", () => {
  let state: FakeDb;
  let db: FakeDbHandle;

  beforeEach(() => {
    state = makeFakeDb();
    db = fakeDb(state);
  });

  it("sell-fill character-to-character moves cash and shares exactly once", async () => {
    seedSellBaseline(state);
    const plan = sellPlan();
    const outcome = await executeShareFillMoneyFlow(db as never, plan);
    expect(outcome.sharesMoved).toBe(10);
    expect(walletOf(state, "characters", FILLER_ID, "currencyBalances.personal.USD")).toBe(4000);
    expect(walletOf(state, "characters", SELLER_ID, "currencyBalances.personal.USD")).toBe(1200);
    expect(charShares(state, CORP_ID, SELLER_ID)).toBe(40);
    expect(charShares(state, CORP_ID, FILLER_ID)).toBe(10);
    expect(capEntry(state, CORP_ID, "characterId", FILLER_ID)?.avgCostPerShare).toBe(100);
    const receipt = moneyReceipt(state, plan.fillKey);
    expect(receipt?.status).toBe("completed");
    expect(outcome.fillerBalanceAfter).toBe(4000);
  });

  it("same-key retry after success is a duplicate with no second movement", async () => {
    seedSellBaseline(state);
    const plan = sellPlan();
    await executeShareFillMoneyFlow(db as never, plan);
    const outcome = await executeShareFillMoneyFlow(db as never, plan);
    expect(outcome.sharesMoved).toBe(10);
    expect(walletOf(state, "characters", FILLER_ID, "currencyBalances.personal.USD")).toBe(4000);
    expect(charShares(state, CORP_ID, FILLER_ID)).toBe(10);
  });

  it("same key with a different fingerprint fails closed", async () => {
    seedSellBaseline(state);
    const plan = sellPlan();
    await executeShareFillMoneyFlow(db as never, plan);
    const altered: ShareFillMoneyPlan = {
      ...plan,
      shares: 11,
      fillerDebit: { ...plan.fillerDebit!, amount: 1100 },
    };
    await expect(executeShareFillMoneyFlow(db as never, altered)).rejects.toBeInstanceOf(
      MoneyFlowKeyConflictError
    );
    expect(walletOf(state, "characters", FILLER_ID, "currencyBalances.personal.USD")).toBe(4000);
  });

  it("insufficient filler funds settles failed with nothing moved", async () => {
    seedSellBaseline(state);
    seedCharacter(state, FILLER_ID, 10);
    const plan = sellPlan();
    await expect(executeShareFillMoneyFlow(db as never, plan)).rejects.toThrow(
      SHARE_FILL_MONEY_INSUFFICIENT_FUNDS
    );
    const receipt = moneyReceipt(state, plan.fillKey);
    expect(receipt?.status).toBe("failed");
    expect(charShares(state, CORP_ID, SELLER_ID)).toBe(50);
    expect(walletOf(state, "characters", SELLER_ID, "currencyBalances.personal.USD")).toBe(200);
  });

  it("lost seller-share race compensates the filler debit", async () => {
    seedSellBaseline(state);
    // Seller holds fewer than the fill needs: filler debit lands, seller debit rejects.
    seedCorp(state, {
      shareholders: [{ characterId: SELLER_ID, shares: 4, avgCostPerShare: 90 }],
    });
    seedCharacter(state, FILLER_ID, 5000);
    seedCharacter(state, SELLER_ID, 200);
    const plan = sellPlan();
    await expect(executeShareFillMoneyFlow(db as never, plan)).rejects.toThrow(
      SHARE_FILL_MONEY_SELLER_SHARES
    );
    expect(walletOf(state, "characters", FILLER_ID, "currencyBalances.personal.USD")).toBe(5000);
    expect(walletOf(state, "characters", SELLER_ID, "currencyBalances.personal.USD")).toBe(200);
    expect(charShares(state, CORP_ID, FILLER_ID)).toBe(0);
    const receipt = moneyReceipt(state, plan.fillKey);
    expect(receipt?.status).toBe("compensated");
  });

  it("crash after every money write converges on resume-from-key with no double move", async () => {
    // Baseline write count for a clean sell-fill, then replay the fill once
    // per crash point and assert identical end state every time.
    seedSellBaseline(state);
    const probe = sellPlan();
    await executeShareFillMoneyFlow(db as never, probe);
    const totalWrites = state.writes;
    expect(totalWrites).toBeGreaterThan(3);

    const expectedFiller = walletOf(
      state,
      "characters",
      FILLER_ID,
      "currencyBalances.personal.USD"
    );
    const expectedSeller = walletOf(
      state,
      "characters",
      SELLER_ID,
      "currencyBalances.personal.USD"
    );

    for (let crashAt = 1; crashAt <= totalWrites; crashAt += 1) {
      const trial = makeFakeDb();
      seedCorp(trial, {
        shareholders: [{ characterId: SELLER_ID, shares: 50, avgCostPerShare: 90 }],
      });
      seedCharacter(trial, FILLER_ID, 5000);
      seedCharacter(trial, SELLER_ID, 200);
      const trialDb = fakeDb(trial);
      const plan = sellPlan();
      trial.faultAt = crashAt;
      const attempt = await executeShareFillMoneyFlow(trialDb as never, plan)
        .then(() => "ok" as const)
        .catch((err: Error) => err);
      // Restart from only the fill key: the stored plan drives recovery.
      trial.faultAt = null;
      if (crashAt === 1) {
        // Claim insert died: no receipt, nothing moved.
        expect(attempt).toBeInstanceOf(Error);
        const result = await recoverShareFillMoneyByFillKey(trialDb as never, plan.fillKey);
        expect(result.action).toBe("skipped-missing");
        expect(charShares(trial, CORP_ID, SELLER_ID)).toBe(50);
        continue;
      }
      if (crashAt === 2) {
        // Plan store died: plan-less receipt settles failed, nothing moved.
        const result = await recoverShareFillMoneyByFillKey(trialDb as never, plan.fillKey);
        expect(result.action).toBe("settled-failed-no-plan");
        expect(charShares(trial, CORP_ID, SELLER_ID)).toBe(50);
        expect(walletOf(trial, "characters", FILLER_ID, "currencyBalances.personal.USD")).toBe(
          5000
        );
        continue;
      }
      if (attempt !== "ok") expect((attempt as Error).message).toBe("injected-crash");
      const result = await recoverShareFillMoneyByFillKey(trialDb as never, plan.fillKey);
      // A crash after settle-completed (outcome store, audit bridge) or on a
      // read recovers as a settled skip; money already moved exactly once.
      expect(["money-recovered", "skipped-settled"]).toContain(result.action);
      expect(walletOf(trial, "characters", FILLER_ID, "currencyBalances.personal.USD")).toBe(
        expectedFiller
      );
      expect(walletOf(trial, "characters", SELLER_ID, "currencyBalances.personal.USD")).toBe(
        expectedSeller
      );
      expect(charShares(trial, CORP_ID, SELLER_ID)).toBe(40);
      expect(charShares(trial, CORP_ID, FILLER_ID)).toBe(10);
      const receipt = moneyReceipt(trial, plan.fillKey);
      expect(receipt?.status).toBe("completed");
    }
  });

  it("competing retries under one key move money once", async () => {
    seedSellBaseline(state);
    const plan = sellPlan();
    const [first, second] = await Promise.all([
      executeShareFillMoneyFlow(db as never, plan),
      executeShareFillMoneyFlow(db as never, plan),
    ]);
    expect(first.sharesMoved).toBe(10);
    expect(second.sharesMoved).toBe(10);
    expect(walletOf(state, "characters", FILLER_ID, "currencyBalances.personal.USD")).toBe(4000);
    expect(charShares(state, CORP_ID, FILLER_ID)).toBe(10);
  });

  it("partial then final fills accumulate without double-claiming the debit", async () => {
    seedSellBaseline(state);
    const first = sellPlan({ shares: 6 });
    first.fillerDebit = { ...first.fillerDebit!, amount: 600 };
    first.sellerProceeds = { ...first.sellerProceeds!, amount: 600 };
    await executeShareFillMoneyFlow(db as never, first);
    const second = sellPlan({
      shares: 4,
      fillerDebit: { ...first.fillerDebit!, amount: 400 },
      sellerProceeds: { ...first.sellerProceeds!, amount: 400 },
    });
    await executeShareFillMoneyFlow(db as never, second);
    expect(walletOf(state, "characters", FILLER_ID, "currencyBalances.personal.USD")).toBe(4000);
    expect(charShares(state, CORP_ID, SELLER_ID)).toBe(40);
    expect(charShares(state, CORP_ID, FILLER_ID)).toBe(10);
  });
});

describe("share-fill money actor variants", () => {
  let state: FakeDb;
  let db: FakeDbHandle;

  beforeEach(() => {
    state = makeFakeDb();
    db = fakeDb(state);
  });

  it("sell-fill corporation filler buys from a character seller", async () => {
    seedCorp(state, {
      shareholders: [{ characterId: SELLER_ID, shares: 50, avgCostPerShare: 90 }],
    });
    seedCorp(state, { corpId: BUYER_CORP_ID, liquidCapital: 9000 });
    seedCharacter(state, SELLER_ID, 200);
    const plan = sellPlan({
      fillerDebit: {
        collection: "corporations",
        idHex: BUYER_CORP_ID.toHexString(),
        field: "liquidCapital",
        amount: 1100,
      },
      buyerCredit: {
        field: "corporationId",
        idHex: BUYER_CORP_ID.toHexString(),
        pricePerShare: 100,
      },
    });
    const outcome = await executeShareFillMoneyFlow(db as never, plan);
    expect(outcome.sharesMoved).toBe(10);
    expect(walletOf(state, "corporations", BUYER_CORP_ID, "liquidCapital")).toBe(7900);
    expect(capEntry(state, CORP_ID, "corporationId", BUYER_CORP_ID)?.shares).toBe(10);
    expect(charShares(state, CORP_ID, SELLER_ID)).toBe(40);
    expect(outcome.fillerBalanceAfter).toBe(7900);
  });

  it("sell-fill corporation filler with insufficient treasury settles failed", async () => {
    seedCorp(state, {
      shareholders: [{ characterId: SELLER_ID, shares: 50, avgCostPerShare: 90 }],
    });
    seedCorp(state, { corpId: BUYER_CORP_ID, liquidCapital: 5 });
    seedCharacter(state, SELLER_ID, 200);
    const plan = sellPlan({
      fillerDebit: {
        collection: "corporations",
        idHex: BUYER_CORP_ID.toHexString(),
        field: "liquidCapital",
        amount: 1100,
      },
      buyerCredit: {
        field: "corporationId",
        idHex: BUYER_CORP_ID.toHexString(),
        pricePerShare: 100,
      },
    });
    await expect(executeShareFillMoneyFlow(db as never, plan)).rejects.toThrow(
      SHARE_FILL_MONEY_INSUFFICIENT_FUNDS
    );
    expect(charShares(state, CORP_ID, SELLER_ID)).toBe(50);
    expect(walletOf(state, "corporations", BUYER_CORP_ID, "liquidCapital")).toBe(5);
  });

  it("sell-fill into a fund placer debits inventory dual-ledger and credits cashAnchor", async () => {
    seedCorp(state, {
      shareholders: [{ fundId: FUND_ID, shares: 60, avgCostPerShare: 95 }],
    });
    seedCharacter(state, FILLER_ID, 5000);
    seedCharacter(state, SELLER_ID, 200);
    seedFund(state, 300, [{ corporationId: CORP_ID, shares: 60, avgCostPerShareAnchor: 95 }]);
    const plan = sellPlan({
      sellerDebit: null,
      fundInventoryDebit: { fundIdHex: FUND_ID.toHexString(), pricePerShareAnchor: 100 },
      sellerProceeds: {
        collection: "indexFunds",
        idHex: FUND_ID.toHexString(),
        field: "cashAnchor",
        amount: 1000,
      },
    });
    await executeShareFillMoneyFlow(db as never, plan);
    expect(capEntry(state, CORP_ID, "fundId", FUND_ID)?.shares).toBe(50);
    expect(walletOf(state, "indexFunds", FUND_ID, "cashAnchor")).toBe(1300);
    const holdings = getColl(state, "indexFunds").get(docKey(FUND_ID))?.holdings as Doc[];
    expect(holdings.find((h) => valueEquals(h.corporationId, CORP_ID))?.shares).toBe(50);
    expect(charShares(state, CORP_ID, FILLER_ID)).toBe(10);
    expect(walletOf(state, "characters", FILLER_ID, "currencyBalances.personal.USD")).toBe(4000);
  });

  it("sell-fill against an exhausted liquidity provider compensates the filler", async () => {
    seedCorp(state, {
      shareholders: [{ fundId: FUND_ID, shares: 3, avgCostPerShare: 95 }],
    });
    seedCharacter(state, FILLER_ID, 5000);
    seedCharacter(state, SELLER_ID, 200);
    seedFund(state, 300, [{ corporationId: CORP_ID, shares: 3, avgCostPerShareAnchor: 95 }]);
    const plan = sellPlan({
      sellerDebit: null,
      fundInventoryDebit: { fundIdHex: FUND_ID.toHexString(), pricePerShareAnchor: 100 },
      sellerProceeds: {
        collection: "indexFunds",
        idHex: FUND_ID.toHexString(),
        field: "cashAnchor",
        amount: 1000,
      },
    });
    await expect(executeShareFillMoneyFlow(db as never, plan)).rejects.toThrow(
      SHARE_FILL_MONEY_LIQUIDITY_SHARES
    );
    expect(walletOf(state, "characters", FILLER_ID, "currencyBalances.personal.USD")).toBe(5000);
    expect(charShares(state, CORP_ID, FILLER_ID)).toBe(0);
    expect(walletOf(state, "indexFunds", FUND_ID, "cashAnchor")).toBe(300);
  });

  it("sell-fill with a split liquidity race leaves no partial cap-table leg", async () => {
    // Cap table covers the fill but the holdings ledger is short: the
    // holdings subleg refuses after the cap subleg landed, so the step must
    // reverse its own cap debit before the receipt settles compensated.
    seedCorp(state, {
      shareholders: [{ fundId: FUND_ID, shares: 60, avgCostPerShare: 95 }],
    });
    seedCharacter(state, FILLER_ID, 5000);
    seedCharacter(state, SELLER_ID, 200);
    seedFund(state, 300, [{ corporationId: CORP_ID, shares: 3, avgCostPerShareAnchor: 95 }]);
    const plan = sellPlan({
      sellerDebit: null,
      fundInventoryDebit: { fundIdHex: FUND_ID.toHexString(), pricePerShareAnchor: 100 },
      sellerProceeds: {
        collection: "indexFunds",
        idHex: FUND_ID.toHexString(),
        field: "cashAnchor",
        amount: 1000,
      },
    });
    await expect(executeShareFillMoneyFlow(db as never, plan)).rejects.toThrow(
      SHARE_FILL_MONEY_LIQUIDITY_SHARES
    );
    expect(capEntry(state, CORP_ID, "fundId", FUND_ID)?.shares).toBe(60);
    const holdings = getColl(state, "indexFunds").get(docKey(FUND_ID))?.holdings as Doc[];
    expect(holdings.find((h) => valueEquals(h.corporationId, CORP_ID))?.shares).toBe(3);
    expect(walletOf(state, "characters", FILLER_ID, "currencyBalances.personal.USD")).toBe(5000);
    expect(walletOf(state, "indexFunds", FUND_ID, "cashAnchor")).toBe(300);
    expect(charShares(state, CORP_ID, FILLER_ID)).toBe(0);
    const receipt = moneyReceipt(state, plan.fillKey);
    expect(receipt?.status).toBe("compensated");
  });

  it("sell-fill imperial filler debits the imperial wallet", async () => {
    seedCorp(state, {
      shareholders: [{ characterId: SELLER_ID, shares: 50, avgCostPerShare: 90 }],
    });
    seedCharacter(state, FILLER_ID, 5000, "imperialCharacters");
    seedCharacter(state, SELLER_ID, 200);
    const plan = sellPlan({
      fillerDebit: {
        collection: "imperialCharacters",
        idHex: FILLER_ID.toHexString(),
        field: "currencyBalances.personal.USD",
        amount: 1000,
      },
      buyerCredit: {
        field: "imperialCharacterId",
        idHex: FILLER_ID.toHexString(),
        pricePerShare: 100,
      },
    });
    await executeShareFillMoneyFlow(db as never, plan);
    expect(walletOf(state, "imperialCharacters", FILLER_ID, "currencyBalances.personal.USD")).toBe(
      4000
    );
    expect(capEntry(state, CORP_ID, "imperialCharacterId", FILLER_ID)?.shares).toBe(10);
  });

  it("sell-fill skips the seller debit when placement pre-debited the shares", async () => {
    // Corp placer: shares left the placer entry at placement, so the fill
    // moves no seller shares and only credits proceeds.
    seedCorp(state, {
      shareholders: [{ corporationId: BUYER_CORP_ID, shares: 0 }],
    });
    seedCorp(state, { corpId: BUYER_CORP_ID, liquidCapital: 700 });
    seedCharacter(state, FILLER_ID, 5000);
    const plan = sellPlan({
      shares: 10,
      sellerDebit: null,
      sellerProceeds: {
        collection: "corporations",
        idHex: BUYER_CORP_ID.toHexString(),
        field: "liquidCapital",
        amount: 1000,
      },
    });
    await executeShareFillMoneyFlow(db as never, plan);
    expect(walletOf(state, "corporations", BUYER_CORP_ID, "liquidCapital")).toBe(1700);
    expect(charShares(state, CORP_ID, FILLER_ID)).toBe(10);
  });
});

describe("share-fill buy-fill money legs", () => {
  let state: FakeDb;
  let db: FakeDbHandle;

  beforeEach(() => {
    state = makeFakeDb();
    db = fakeDb(state);
  });

  function buyPlan(overrides: Partial<ShareFillMoneyPlan> = {}): ShareFillMoneyPlan {
    fillSeq += 1;
    return {
      version: 1,
      fillKey: `buyfill-${fillSeq}`,
      orderIdHex: new ObjectId().toHexString(),
      corpIdHex: CORP_ID.toHexString(),
      direction: "buy-fill",
      shares: 10,
      turn: 7,
      nowIso: new Date("2026-09-17T12:00:00Z").toISOString(),
      fillerDebit: null,
      fillerCredit: {
        collection: "characters",
        idHex: FILLER_ID.toHexString(),
        field: "currencyBalances.personal.USD",
        amount: 1000,
      },
      sellerDebit: {
        field: "characterId",
        idHex: FILLER_ID.toHexString(),
        pricePerShare: 100,
      },
      buyerCredit: {
        field: "characterId",
        idHex: SELLER_ID.toHexString(),
        pricePerShare: 100,
      },
      fundInventoryDebit: null,
      buyerHoldingsCredit: null,
      sellerProceeds: null,
      ...overrides,
    };
  }

  it("buy-fill moves shares to the buyer and releases escrow exactly once", async () => {
    seedCorp(state, {
      shareholders: [
        { characterId: FILLER_ID, shares: 40, avgCostPerShare: 100 },
        { characterId: SELLER_ID, shares: 5, avgCostPerShare: 80 },
      ],
    });
    seedCharacter(state, FILLER_ID, 100);
    const plan = buyPlan();
    await executeShareFillMoneyFlow(db as never, plan);
    expect(charShares(state, CORP_ID, FILLER_ID)).toBe(30);
    expect(charShares(state, CORP_ID, SELLER_ID)).toBe(15);
    expect(walletOf(state, "characters", FILLER_ID, "currencyBalances.personal.USD")).toBe(1100);
    const receipt = moneyReceipt(state, plan.fillKey);
    expect(receipt?.status).toBe("completed");
  });

  it("buy-fill with insufficient filler shares settles failed before escrow moves", async () => {
    seedCorp(state, {
      shareholders: [{ characterId: FILLER_ID, shares: 2, avgCostPerShare: 100 }],
    });
    seedCharacter(state, FILLER_ID, 100);
    const plan = buyPlan();
    await expect(executeShareFillMoneyFlow(db as never, plan)).rejects.toThrow(
      SHARE_FILL_MONEY_SELLER_SHARES
    );
    expect(walletOf(state, "characters", FILLER_ID, "currencyBalances.personal.USD")).toBe(100);
    expect(charShares(state, CORP_ID, FILLER_ID)).toBe(2);
  });

  it("buy-fill into a fund bid credits cap table and holdings without double escrow", async () => {
    seedCorp(state, {
      shareholders: [
        { characterId: FILLER_ID, shares: 40, avgCostPerShare: 100 },
        { fundId: FUND_ID, shares: 20, avgCostPerShare: 100 },
      ],
    });
    seedCharacter(state, FILLER_ID, 100);
    seedFund(state, 5000, [{ corporationId: CORP_ID, shares: 20, avgCostPerShareAnchor: 100 }]);
    const plan = buyPlan({
      buyerCredit: {
        field: "fundId",
        idHex: FUND_ID.toHexString(),
        pricePerShare: 100,
      },
      buyerHoldingsCredit: {
        fundIdHex: FUND_ID.toHexString(),
        pricePerShareAnchor: 100,
      },
    });
    await executeShareFillMoneyFlow(db as never, plan);
    expect(capEntry(state, CORP_ID, "fundId", FUND_ID)?.shares).toBe(30);
    const holdings = getColl(state, "indexFunds").get(docKey(FUND_ID))?.holdings as Doc[];
    expect(holdings.find((h) => valueEquals(h.corporationId, CORP_ID))?.shares).toBe(30);
    expect(walletOf(state, "characters", FILLER_ID, "currencyBalances.personal.USD")).toBe(1100);
  });

  it("buy-fill into a corporation bid credits the corp entry", async () => {
    seedCorp(state, {
      shareholders: [
        { characterId: FILLER_ID, shares: 40, avgCostPerShare: 100 },
        { corporationId: BUYER_CORP_ID, shares: 7, avgCostPerShare: 90 },
      ],
    });
    seedCharacter(state, FILLER_ID, 100);
    const plan = buyPlan({
      buyerCredit: {
        field: "corporationId",
        idHex: BUYER_CORP_ID.toHexString(),
        pricePerShare: 100,
      },
    });
    await executeShareFillMoneyFlow(db as never, plan);
    expect(capEntry(state, CORP_ID, "corporationId", BUYER_CORP_ID)?.shares).toBe(17);
    expect(walletOf(state, "characters", FILLER_ID, "currencyBalances.personal.USD")).toBe(1100);
  });

  it("crash after every buy-fill write converges with escrow released once", async () => {
    seedCorp(state, {
      shareholders: [{ characterId: FILLER_ID, shares: 40, avgCostPerShare: 100 }],
    });
    seedCharacter(state, FILLER_ID, 100);
    const probe = buyPlan();
    await executeShareFillMoneyFlow(db as never, probe);
    const totalWrites = state.writes;
    expect(totalWrites).toBeGreaterThan(2);
    for (let crashAt = 1; crashAt <= totalWrites; crashAt += 1) {
      const trial = makeFakeDb();
      seedCorp(trial, {
        shareholders: [{ characterId: FILLER_ID, shares: 40, avgCostPerShare: 100 }],
      });
      seedCharacter(trial, FILLER_ID, 100);
      const trialDb = fakeDb(trial);
      const plan = buyPlan();
      trial.faultAt = crashAt;
      const attempt = await executeShareFillMoneyFlow(trialDb as never, plan)
        .then(() => "ok" as const)
        .catch((err: Error) => err);
      trial.faultAt = null;
      if (crashAt === 1) {
        expect(attempt).toBeInstanceOf(Error);
        const result = await recoverShareFillMoneyByFillKey(trialDb as never, plan.fillKey);
        expect(result.action).toBe("skipped-missing");
        expect(charShares(trial, CORP_ID, FILLER_ID)).toBe(40);
        continue;
      }
      if (crashAt === 2) {
        const result = await recoverShareFillMoneyByFillKey(trialDb as never, plan.fillKey);
        expect(result.action).toBe("settled-failed-no-plan");
        expect(charShares(trial, CORP_ID, FILLER_ID)).toBe(40);
        expect(walletOf(trial, "characters", FILLER_ID, "currencyBalances.personal.USD")).toBe(100);
        continue;
      }
      if (attempt !== "ok") expect((attempt as Error).message).toBe("injected-crash");
      const result = await recoverShareFillMoneyByFillKey(trialDb as never, plan.fillKey);
      expect(["money-recovered", "skipped-settled"]).toContain(result.action);
      expect(charShares(trial, CORP_ID, FILLER_ID)).toBe(30);
      expect(walletOf(trial, "characters", FILLER_ID, "currencyBalances.personal.USD")).toBe(1100);
      const receipt = moneyReceipt(trial, plan.fillKey);
      expect(receipt?.status).toBe("completed");
    }
  });

  it("sell then buy round trip nets to zero", async () => {
    seedCorp(state, {
      shareholders: [
        { characterId: SELLER_ID, shares: 50, avgCostPerShare: 90 },
        { characterId: FILLER_ID, shares: 0, avgCostPerShare: 100 },
      ],
    });
    seedCharacter(state, FILLER_ID, 5000);
    seedCharacter(state, SELLER_ID, 200);
    const out = sellPlan();
    await executeShareFillMoneyFlow(db as never, out);
    // Filler sells the same 10 back into the seller's new bid.
    const back = buyPlan({
      sellerDebit: {
        field: "characterId",
        idHex: FILLER_ID.toHexString(),
        pricePerShare: 100,
      },
      buyerCredit: {
        field: "characterId",
        idHex: SELLER_ID.toHexString(),
        pricePerShare: 100,
      },
    });
    await executeShareFillMoneyFlow(db as never, back);
    // Conservation: the sell moves 1000 filler->seller (5000/200 to 4000/1200
    // on 5200 total), and the buy-back releases the placer's 1000 of escrow
    // (locked at bid placement, outside this flow) to the filler while moving
    // the shares back with no proceeds leg. Net in-flow: filler 5000-1000+1000
    // = 5000, seller 200+1000 = 1200, shares restored 50/0. The seller keeps
    // the sell proceeds; only the shares round-trip.
    expect(walletOf(state, "characters", FILLER_ID, "currencyBalances.personal.USD")).toBe(5000);
    expect(walletOf(state, "characters", SELLER_ID, "currencyBalances.personal.USD")).toBe(1200);
    expect(charShares(state, CORP_ID, FILLER_ID)).toBe(0);
    expect(charShares(state, CORP_ID, SELLER_ID)).toBe(50);
  });
});

describe("share-fill money recovery and equivalence", () => {
  let state: FakeDb;
  let db: FakeDbHandle;

  beforeEach(() => {
    state = makeFakeDb();
    db = fakeDb(state);
  });

  it("orphan driver converges money and bridges the audit receipt", async () => {
    seedCorp(state, {
      shareholders: [{ characterId: SELLER_ID, shares: 50, avgCostPerShare: 90 }],
    });
    seedCharacter(state, FILLER_ID, 5000);
    seedCharacter(state, SELLER_ID, 200);
    const plan = sellPlan();
    // Crash mid-flow: plan stored, money partially moved.
    state.faultAt = 3;
    await expect(executeShareFillMoneyFlow(db as never, plan)).rejects.toThrow("injected-crash");
    state.faultAt = null;
    // Backdate the crashed receipt past the orphan age grace: the flow
    // stamps real `new Date()` writes, so without this the pass would
    // (correctly) treat it as a live in-flight fill and skip it.
    backdateMoneyReceipt(state, `${plan.fillKey}:money`, AGED_AT);
    // Seed the audit receipt the route minted before money ran.
    getColl(state, NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION).set(plan.fillKey, {
      _id: plan.fillKey,
      status: "in_progress",
      fingerprint: "audit",
      shareFillPlan: { moneyCommitted: false },
      createdAt: AGED_AT,
      updatedAt: AGED_AT,
    });
    const results = await recoverShareFillMoneyOrphans(db as never, 50, NOW);
    expect(results.some((r) => r.action === "money-recovered")).toBe(true);
    const audit = getColl(state, NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION).get(plan.fillKey);
    expect((audit?.shareFillPlan as Doc)?.moneyCommitted).toBe(true);
    expect(walletOf(state, "characters", FILLER_ID, "currencyBalances.personal.USD")).toBe(4000);
    expect(charShares(state, CORP_ID, FILLER_ID)).toBe(10);
  });

  it("orphan driver settles plan-less receipts failed without guessing", async () => {
    getColl(state, NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION).set("orphan:money", {
      _id: "orphan:money",
      status: "in_progress",
      fingerprint: "x",
      shareFillMoneyPlan: { version: 999 },
      createdAt: AGED_AT,
      updatedAt: AGED_AT,
    });
    const results = await recoverShareFillMoneyOrphans(db as never, 50, NOW);
    expect(results).toHaveLength(1);
    expect(results[0]?.action).toBe("settled-failed-no-plan");
  });

  it("money key and fingerprint derive deterministically from the plan", async () => {
    const plan = sellPlan();
    expect(buildShareFillMoneyKey(plan.fillKey)).toBe(`${plan.fillKey}:money`);
    expect(buildShareFillMoneyFingerprint(plan)).toBe(buildShareFillMoneyFingerprint({ ...plan }));
    const altered = sellPlan({ ...plan, shares: plan.shares + 1 });
    expect(buildShareFillMoneyFingerprint(altered)).not.toBe(buildShareFillMoneyFingerprint(plan));
  });

  it("executed-then-resumed equals resumed-only end state (restart equivalence)", async () => {
    const runOnce = async (crashAt: number | null) => {
      const trial = makeFakeDb();
      seedCorp(trial, {
        shareholders: [{ characterId: SELLER_ID, shares: 50, avgCostPerShare: 90 }],
      });
      seedCharacter(trial, FILLER_ID, 5000);
      seedCharacter(trial, SELLER_ID, 200);
      const trialDb = fakeDb(trial);
      const plan = sellPlan();
      // Same fill key on every run so each execution is the same attempt.
      plan.fillKey = "restart-equivalence";
      if (crashAt !== null) {
        trial.faultAt = crashAt;
        await expect(executeShareFillMoneyFlow(trialDb as never, plan)).rejects.toThrow(
          "injected-crash"
        );
        trial.faultAt = null;
      } else {
        await executeShareFillMoneyFlow(trialDb as never, plan);
      }
      const first = await recoverShareFillMoneyByFillKey(trialDb as never, plan.fillKey);
      // A second recovery is a settled skip, not a second movement.
      const again = await recoverShareFillMoneyByFillKey(trialDb as never, plan.fillKey);
      expect(again.action).toBe("skipped-settled");
      return { trial, first, again };
    };
    // Uncrashed execution converges, and both recoveries are settled skips.
    const direct = await runOnce(null);
    expect(direct.first.action).toBe("skipped-settled");
    // A crash before the plan lands is not recoverable: no plan means no
    // amounts to replay, so the first recovery settles failed with nothing
    // moved and the second is a settled skip. This end state is intentionally
    // NOT equal to direct; the route settles the attempt failed and a new key
    // retries the fill.
    const planless = await runOnce(2);
    expect(planless.first.action).toBe("settled-failed-no-plan");
    expect(walletOf(planless.trial, "characters", FILLER_ID, "currencyBalances.personal.USD")).toBe(
      5000
    );
    expect(walletOf(planless.trial, "characters", SELLER_ID, "currencyBalances.personal.USD")).toBe(
      200
    );
    expect(charShares(planless.trial, CORP_ID, SELLER_ID)).toBe(50);
    expect(charShares(planless.trial, CORP_ID, FILLER_ID)).toBe(0);
    // A crash after the plan lands (write 3 is the filler-debit leg) replays
    // from the stored plan to the exact direct end state.
    const resumed = await runOnce(3);
    expect(["money-recovered", "skipped-settled"]).toContain(resumed.first.action);
    for (const trial of [direct.trial, resumed.trial]) {
      expect(walletOf(trial, "characters", FILLER_ID, "currencyBalances.personal.USD")).toBe(4000);
      expect(walletOf(trial, "characters", SELLER_ID, "currencyBalances.personal.USD")).toBe(1200);
      expect(charShares(trial, CORP_ID, FILLER_ID)).toBe(10);
    }
  });
});

describe("money orphan scan fairness and age grace", () => {
  let state: FakeDb;
  let db: FakeDbHandle;

  beforeEach(() => {
    state = makeFakeDb();
    db = fakeDb(state);
  });

  function seedMoneyBaseline(target: FakeDb): void {
    seedCorp(target, {
      shareholders: [{ characterId: SELLER_ID, shares: 10000, avgCostPerShare: 90 }],
    });
    seedCharacter(target, FILLER_ID, 1000000);
    seedCharacter(target, SELLER_ID, 200);
  }

  /**
   * Persistently incomplete receipt: a sell-fill plan with no filler debit
   * passes the stored-plan guard but the step builder throws on every pass,
   * so the receipt stays `in_progress` forever with zero writes. A
   * head-of-queue scan burns its whole budget on this prefix every pass.
   */
  function stuckPlan(fillKey: string): ShareFillMoneyPlan {
    return sellPlan({ fillKey, fillerDebit: null });
  }

  function seedWorld(target: FakeDb, prefix: string, stuckCount: number): { stuckKeys: string[] } {
    seedMoneyBaseline(target);
    const stuckKeys: string[] = [];
    for (let i = 0; i < stuckCount; i += 1) {
      const fillKey = `${prefix}-${String(i).padStart(2, "0")}`;
      stuckKeys.push(`${fillKey}:money`);
      seedMoneyReceipt(target, fillKey, stuckPlan(fillKey));
    }
    return { stuckKeys };
  }

  it("reaches a recoverable tail stranded behind more than one page of persistent incomplete receipts", async () => {
    // Starvation regression: 55 permanently-incomplete receipts sort ahead
    // of a recoverable tail. An unsorted `.limit(50)` scan re-reads the same
    // stuck prefix every pass and never reaches it; rotation must.
    const { stuckKeys } = seedWorld(state, "mstarve", 55);
    const tailKey = "mstarve-99-tail";
    seedMoneyReceipt(state, tailKey, sellPlan({ fillKey: tailKey }));

    const first = await recoverShareFillMoneyOrphans(db as never, 50, NOW);
    expect(first).toHaveLength(50);
    expect(first.every((r) => r.action === "money-incomplete")).toBe(true);
    expect(moneyReceiptStatus(state, `${tailKey}:money`)).toBe("in_progress");

    const second = await recoverShareFillMoneyOrphans(db as never, 50, NOW);
    expect(second.length).toBeLessThanOrEqual(50);
    expect(second.find((r) => r.moneyKey === `${tailKey}:money`)?.action).toBe("money-recovered");
    // The tail moved money exactly once; the stuck prefix is untouched.
    expect(walletOf(state, "characters", FILLER_ID, "currencyBalances.personal.USD")).toBe(
      1000000 - 1000
    );
    expect(charShares(state, CORP_ID, FILLER_ID)).toBe(10);
    expect(moneyReceiptStatus(state, stuckKeys[0])).toBe("in_progress");
    expect(moneyReceiptStatus(state, stuckKeys[stuckKeys.length - 1])).toBe("in_progress");
  });

  it("wraps around to the head when the cursor runs past the tail", async () => {
    const { stuckKeys } = seedWorld(state, "mwrap", 60);

    const first = await recoverShareFillMoneyOrphans(db as never, 50, NOW);
    expect(first.map((r) => r.moneyKey)).toEqual(stuckKeys.slice(0, 50));

    // Ten rows sit past the cursor, so the window wraps to the head to fill
    // the budget: the second pass holds both the unseen tail and head rows.
    const second = await recoverShareFillMoneyOrphans(db as never, 50, NOW);
    expect(second).toHaveLength(50);
    const secondKeys = second.map((r) => r.moneyKey);
    expect(secondKeys).toContain(stuckKeys[59]);
    expect(secondKeys).toContain(stuckKeys[0]);
    // Across the two passes every receipt is visited: the second pass holds
    // the unseen tail plus wrapped head rows (re-examination is expected;
    // incomplete receipts never settle).
    const seen = new Set([...first, ...second].map((r) => r.moneyKey));
    expect(seen.size).toBe(stuckKeys.length);
    expect([...seen].sort()).toEqual([...stuckKeys].sort());
  });

  it("shares rotation across Db wrappers for the same client+database", async () => {
    // Production regression: `getDb()` returns a NEW Db wrapper on every
    // call, so cursors keyed by Db handle reset each tick and the scan
    // re-reads the same stuck prefix forever. Two wrappers over one client,
    // database, and store must continue one rotation, not restart it.
    const client = {};
    const shared = makeFakeDb();
    const dbA = fakeDb(shared, { client, databaseName: "gamedb" });
    const dbB = fakeDb(shared, { client, databaseName: "gamedb" });
    const { stuckKeys } = seedWorld(shared, "mshared", 60);

    const first = await recoverShareFillMoneyOrphans(dbA as never, 50, NOW);
    expect(first.map((r) => r.moneyKey)).toEqual(stuckKeys.slice(0, 50));
    // The second tick arrives on a fresh wrapper: it must pick up past the
    // first pass's cursor and reach the unseen tail.
    const second = await recoverShareFillMoneyOrphans(dbB as never, 50, NOW);
    const secondKeys = second.map((r) => r.moneyKey);
    expect(secondKeys).toContain(stuckKeys[59]);
    expect(secondKeys).not.toEqual(stuckKeys.slice(0, 50));
  });

  it("isolates rotation by client and by database (no leakage)", async () => {
    // Advance one world's cursor deep into its queue, then prove neither key
    // component leaks: the same database name on a different client, and a
    // different database name on the same client, both start at their own
    // head and must NOT reach their tail in one bounded pass.
    const client = {};
    const world = makeFakeDb();
    const worldDb = fakeDb(world, { client, databaseName: "gamedb" });
    seedWorld(world, "miso", 60);
    await recoverShareFillMoneyOrphans(worldDb as never, 50, NOW);
    const advanced = await recoverShareFillMoneyOrphans(worldDb as never, 50, NOW);
    expect(advanced.map((r) => r.moneyKey)).toContain("miso-59:money");

    const others: Array<{ store: FakeDb; handle: FakeDbHandle }> = [
      (() => {
        const store = makeFakeDb();
        return { store, handle: fakeDb(store, { client: {}, databaseName: "gamedb" }) };
      })(),
      (() => {
        const store = makeFakeDb();
        return { store, handle: fakeDb(store, { client, databaseName: "otherdb" }) };
      })(),
    ];
    for (const other of others) {
      seedWorld(other.store, "miso", 60);
      const pass = await recoverShareFillMoneyOrphans(other.handle as never, 50, NOW);
      expect(pass).toHaveLength(50);
      expect(pass.map((r) => r.moneyKey)).not.toContain("miso-59:money");
    }
  });

  it("leaves a fresh in-flight receipt untouched and recovers it once it ages", async () => {
    expect(SHARE_FILL_MONEY_ORPHAN_MIN_AGE_MS).toBe(5 * 60 * 1000);
    seedMoneyBaseline(state);
    seedMoneyReceipt(state, "mflight-aged", sellPlan({ fillKey: "mflight-aged" }));
    seedMoneyReceipt(state, "mflight-fresh", sellPlan({ fillKey: "mflight-fresh" }));
    seedMoneyReceipt(state, "mflight-edge", sellPlan({ fillKey: "mflight-edge" }));
    backdateMoneyReceipt(state, "mflight-fresh:money", NOW);
    // Exactly at the grace edge counts as aged (the check is strict `<`).
    backdateMoneyReceipt(
      state,
      "mflight-edge:money",
      new Date(NOW.getTime() - SHARE_FILL_MONEY_ORPHAN_MIN_AGE_MS)
    );

    const first = await recoverShareFillMoneyOrphans(db as never, 50, NOW);
    expect(first).toEqual([
      { moneyKey: "mflight-aged:money", action: "money-recovered" },
      { moneyKey: "mflight-edge:money", action: "money-recovered" },
    ]);
    expect(moneyReceiptStatus(state, "mflight-fresh:money")).toBe("in_progress");
    // Only the two aged fills moved money; the live fill was never re-driven.
    expect(walletOf(state, "characters", FILLER_ID, "currencyBalances.personal.USD")).toBe(
      1000000 - 2 * 1000
    );

    // Ten minutes later the fresh receipt has aged into eligibility and
    // converges; re-recovering the older two moves nothing further (keyed
    // steps converge to already-applied instead of double-moving).
    const later = await recoverShareFillMoneyOrphans(
      db as never,
      50,
      new Date(NOW.getTime() + 10 * 60 * 1000)
    );
    expect(later.find((r) => r.moneyKey === "mflight-fresh:money")?.action).toBe("money-recovered");
    expect(walletOf(state, "characters", FILLER_ID, "currencyBalances.personal.USD")).toBe(
      1000000 - 3 * 1000
    );
  });
});
