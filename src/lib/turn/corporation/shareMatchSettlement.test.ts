import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import {
  deriveMoneyFlowKey,
  keyedInsertId,
  NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION,
} from "@/lib/db/nonAtomicMoneyFlow";
import {
  buildShareMatchKey,
  recoverShareMatchByKey,
  recoverShareMatchOrphans,
} from "./shareMatchSettlement";
import { fillPendingShareOrders } from "./shareOrders";

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn().mockRejectedValue(new Error("no-real-db-in-share-match-tests")),
  getMongoClient: vi.fn(),
}));
vi.mock("@/lib/currency/featureFlag", () => ({
  isForexEnabled: vi.fn().mockResolvedValue(false),
}));
vi.mock("@/lib/currency/corporationCapital", () => ({
  anchorToCorpCapital: (amount: number) => amount,
  corpLiquidCapitalToAnchor: (amount: number) => amount,
  fxRateForCorpFromMap: () => 1,
  loadFxRatesByCurrency: vi.fn().mockResolvedValue(new Map()),
  resolveCorpLiquidCurrencyCode: () => "USD",
}));

// ---------------------------------------------------------------------------
// Stateful in-memory fake honoring exactly the operators the matcher and its
// per-match settlement emit: receipt insert/find/update with dotted-$set
// paths and duplicate-key (11000) inserts, order claim filters on exact
// remainder+status, keyed `$inc` legs with `$gte` + `$ne: key` guards, keyed
// positional cap-table updates (`shareholders.$`) with `$elemMatch`
// sufficiency or dotted-array equality guards, inc/push/inc credit triples
// under one subkey, fund `holdings.$` updates with the same shapes, plain
// `$pull` zero-row cleanup, `$push` key records in `$each`+`$slice` form,
// `$in` batch loads, and deterministic history inserts. An injected fault on
// the Nth write models a process death between the corresponding sequential
// Mongo writes: the write never lands and the error propagates, exactly like
// a crash.
// ---------------------------------------------------------------------------

type Doc = Record<string, unknown>;

function docKey(id: unknown): string {
  if (id instanceof ObjectId) return `oid:${id.toHexString()}`;
  return `str:${String(id)}`;
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

/** Resolve the positional `$` index for an update filter, or -1. */
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
  for (const [key, clause] of Object.entries(filter)) {
    if (key === "_id") {
      if (clause && typeof clause === "object" && !(clause instanceof ObjectId)) {
        const ops = clause as Doc;
        if ("$in" in ops) {
          const list = ops.$in as unknown[];
          if (!list.some((id) => valueEquals(doc._id, id))) return false;
          continue;
        }
      }
      if (!valueEquals(doc._id, clause)) return false;
      continue;
    }
    if (key === "shareholders" || key === "holdings") {
      const rows = (doc[key] as Doc[] | undefined) ?? [];
      if (clause && typeof clause === "object" && "$elemMatch" in (clause as Doc)) {
        if (!rows.some((row) => matchesElem((clause as Doc).$elemMatch as Doc, row))) return false;
        continue;
      }
      if (clause && typeof clause === "object" && "$not" in (clause as Doc)) {
        const not = (clause as Doc).$not as Doc;
        if (rows.some((row) => matchesElem(not.$elemMatch as Doc, row))) return false;
        continue;
      }
      return false;
    }
    if (key === "appliedMoneyFlowKeys") {
      const keys = (doc.appliedMoneyFlowKeys as string[] | undefined) ?? [];
      if (clause && typeof clause === "object" && "$ne" in (clause as Doc)) {
        if (keys.includes((clause as Doc).$ne as string)) return false;
        continue;
      }
      return false;
    }
    if (key.includes(".")) {
      const [head, ...rest] = key.split(".");
      if ((head === "shareholders" || head === "holdings") && rest.length === 1) {
        const rows = (doc[head] as Doc[] | undefined) ?? [];
        if (!rows.some((row) => valueEquals(row[rest[0]!], clause))) return false;
        continue;
      }
      const actual = getPath(doc, key);
      if (clause && typeof clause === "object" && !(clause instanceof ObjectId)) {
        const ops = clause as Doc;
        if ("$gte" in ops) {
          if (typeof actual !== "number" || actual < (ops.$gte as number)) return false;
          continue;
        }
      }
      if (!valueEquals(actual, clause)) return false;
      continue;
    }
    const actual = doc[key];
    if (clause && typeof clause === "object" && !(clause instanceof ObjectId) && !Array.isArray(clause)) {
      const ops = clause as Doc;
      if ("$exists" in ops) {
        if ((actual !== undefined) !== ops.$exists) return false;
        continue;
      }
      if ("$gte" in ops) {
        if (typeof actual !== "number" || actual < (ops.$gte as number)) return false;
        continue;
      }
      if ("$ne" in ops) {
        if (valueEquals(actual, ops.$ne)) return false;
        continue;
      }
      return false;
    }
    if (!valueEquals(actual, clause)) return false;
  }
  return true;
}

function resolvePositionalPath(doc: Doc, filter: Doc, path: string): string {
  const dollar = path.indexOf(".$.");
  if (dollar === -1) return path;
  const arrayField = path.slice(0, dollar);
  const rest = path.slice(dollar + 3);
  const idx = positionalIndex(doc, filter, arrayField);
  if (idx === -1) throw new Error(`no-positional-element:${arrayField}`);
  return `${arrayField}.${idx}.${rest}`;
}

function applyUpdate(doc: Doc, filter: Doc, update: Doc): void {
  if (update.$inc) {
    for (const [path, delta] of Object.entries(update.$inc as Doc)) {
      const resolved = resolvePositionalPath(doc, filter, path);
      const current = (getPath(doc, resolved) as number | undefined) ?? 0;
      setPath(doc, resolved, current + (delta as number));
    }
  }
  if (update.$set) {
    for (const [path, value] of Object.entries(update.$set as Doc)) {
      setPath(doc, resolvePositionalPath(doc, filter, path), value);
    }
  }
  if (update.$push) {
    for (const [field, spec] of Object.entries(update.$push as Doc)) {
      if (
        field === "appliedMoneyFlowKeys" &&
        spec &&
        typeof spec === "object" &&
        "$each" in (spec as Doc)
      ) {
        const keys = ((doc.appliedMoneyFlowKeys as string[] | undefined) ?? []).concat(
          (spec as Doc).$each as string[]
        );
        const slice = (spec as Doc).$slice as number | undefined;
        doc.appliedMoneyFlowKeys = typeof slice === "number" && slice < 0 ? keys.slice(slice) : keys;
        continue;
      }
      const rows = doc[field];
      if (!Array.isArray(rows)) throw new Error(`push-target-not-array:${field}`);
      (rows as Doc[]).push(clone(spec as Doc));
    }
  }
  if (update.$pull) {
    for (const [field, criteria] of Object.entries(update.$pull as Doc)) {
      const rows = doc[field];
      if (!Array.isArray(rows)) continue;
      doc[field] = (rows as Doc[]).filter((row) => !matchesElem(criteria as Doc, row));
    }
  }
}

interface FakeDb {
  db: Db;
  faults: { crashAtWrite: number | null };
  writes: number;
  seed: (collection: string, doc: Doc) => void;
  docs: (collection: string) => Doc[];
  findOne: (collection: string, filter?: Doc) => Promise<Doc | null>;
}

const RECEIPTS = NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION;

function createFakeDb(): FakeDb {
  const collections = new Map<string, Map<string, Doc>>();
  const faults = { crashAtWrite: null as number | null };
  const state = { writes: 0 };

  function store(name: string): Map<string, Doc> {
    let entry = collections.get(name);
    if (!entry) {
      entry = new Map();
      collections.set(name, entry);
    }
    return entry;
  }

  function beforeWrite(): void {
    state.writes += 1;
    if (faults.crashAtWrite !== null && state.writes >= faults.crashAtWrite) {
      throw new Error("injected-crash-before-write-landed");
    }
  }

  function coll(name: string) {
    const docs = store(name);
    return {
      async insertOne(doc: Doc) {
        beforeWrite();
        const key = docKey(doc._id);
        if (docs.has(key)) {
          const err = new Error("duplicate key") as Error & { code: number };
          err.code = 11000;
          throw err;
        }
        docs.set(key, clone(doc));
        return { insertedId: doc._id };
      },
      async findOne(filter: Doc = {}) {
        for (const doc of docs.values()) {
          if (matchesFilter(doc, filter)) return clone(doc);
        }
        return null;
      },
      async updateOne(filter: Doc, update: Doc) {
        beforeWrite();
        for (const doc of docs.values()) {
          if (!matchesFilter(doc, filter)) continue;
          applyUpdate(doc, filter, update);
          return { matchedCount: 1, modifiedCount: 1 };
        }
        return { matchedCount: 0, modifiedCount: 0 };
      },
      find(filter: Doc = {}) {
        const all = [...docs.values()].filter((doc) => matchesFilter(doc, filter));
        const cursor = {
          async toArray() {
            return all.map(clone);
          },
          limit(n: number) {
            return {
              async toArray() {
                return all.slice(0, n).map(clone);
              },
            };
          },
          project() {
            return {
              async toArray() {
                return all.map(clone);
              },
            };
          },
        };
        return cursor;
      },
    };
  }

  const fake: FakeDb = {
    db: { collection: (name: string) => coll(name) } as unknown as Db,
    faults,
    get writes() {
      return state.writes;
    },
    seed(collectionName: string, doc: Doc) {
      store(collectionName).set(docKey(doc._id), clone(doc));
    },
    docs(collectionName: string) {
      return [...(collections.get(collectionName)?.values() ?? [])].map(clone);
    },
    async findOne(collectionName: string, filter: Doc = {}) {
      return coll(collectionName).findOne(filter);
    },
  };
  return fake;
}

let fake: FakeDb;
beforeEach(() => {
  fake = createFakeDb();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Scenario seeds (single-currency world: identity FX, forex off).
// ---------------------------------------------------------------------------

const TURN = 42;
const NOW = new Date("2026-03-01T00:00:00Z");
const PRICE = 10;

function seedCorp(opts: {
  float: number;
  treasury: number;
  holders?: { characterId?: ObjectId; fundId?: ObjectId; shares: number }[];
}): ObjectId {
  const corpId = new ObjectId();
  fake.seed("corporations", {
    _id: corpId,
    name: "Match Corp",
    sharePrice: PRICE,
    fundamentalSharePrice: PRICE,
    publicFloat: opts.float,
    totalShares: 1000,
    shareholders: opts.holders ?? [],
    liquidCapital: opts.treasury,
    liquidCurrencyCode: "USD",
    countryId: "US",
  });
  return corpId;
}

function seedChar(cash: number): ObjectId {
  const charId = new ObjectId();
  fake.seed("characters", { _id: charId, name: "Trader", countryId: "US", cashOnHand: cash });
  return charId;
}

function seedBuyOrder(opts: {
  corpId: ObjectId;
  charId?: ObjectId;
  fundId?: ObjectId;
  shares: number;
  limit: number;
}): ObjectId {
  const orderId = new ObjectId();
  fake.seed("shareOrders", {
    _id: orderId,
    corporationId: opts.corpId,
    ...(opts.charId ? { characterId: opts.charId } : {}),
    ...(opts.fundId ? { placerFundId: opts.fundId } : {}),
    type: "buy",
    shares: opts.shares,
    sharesRemaining: opts.shares,
    pricePerShare: opts.limit,
    escrowAmount: opts.shares * opts.limit,
    ...(opts.fundId ? { escrowAnchor: opts.shares * opts.limit } : {}),
    status: "open",
    createdAt: NOW,
    updatedAt: NOW,
  });
  return orderId;
}

function seedSellOrder(opts: {
  corpId: ObjectId;
  charId?: ObjectId;
  placerCorpId?: ObjectId;
  shares: number;
  limit: number;
}): ObjectId {
  const orderId = new ObjectId();
  fake.seed("shareOrders", {
    _id: orderId,
    corporationId: opts.corpId,
    ...(opts.charId ? { characterId: opts.charId } : {}),
    ...(opts.placerCorpId ? { placerCorporationId: opts.placerCorpId } : {}),
    type: "sell",
    shares: opts.shares,
    sharesRemaining: opts.shares,
    pricePerShare: opts.limit,
    escrowAmount: 0,
    status: "open",
    createdAt: NOW,
    updatedAt: NOW,
  });
  return orderId;
}

function seedFund(cash: number): ObjectId {
  const fundId = new ObjectId();
  fake.seed("indexFunds", { _id: fundId, name: "Fund", cashAnchor: cash, holdings: [] });
  return fundId;
}

function seedPool(cash: number): void {
  fake.seed("equityMarketPools", {
    _id: "USD",
    cashLocal: cash,
    targetCashLocal: cash,
    lifetime: { purchasesIn: 0, salesOut: 0 },
  });
}

async function receipts(): Promise<Doc[]> {
  return fake.docs(RECEIPTS);
}

function splitSnapshot(): { state: string; receipts: Doc[] } {
  const names = [
    "shareOrders",
    "corporations",
    "characters",
    "indexFunds",
    "equityMarketPools",
    "shareTradeHistory",
  ];
  const out: Record<string, Doc[]> = {};
  for (const name of names) {
    out[name] = fake
      .docs(name)
      .map((doc) => {
        const copy = { ...doc };
        delete copy.createdAt;
        delete copy.updatedAt;
        return copy;
      })
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  return { state: JSON.stringify(out), receipts: fake.docs(RECEIPTS) };
}

function receiptByKey(matchKey: string): Doc | undefined {
  return fake.docs(RECEIPTS).find((r) => r._id === matchKey);
}

function historyId(matchKey: string): ObjectId {
  return keyedInsertId(matchKey, "turn-share-match-history");
}

function subkey(matchKey: string, ...segments: string[]): string {
  return deriveMoneyFlowKey(matchKey, ...segments);
}

function hasKey(doc: Doc | null | undefined, key: string): boolean {
  const keys = (doc as { appliedMoneyFlowKeys?: string[] } | null | undefined)
    ?.appliedMoneyFlowKeys;
  return keys?.includes(key) ?? false;
}

async function runDriver(): Promise<void> {
  await fillPendingShareOrders(fake.db, NOW, TURN);
}

// ---------------------------------------------------------------------------
// Exact end-state settlement: treasury path.
// ---------------------------------------------------------------------------

describe("treasury-path settlement", () => {
  it("settles a full character buy with exact conservation", async () => {
    const corpId = seedCorp({ float: 100, treasury: 5000 });
    const buyerId = seedChar(2000);
    const orderId = seedBuyOrder({ corpId, charId: buyerId, shares: 10, limit: 20 });
    // escrow 200 prepaid off-wallet; buyer wallet starts at 2000.

    await runDriver();

    const order = (await fake.findOne("shareOrders", { _id: orderId })) as Doc;
    expect(order?.status).toBe("filled");
    expect(order?.sharesRemaining).toBe(0);
    const buyer = (await fake.findOne("characters", { _id: buyerId })) as Doc;
    // Refund 10*(20-10) = 100.
    expect(buyer?.cashOnHand).toBe(2100);
    const corp = (await fake.findOne("corporations", { _id: corpId })) as Doc;
    // Issuer receives 10*10 = 100; float drops by 10.
    expect(corp?.liquidCapital).toBe(5100);
    expect(corp?.publicFloat).toBe(90);
    const entry = ((corp?.shareholders ?? []) as Doc[]).find((sh) => sh.characterId);
    expect(entry?.shares).toBe(10);
    expect(entry?.avgCostPerShare).toBe(10);
    // Within-turn conservation: released escrow (200) == refund (100) + issuer receipt (100).
    expect((buyer?.cashOnHand as number) - 2000 + ((corp?.liquidCapital as number) - 5000)).toBe(
      200
    );
    const history = fake.docs("shareTradeHistory");
    expect(history).toHaveLength(1);
    expect(history[0]?.kind).toBe("limit_fill");
    expect(history[0]?.shares).toBe(10);
    expect(history[0]?.pricePerShareAnchor).toBe(10);
    expect(history[0]?.turn).toBe(TURN);
    const recs = await receipts();
    expect(recs).toHaveLength(1);
    expect(recs[0]?.status).toBe("completed");
  });

  it("settles a full character sell with exact conservation", async () => {
    const sellerId = seedChar(500);
    const corpId = seedCorp({
      float: 0,
      treasury: 5000,
      holders: [{ characterId: sellerId, shares: 50 }],
    });
    const orderId = seedSellOrder({ corpId, charId: sellerId, shares: 10, limit: 1 });

    await runDriver();

    const order = (await fake.findOne("shareOrders", { _id: orderId })) as Doc;
    expect(order?.status).toBe("filled");
    const seller = (await fake.findOne("characters", { _id: sellerId })) as Doc;
    expect(seller?.cashOnHand).toBe(600);
    const corp = (await fake.findOne("corporations", { _id: corpId })) as Doc;
    expect(corp?.liquidCapital).toBe(4900);
    expect(corp?.publicFloat).toBe(10);
    const entry = ((corp?.shareholders ?? []) as Doc[]).find((sh) => sh.characterId);
    expect(entry?.shares).toBe(40);
    // Conservation: seller gain (100) + treasury loss (-100) == 0.
    expect((seller?.cashOnHand as number) - 500 + ((corp?.liquidCapital as number) - 5000)).toBe(0);
    const recs = await receipts();
    expect(recs).toHaveLength(1);
    expect(recs[0]?.status).toBe("completed");
  });
});

// ---------------------------------------------------------------------------
// Crash-after-every-write: no six-write batch can strand a half-match.
// For each write index k: crash there, re-run the real driver clean, and
// require the exact clean-run end state (post-plan crash) or the exact
// pristine state with a failed-no-plan receipt (plan-store crash, which
// settles failed with nothing moved, mirroring the route money flow).
// ---------------------------------------------------------------------------

describe("crash-after-every-write", () => {
  // Ids are pinned across reseeds so snapshots compare byte-for-byte
  // (receipts, key records, and deterministic history ids all derive them).
  const buyIds = { corpId: new ObjectId(), buyerId: new ObjectId(), orderId: new ObjectId() };
  function seedFullBuy(): { corpId: ObjectId; buyerId: ObjectId; orderId: ObjectId } {
    fake.seed("corporations", {
      _id: buyIds.corpId,
      name: "Match Corp",
      sharePrice: PRICE,
      fundamentalSharePrice: PRICE,
      publicFloat: 100,
      totalShares: 1000,
      shareholders: [],
      liquidCapital: 5000,
      liquidCurrencyCode: "USD",
      countryId: "US",
    });
    fake.seed("characters", {
      _id: buyIds.buyerId,
      name: "Trader",
      countryId: "US",
      cashOnHand: 2000,
    });
    fake.seed("shareOrders", {
      _id: buyIds.orderId,
      corporationId: buyIds.corpId,
      characterId: buyIds.buyerId,
      type: "buy",
      shares: 10,
      sharesRemaining: 10,
      pricePerShare: 20,
      escrowAmount: 200,
      status: "open",
      createdAt: NOW,
      updatedAt: NOW,
    });
    return { ...buyIds };
  }

  it("buy: every crash point converges to exactly-once or pristine", async () => {
    seedFullBuy();
    await runDriver();
    const reference = splitSnapshot();
    const cleanWrites = fake.writes;
    expect(cleanWrites).toBeGreaterThan(5);

    for (let k = 1; k <= cleanWrites; k += 1) {
      fake = createFakeDb();
      const { orderId } = seedFullBuy();
      const matchKey = buildShareMatchKey(TURN, orderId.toHexString(), 10);
      void k;
      fake.faults.crashAtWrite = k;
      await expect(runDriver()).rejects.toThrow("injected-crash-before-write-landed");
      fake.faults.crashAtWrite = null;
      await runDriver();

      const after = splitSnapshot();
      const recs = after.receipts;
      expect(recs).toHaveLength(1);
      expect(recs[0]?._id).toBe(matchKey);
      expect(recs[0]?.status).not.toBe("in_progress");
      if (recs[0]?.status === "completed") {
        expect(after.state).toBe(reference.state);
      } else {
        // Plan-store crash: failed with nothing moved, order still open.
        expect(recs[0]?.status).toBe("failed");
        const order = (await fake.findOne("shareOrders", { _id: orderId })) as Doc;
        expect(order?.status).toBe("open");
        expect(order?.sharesRemaining).toBe(10);
        const buyer = (await fake.findOne("characters")) as Doc;
        expect(buyer?.cashOnHand).toBe(2000);
        const corp = (await fake.findOne("corporations")) as Doc;
        expect(corp?.liquidCapital).toBe(5000);
        expect(corp?.publicFloat).toBe(100);
        expect(fake.docs("shareTradeHistory")).toHaveLength(0);
      }
    }
  });

  it("sell: every crash point converges to exactly-once or pristine", async () => {
    const sellIds = { corpId: new ObjectId(), sellerId: new ObjectId(), orderId: new ObjectId() };
    const seedFullSell = (): { corpId: ObjectId; sellerId: ObjectId; orderId: ObjectId } => {
      fake.seed("corporations", {
        _id: sellIds.corpId,
        name: "Match Corp",
        sharePrice: PRICE,
        fundamentalSharePrice: PRICE,
        publicFloat: 0,
        totalShares: 1000,
        shareholders: [{ characterId: sellIds.sellerId, shares: 50 }],
        liquidCapital: 5000,
        liquidCurrencyCode: "USD",
        countryId: "US",
      });
      fake.seed("characters", {
        _id: sellIds.sellerId,
        name: "Trader",
        countryId: "US",
        cashOnHand: 500,
      });
      fake.seed("shareOrders", {
        _id: sellIds.orderId,
        corporationId: sellIds.corpId,
        characterId: sellIds.sellerId,
        type: "sell",
        shares: 10,
        sharesRemaining: 10,
        pricePerShare: 1,
        escrowAmount: 0,
        status: "open",
        createdAt: NOW,
        updatedAt: NOW,
      });
      return { ...sellIds };
    };
    seedFullSell();
    await runDriver();
    const reference = splitSnapshot();
    const cleanWrites = fake.writes;
    expect(cleanWrites).toBeGreaterThan(5);

    for (let k = 1; k <= cleanWrites; k += 1) {
      fake = createFakeDb();
      const { sellerId, orderId } = seedFullSell();
      const matchKey = buildShareMatchKey(TURN, orderId.toHexString(), 10);
      fake.faults.crashAtWrite = k;
      await expect(runDriver()).rejects.toThrow("injected-crash-before-write-landed");
      fake.faults.crashAtWrite = null;
      await runDriver();

      const after = splitSnapshot();
      const recs = after.receipts;
      expect(recs).toHaveLength(1);
      expect(recs[0]?._id).toBe(matchKey);
      expect(recs[0]?.status).not.toBe("in_progress");
      if (recs[0]?.status === "completed") {
        expect(after.state).toBe(reference.state);
      } else {
        expect(recs[0]?.status).toBe("failed");
        const order = (await fake.findOne("shareOrders", { _id: orderId })) as Doc;
        expect(order?.status).toBe("open");
        expect(order?.sharesRemaining).toBe(10);
        const seller = (await fake.findOne("characters", { _id: sellerId })) as Doc;
        expect(seller?.cashOnHand).toBe(500);
        const corp = (await fake.findOne("corporations")) as Doc;
        expect(corp?.liquidCapital).toBe(5000);
        expect(corp?.publicFloat).toBe(0);
        expect(fake.docs("shareTradeHistory")).toHaveLength(0);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Multi-match pool batch under crash: per-match atomic-or-pristine, exact
// conservation over the completed subset, and a stable fixpoint.
// ---------------------------------------------------------------------------

describe("pool-path multi-match batch", () => {
  function seedBatch(): {
    corpId: ObjectId;
    buyerId: ObjectId;
    sellerId: ObjectId;
    buyOrderId: ObjectId;
    sellOrderId: ObjectId;
  } {
    seedPool(10_000);
    const buyerId = seedChar(5000);
    const sellerId = seedChar(100);
    const corpId = seedCorp({
      float: 100,
      treasury: 0,
      holders: [{ characterId: sellerId, shares: 20 }],
    });
    const buyOrderId = seedBuyOrder({ corpId, charId: buyerId, shares: 10, limit: 30 });
    const sellOrderId = seedSellOrder({ corpId, charId: sellerId, shares: 5, limit: 1 });
    return { corpId, buyerId, sellerId, buyOrderId, sellOrderId };
  }

  async function expectBatchInvariants(seed: {
    corpId: ObjectId;
    buyerId: ObjectId;
    sellerId: ObjectId;
    buyOrderId: ObjectId;
    sellOrderId: ObjectId;
  }): Promise<{ buyKey: string; sellKey: string }> {
    const buyKey = buildShareMatchKey(TURN, seed.buyOrderId.toHexString(), 10);
    const sellKey = buildShareMatchKey(TURN, seed.sellOrderId.toHexString(), 5);
    const buyRec = receiptByKey(buyKey);
    const sellRec = receiptByKey(sellKey);
    expect(buyRec?.status).not.toBe("in_progress");
    expect(sellRec?.status).not.toBe("in_progress");
    const buyDone = buyRec?.status === "completed";
    const sellDone = sellRec?.status === "completed";

    const buyOrder = (await fake.findOne("shareOrders", { _id: seed.buyOrderId })) as Doc;
    const sellOrder = (await fake.findOne("shareOrders", { _id: seed.sellOrderId })) as Doc;
    expect(buyOrder?.status).toBe(buyDone ? "filled" : "open");
    expect(sellOrder?.status).toBe(sellDone ? "filled" : "open");
    expect(buyOrder?.sharesRemaining).toBe(buyDone ? 0 : 10);
    expect(sellOrder?.sharesRemaining).toBe(sellDone ? 0 : 5);

    // Key-record evidence: main subkeys present exactly on completed matches.
    const corp = (await fake.findOne("corporations", { _id: seed.corpId })) as Doc;
    const buyer = (await fake.findOne("characters", { _id: seed.buyerId })) as Doc;
    const seller = (await fake.findOne("characters", { _id: seed.sellerId })) as Doc;
    const pool = (await fake.findOne("equityMarketPools", { _id: "USD" })) as Doc;
    expect(hasKey(await fake.findOne("shareOrders", { _id: seed.buyOrderId }), subkey(buyKey, "order-claim"))).toBe(buyDone);
    expect(hasKey(corp, subkey(buyKey, "buyer-credit"))).toBe(buyDone);
    expect(hasKey(buyer, subkey(buyKey, "match-cash"))).toBe(buyDone);
    expect(hasKey(pool, subkey(buyKey, "dealer"))).toBe(buyDone);
    expect(hasKey(corp, subkey(buyKey, "float"))).toBe(buyDone);
    expect(hasKey(await fake.findOne("shareOrders", { _id: seed.sellOrderId }), subkey(sellKey, "order-claim"))).toBe(sellDone);
    expect(hasKey(corp, subkey(sellKey, "seller-debit"))).toBe(sellDone);
    expect(hasKey(seller, subkey(sellKey, "match-cash"))).toBe(sellDone);
    expect(hasKey(pool, subkey(sellKey, "dealer"))).toBe(sellDone);
    expect(hasKey(corp, subkey(sellKey, "float"))).toBe(sellDone);

    // History rows exist exactly for completed matches, under deterministic ids.
    const historyIds = new Set(fake.docs("shareTradeHistory").map((h) => docKey(h._id)));
    expect(historyIds.has(docKey(historyId(buyKey)))).toBe(buyDone);
    expect(historyIds.has(docKey(historyId(sellKey)))).toBe(sellDone);

    // Exact conservation over the completed subset at the EXECUTED prices
    // (pool quotes carry a spread and cash-skew, and a post-crash recompute
    // legitimately reprices from live pool cash — read them from history).
    const historyRows = fake.docs("shareTradeHistory");
    const buyPrice = historyRows.find((h) => h.shares === 10)?.pricePerShareAnchor as
      | number
      | undefined;
    const sellPrice = historyRows.find((h) => h.shares === 5)?.pricePerShareAnchor as
      | number
      | undefined;
    expect(buyPrice !== undefined).toBe(buyDone);
    expect(sellPrice !== undefined).toBe(sellDone);
    const buyQ = buyDone ? 10 : 0;
    const sellQ = sellDone ? 5 : 0;
    const round2 = (n: number): number => Math.round(n * 100) / 100;
    const buyCost = buyDone ? round2(buyQ * (buyPrice as number)) : 0;
    const sellProceeds = sellDone ? round2(sellQ * (sellPrice as number)) : 0;
    expect(pool?.cashLocal).toBe(10_000 + buyCost - sellProceeds);
    expect((pool?.lifetime as Doc)?.purchasesIn).toBe(buyCost);
    expect((pool?.lifetime as Doc)?.salesOut).toBe(sellProceeds);
    expect(corp?.publicFloat).toBe(100 - buyQ + sellQ);
    // Cash legs carry full precision (only pool dealer legs round per match).
    expect(buyer?.cashOnHand).toBe(5000 + (buyDone ? buyQ * (30 - (buyPrice as number)) : 0));
    expect(seller?.cashOnHand).toBe(100 + (sellDone ? sellQ * (sellPrice as number) : 0));
    const rows = (corp?.shareholders ?? []) as Doc[];
    const buyerEntry = rows.find(
      (sh) => sh.characterId && docKey(sh.characterId) === docKey(seed.buyerId)
    );
    const sellerEntry = rows.find(
      (sh) => sh.characterId && docKey(sh.characterId) === docKey(seed.sellerId)
    );
    expect(buyerEntry?.shares ?? 0).toBe(buyQ);
    expect(sellerEntry?.shares).toBe(20 - sellQ);
    return { buyKey, sellKey };
  }

  it("settles the batch clean with exact pool conservation", async () => {
    const seed = seedBatch();
    await runDriver();
    await expectBatchInvariants(seed);
    const recs = await receipts();
    expect(recs.map((r) => r.status).sort()).toEqual(["completed", "completed"]);
  });

  it("mid-batch crash converges without double apply or half-match", async () => {
    seedBatch();
    await runDriver();
    const cleanWrites = fake.writes;

    // Crash after both plans are stored but before the batch completes, and
    // at the very last write. A post-crash recompute may reprice the
    // survivor from live pool cash, so assert per-match atomic-or-pristine
    // invariants and a stable fixpoint rather than byte-equality.
    for (const k of [3, 4, cleanWrites]) {
      fake = createFakeDb();
      const seed = seedBatch();
      fake.faults.crashAtWrite = k;
      await expect(runDriver()).rejects.toThrow("injected-crash-before-write-landed");
      fake.faults.crashAtWrite = null;
      await runDriver();

      const after = splitSnapshot();
      expect(after.receipts.every((r) => r.status !== "in_progress")).toBe(true);
      await expectBatchInvariants(seed);
      // Fixpoint: another full driver run changes nothing.
      const stable = splitSnapshot();
      await runDriver();
      expect(splitSnapshot()).toEqual(stable);
    }
  });

  it("a second clean driver run is a no-op (duplicate receipts, filled orders)", async () => {
    seedBatch();
    await runDriver();
    const settled = splitSnapshot();
    await runDriver();
    expect(splitSnapshot()).toEqual(settled);
    expect(fake.docs("shareTradeHistory")).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Recovery from the key alone, competing recovery, and the orphan scan.
// ---------------------------------------------------------------------------

describe("key-only and competing recovery", () => {
  it("recovers a crashed match from only its key, then reports settled", async () => {
    const corpId = seedCorp({ float: 100, treasury: 5000 });
    const buyerId = seedChar(2000);
    const orderId = seedBuyOrder({ corpId, charId: buyerId, shares: 10, limit: 20 });
    const matchKey = buildShareMatchKey(TURN, orderId.toHexString(), 10);

    // Crash mid-match (after the claim, before completion).
    fake.faults.crashAtWrite = 5;
    await expect(runDriver()).rejects.toThrow("injected-crash-before-write-landed");
    fake.faults.crashAtWrite = null;
    expect(receiptByKey(matchKey)?.status).toBe("in_progress");

    // Retry from the key alone: no amounts, no order state, just the key.
    await expect(recoverShareMatchByKey(fake.db, matchKey)).resolves.toEqual({
      matchKey,
      action: "match-recovered",
    });
    const buyer = (await fake.findOne("characters", { _id: buyerId })) as Doc;
    expect(buyer?.cashOnHand).toBe(2100);
    const corp = (await fake.findOne("corporations", { _id: corpId })) as Doc;
    expect(corp?.liquidCapital).toBe(5100);
    expect(corp?.publicFloat).toBe(90);
    expect(fake.docs("shareTradeHistory")).toHaveLength(1);

    await expect(recoverShareMatchByKey(fake.db, matchKey)).resolves.toEqual({
      matchKey,
      action: "skipped-settled",
    });
    await expect(recoverShareMatchByKey(fake.db, "turn-share-match:42:deadbeef:1")).resolves.toEqual(
      {
        matchKey: "turn-share-match:42:deadbeef:1",
        action: "skipped-missing",
      }
    );
  });

  it("competing recoveries apply the match exactly once", async () => {
    const corpId = seedCorp({ float: 100, treasury: 5000 });
    const buyerId = seedChar(2000);
    const orderId = seedBuyOrder({ corpId, charId: buyerId, shares: 10, limit: 20 });
    const matchKey = buildShareMatchKey(TURN, orderId.toHexString(), 10);

    fake.faults.crashAtWrite = 4;
    await expect(runDriver()).rejects.toThrow("injected-crash-before-write-landed");
    fake.faults.crashAtWrite = null;

    const [first, second] = await Promise.all([
      recoverShareMatchByKey(fake.db, matchKey),
      recoverShareMatchByKey(fake.db, matchKey),
    ]);
    expect([first.action, second.action].sort()).toEqual(["match-recovered", "match-recovered"]);
    // Exactly once: refund 100 (not 200), issuer +100, one history row.
    const buyer = (await fake.findOne("characters", { _id: buyerId })) as Doc;
    expect(buyer?.cashOnHand).toBe(2100);
    const corp = (await fake.findOne("corporations", { _id: corpId })) as Doc;
    expect(corp?.liquidCapital).toBe(5100);
    expect(fake.docs("shareTradeHistory")).toHaveLength(1);
  });

  it("the bounded orphan scan converges lonely receipts before the fresh scan", async () => {
    const corpId = seedCorp({ float: 100, treasury: 5000 });
    const buyerId = seedChar(2000);
    const orderId = seedBuyOrder({ corpId, charId: buyerId, shares: 10, limit: 20 });
    const matchKey = buildShareMatchKey(TURN, orderId.toHexString(), 10);

    fake.faults.crashAtWrite = 6;
    await expect(runDriver()).rejects.toThrow("injected-crash-before-write-landed");
    fake.faults.crashAtWrite = null;

    const scanned = await recoverShareMatchOrphans(fake.db, 50);
    expect(scanned).toEqual([{ matchKey, action: "match-recovered" }]);
    expect(receiptByKey(matchKey)?.status).toBe("completed");
    // The fresh scan then sees a filled order and mints no second receipt.
    await runDriver();
    expect(fake.docs(RECEIPTS)).toHaveLength(1);
    expect(fake.docs("shareTradeHistory")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Partial/final fills, order priority, actor variants, and guard skips.
// ---------------------------------------------------------------------------

describe("partial fills and priority", () => {
  it("partial fill reserves escrow and completes on a later turn", async () => {
    const corpId = seedCorp({ float: 4, treasury: 5000 });
    const buyerId = seedChar(1000);
    // 10-share order, limit 20, float covers 4: refund 4*10=40, residual escrow 6*20=120.
    const orderId = seedBuyOrder({ corpId, charId: buyerId, shares: 10, limit: 20 });

    await runDriver();

    let order = (await fake.findOne("shareOrders", { _id: orderId })) as Doc;
    expect(order?.status).toBe("open");
    expect(order?.sharesRemaining).toBe(6);
    expect(order?.escrowAmount).toBe(120);
    let buyer = (await fake.findOne("characters", { _id: buyerId })) as Doc;
    expect(buyer?.cashOnHand).toBe(1040);
    let corp = (await fake.findOne("corporations", { _id: corpId })) as Doc;
    expect(corp?.liquidCapital).toBe(5040);
    expect(corp?.publicFloat).toBe(0);

    // Float replenishes; the next turn fills the remaining 6 under a new key.
    corp = { ...(corp as Doc), publicFloat: 50 };
    fake.seed("corporations", corp);
    await fillPendingShareOrders(fake.db, NOW, TURN + 1);

    order = (await fake.findOne("shareOrders", { _id: orderId })) as Doc;
    expect(order?.status).toBe("filled");
    expect(order?.sharesRemaining).toBe(0);
    expect(order?.escrowAmount).toBe(0);
    buyer = (await fake.findOne("characters", { _id: buyerId })) as Doc;
    // Total refund 40 + 60 = 100; total issuer receipt 40 + 60 = 100.
    expect(buyer?.cashOnHand).toBe(1100);
    corp = (await fake.findOne("corporations", { _id: corpId })) as Doc;
    expect(corp?.liquidCapital).toBe(5100);
    const entry = ((corp?.shareholders ?? []) as Doc[]).find((sh) => sh.characterId);
    expect(entry?.shares).toBe(10);
    const recs = await receipts();
    expect(recs).toHaveLength(2);
    expect(recs.every((r) => r.status === "completed")).toBe(true);
  });

  it("fills competing buys in order: first wins the limited float", async () => {
    const corpId = seedCorp({ float: 10, treasury: 9000 });
    const firstId = seedChar(9000);
    const secondId = seedChar(9000);
    const firstOrder = seedBuyOrder({ corpId, charId: firstId, shares: 10, limit: 50 });
    const secondOrder = seedBuyOrder({ corpId, charId: secondId, shares: 10, limit: 50 });

    await runDriver();

    const first = (await fake.findOne("shareOrders", { _id: firstOrder })) as Doc;
    const second = (await fake.findOne("shareOrders", { _id: secondOrder })) as Doc;
    expect(first?.status).toBe("filled");
    expect(second?.status).toBe("open");
    expect(second?.sharesRemaining).toBe(10);
    const firstBuyer = (await fake.findOne("characters", { _id: firstId })) as Doc;
    const secondBuyer = (await fake.findOne("characters", { _id: secondId })) as Doc;
    // Winner refunds 10*(50-10)=400; loser untouched.
    expect(firstBuyer?.cashOnHand).toBe(9400);
    expect(secondBuyer?.cashOnHand).toBe(9000);
    const corp = (await fake.findOne("corporations", { _id: corpId })) as Doc;
    expect(corp?.publicFloat).toBe(0);
    expect(corp?.liquidCapital).toBe(9100);
  });

  it("caps a character sell at live holdings (ticket #1154)", async () => {
    const sellerId = seedChar(0);
    const corpId = seedCorp({
      float: 0,
      treasury: 1_000_000,
      holders: [{ characterId: sellerId, shares: 10 }],
    });
    // Stale pre-split order for 1,000,000 shares; only 10 exist.
    const orderId = seedSellOrder({ corpId, charId: sellerId, shares: 1_000_000, limit: 1 });

    await runDriver();

    const order = (await fake.findOne("shareOrders", { _id: orderId })) as Doc;
    expect(order?.status).toBe("open");
    expect(order?.sharesRemaining).toBe(999_990);
    const corp = (await fake.findOne("corporations", { _id: corpId })) as Doc;
    expect(corp?.publicFloat).toBe(10);
    const entry = ((corp?.shareholders ?? []) as Doc[]).find((sh) => sh.characterId);
    // The keyed debit pulls fully-drained rows (route convention); either way
    // the seller holds nothing.
    expect(entry?.shares ?? 0).toBe(0);
    const seller = (await fake.findOne("characters", { _id: sellerId })) as Doc;
    expect(seller?.cashOnHand).toBe(100);
  });
});

describe("actor variants and guard skips", () => {
  it("credits a fund buyer: cap entry, holdings row, anchor refund, treasury receipt", async () => {
    const corpId = seedCorp({ float: 100, treasury: 1000 });
    const fundId = seedFund(7000);
    const orderId = seedBuyOrder({ corpId, fundId, shares: 10, limit: 60 });

    await runDriver();

    const order = (await fake.findOne("shareOrders", { _id: orderId })) as Doc;
    expect(order?.status).toBe("filled");
    const corp = (await fake.findOne("corporations", { _id: corpId })) as Doc;
    const fundEntry = ((corp?.shareholders ?? []) as Doc[]).find((sh) => sh.fundId);
    expect(fundEntry?.shares).toBe(10);
    const fund = (await fake.findOne("indexFunds", { _id: fundId })) as Doc;
    const holding = ((fund?.holdings ?? []) as Doc[]).find(
      (h) => h.corporationId && docKey(h.corporationId) === docKey(corpId)
    );
    expect(holding?.shares).toBe(10);
    // Refund 10*(60-10) = 500 to cashAnchor; issuer +100.
    expect(fund?.cashAnchor).toBe(7500);
    expect(corp?.liquidCapital).toBe(1100);
    expect(corp?.publicFloat).toBe(90);
  });

  it("pays a placing corporation without debiting its shares", async () => {
    const placerId = new ObjectId();
    fake.seed("corporations", {
      _id: placerId,
      name: "Placer",
      liquidCapital: 1000,
      liquidCurrencyCode: "USD",
      countryId: "US",
    });
    // Target corp holds the placer's pre-debited entry: no debit must run.
    const corpId = seedCorp({ float: 0, treasury: 5000 });
    const corp = (await fake.findOne("corporations", { _id: corpId })) as Doc;
    fake.seed("corporations", {
      ...(corp as Doc),
      shareholders: [{ corporationId: placerId, shares: 40 }],
    });
    const orderId = seedSellOrder({ corpId, placerCorpId: placerId, shares: 10, limit: 1 });

    await runDriver();

    const order = (await fake.findOne("shareOrders", { _id: orderId })) as Doc;
    expect(order?.status).toBe("filled");
    const placer = (await fake.findOne("corporations", { _id: placerId })) as Doc;
    expect(placer?.liquidCapital).toBe(1100);
    const target = (await fake.findOne("corporations", { _id: corpId })) as Doc;
    const entry = ((target?.shareholders ?? []) as Doc[]).find((sh) => sh.corporationId);
    // Pre-debited entry untouched (still 40), float up by 10.
    expect(entry?.shares).toBe(40);
    expect(target?.publicFloat).toBe(10);
    expect(target?.liquidCapital).toBe(4900);
  });

  it("skips a sell the treasury cannot cover and still fills the rest", async () => {
    const poorSeller = seedChar(0);
    const richSeller = seedChar(0);
    const corpId = seedCorp({
      float: 0,
      // Treasury covers the 5-share sale (50) but not the 10-share sale (100).
      treasury: 60,
      holders: [
        { characterId: poorSeller, shares: 10 },
        { characterId: richSeller, shares: 5 },
      ],
    });
    // Resolution order: big order first (seeded first), small order second.
    const bigOrder = seedSellOrder({ corpId, charId: poorSeller, shares: 10, limit: 1 });
    const smallOrder = seedSellOrder({ corpId, charId: richSeller, shares: 5, limit: 1 });

    await runDriver();

    // Big sale needs 100 > 60: skipped at compute time (no receipt minted),
    // order open, shares and cash untouched.
    const big = (await fake.findOne("shareOrders", { _id: bigOrder })) as Doc;
    expect(big?.status).toBe("open");
    expect(big?.sharesRemaining).toBe(10);
    const poor = (await fake.findOne("characters", { _id: poorSeller })) as Doc;
    expect(poor?.cashOnHand).toBe(0);
    // Small sale fills: treasury 60 - 50 = 10.
    const small = (await fake.findOne("shareOrders", { _id: smallOrder })) as Doc;
    expect(small?.status).toBe("filled");
    const rich = (await fake.findOne("characters", { _id: richSeller })) as Doc;
    expect(rich?.cashOnHand).toBe(50);
    const corp = (await fake.findOne("corporations", { _id: corpId })) as Doc;
    expect(corp?.liquidCapital).toBe(10);
    expect(corp?.publicFloat).toBe(5);
    // Only the filled match minted a receipt; the skip never reaches commit.
    const recs = await receipts();
    expect(recs).toHaveLength(1);
    expect(recs[0]?.status).toBe("completed");
  });
});
