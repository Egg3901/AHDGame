import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId, type Db } from "mongodb";
import {
  MoneyFlowKeyConflictError,
  NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION,
} from "@/lib/db/nonAtomicMoneyFlow";
import {
  NPP_SHARE_TRADE_FINGERPRINT_DOMAIN,
  buildNppShareBuyKey,
  buildNppShareSellKey,
  executeNppShareTradeFlow,
  getStoredNppShareTradeResponse,
  recoverNppShareTradeByKey,
  recoverNppShareTradeOrphans,
  recoverNppShareTradeReceipt,
  type NppShareTradePlan,
} from "./nppShareTradeSpend";
import { nppBuyShares, nppSellShares } from "./nppShares";

// ---------------------------------------------------------------------------
// Stateful in-memory fake honoring exactly the operators the NPP share flow
// emits: corp/NPP reads, receipt insert/find/update with duplicate-key
// (11000) inserts, keyed `$inc` legs with `$gte` + `$ne: key` guards, keyed
// positional cap-table updates (`shareholders.$`) with `$elemMatch`
// sufficiency or dotted-array equality guards, inc/push/inc credit triples
// under one subkey, plain `$pull` zero-row cleanup, `$push` key records in
// `$each`+`$slice` form, the single escrow-split pipeline update, `$exists`
// finds for the orphan scan, and a fault counter where the Nth write throws
// without landing, modeling a process death between sequential Mongo writes.
// ---------------------------------------------------------------------------

type Doc = Record<string, unknown>;

function docKey(id: unknown): string {
  if (id instanceof ObjectId) return id.toHexString();
  return String(id);
}

function clone<T>(value: T): T {
  if (value instanceof ObjectId) return value;
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
    if (key === "_id") {
      if (cond && typeof cond === "object" && !(cond instanceof ObjectId) && !Array.isArray(cond)) {
        const ops = cond as Doc;
        if ("$in" in ops) {
          return ((ops.$in as unknown[]) ?? []).some((v) => valueEquals(doc._id, v));
        }
        if ("$ne" in ops) return !valueEquals(doc._id, ops.$ne);
      }
      return valueEquals(doc._id, cond);
    }
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
      const [head, ...rest] = key.split(".");
      if ((head === "shareholders" || head === "holdings") && rest.length === 1) {
        const rows = (doc[head] as Doc[] | undefined) ?? [];
        return rows.some((row) => valueEquals(row[rest[0]!], cond));
      }
      const actual = getPath(doc, key);
      if (cond && typeof cond === "object" && !(cond instanceof ObjectId) && !Array.isArray(cond)) {
        const ops = cond as Doc;
        if ("$gte" in ops) return (actual as number) >= (ops.$gte as number);
        if ("$ne" in ops) return !valueEquals(actual, ops.$ne);
      }
      return valueEquals(actual, cond);
    }
    const actual = doc[key];
    if (cond && typeof cond === "object" && !(cond instanceof ObjectId) && !Array.isArray(cond)) {
      const ops = cond as Doc;
      if ("$gte" in ops) return (actual as number) >= (ops.$gte as number);
      if ("$ne" in ops) return !valueEquals(actual, ops.$ne);
      if ("$in" in ops) {
        return ((ops.$in as unknown[]) ?? []).some((v) => valueEquals(actual, v));
      }
      if ("$exists" in ops) {
        return ops.$exists ? actual !== undefined : actual === undefined;
      }
    }
    return valueEquals(actual, cond);
  });
}

type Expr = unknown;

function evalExpr(doc: Doc, expr: Expr): unknown {
  if (typeof expr === "string" && expr.startsWith("$")) {
    return getPath(doc, expr.slice(1));
  }
  if (Array.isArray(expr)) return expr.map((e) => evalExpr(doc, e));
  if (expr && typeof expr === "object") {
    const ops = expr as Doc;
    if ("$subtract" in ops) {
      const [a, b] = (ops.$subtract as Expr[]).map((e) => evalExpr(doc, e) as number);
      return (a ?? 0) - (b ?? 0);
    }
    if ("$ifNull" in ops) {
      const [a, b] = ops.$ifNull as Expr[];
      const va = evalExpr(doc, a);
      return va === null || va === undefined ? evalExpr(doc, b) : va;
    }
    if ("$concatArrays" in ops) {
      const parts = (ops.$concatArrays as Expr[]).map((e) => evalExpr(doc, e));
      return (parts as unknown[][]).flat();
    }
    if ("$slice" in ops) {
      const [arr, n] = ops.$slice as [Expr, number];
      const list = evalExpr(doc, arr) as unknown[];
      return (n as number) < 0 ? list.slice(n as number) : list.slice(0, n as number);
    }
  }
  return clone(expr);
}

interface FakeDb {
  docs: Map<string, Map<string, Doc>>;
  writes: number;
  faultAt: number | null;
}

function makeFakeDb(): FakeDb {
  return { docs: new Map(), writes: 0, faultAt: null };
}

function getColl(fake: FakeDb, name: string): Map<string, Doc> {
  let coll = fake.docs.get(name);
  if (!coll) {
    coll = new Map();
    fake.docs.set(name, coll);
  }
  return coll;
}

function maybeFault(fake: FakeDb): void {
  fake.writes += 1;
  if (fake.faultAt !== null && fake.writes === fake.faultAt) {
    throw new Error("injected-crash");
  }
}

function applyObjectUpdate(doc: Doc, update: Doc, filter: Doc): void {
  for (const [path, delta] of Object.entries((update.$inc as Doc | undefined) ?? {})) {
    if (path.includes("$.")) {
      const [arrayField] = path.split(".$.");
      const idx = positionalIndex(doc, filter, arrayField!);
      if (idx < 0) throw new Error("positional operator did not find the match");
      const leaf = path.split(".$.")[1]!;
      const rows = doc[arrayField!] as Doc[];
      rows[idx]![leaf] = ((rows[idx]![leaf] as number) ?? 0) + (delta as number);
    } else {
      setPath(doc, path, ((getPath(doc, path) as number) ?? 0) + (delta as number));
    }
  }
  for (const [path, value] of Object.entries((update.$set as Doc | undefined) ?? {})) {
    if (path.includes("$.")) {
      const [arrayField] = path.split(".$.");
      const idx = positionalIndex(doc, filter, arrayField!);
      if (idx < 0) throw new Error("positional operator did not find the match");
      const leaf = path.split(".$.")[1]!;
      (doc[arrayField!] as Doc[])[idx]![leaf] = clone(value);
    } else {
      setPath(doc, path, value);
    }
  }
  const unset = update.$unset as Doc | undefined;
  if (unset) {
    for (const path of Object.keys(unset)) {
      const parts = path.split(".");
      let node: Doc = doc;
      for (let i = 0; i < parts.length - 1; i += 1) {
        const next = node[parts[i]!];
        if (typeof next !== "object" || next === null) {
          node = {};
          break;
        }
        node = next as Doc;
      }
      delete node[parts[parts.length - 1]!];
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
        if (!Array.isArray(doc[path])) doc[path] = [] as unknown as Doc[];
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

function fakeCollection(fake: FakeDb, name: string): Record<string, (...args: never[]) => unknown> {
  const coll = () => getColl(fake, name);
  return {
    insertOne: async (doc: Doc) => {
      maybeFault(fake);
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
      maybeFault(fake);
      for (const doc of coll().values()) {
        if (matchesFilter(doc, filter)) {
          if (Array.isArray(update)) {
            for (const stage of update as Doc[]) {
              if (stage.$set && typeof stage.$set === "object") {
                for (const [path, expr] of Object.entries(stage.$set as Doc)) {
                  if (path === "updatedAt") {
                    setPath(doc, path, expr);
                  } else {
                    setPath(doc, path, evalExpr(doc, expr));
                  }
                }
              }
            }
          } else {
            applyObjectUpdate(doc, update, filter);
          }
          return { matchedCount: 1, modifiedCount: 1 };
        }
      }
      return { matchedCount: 0, modifiedCount: 0 };
    },
    find: (filter: Doc) => {
      const collect = async (): Promise<Doc[]> => {
        const out: Doc[] = [];
        for (const doc of coll().values()) {
          if (matchesFilter(doc, filter)) out.push(clone(doc));
        }
        return out;
      };
      return {
        toArray: collect,
        limit: (n: number) => ({
          toArray: async () => (await collect()).slice(0, n),
        }),
      };
    },
  };
}

function asDb(fake: FakeDb): Db {
  return { collection: (name: string) => fakeCollection(fake, name) } as unknown as Db;
}

function seedDoc(fake: FakeDb, collection: string, doc: Doc): void {
  getColl(fake, collection).set(docKey(doc._id), clone(doc));
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NPP_ID = new ObjectId("111111111111111111111111");
const CORP_ID = new ObjectId("333333333333333333333333");
const OTHER_USER_ID = new ObjectId("666666666666666666666666");
const TURN = 77;
const PRICE = 42;
const SHARES = 10;
const NOTIONAL = SHARES * PRICE;
const NPP = { _id: NPP_ID, countryId: "US" as const };

function seedNpp(fake: FakeDb, cash = 500_000): void {
  seedDoc(fake, "npps", { _id: NPP_ID, countryId: "US", nppInvestmentCashAnchor: cash });
}

function seedCorp(
  fake: FakeDb,
  opts: {
    float?: number;
    treasury?: number;
    escrow?: number;
    escrowMode?: boolean;
    holderShares?: number;
    holderAvg?: number;
    ceoIsNpp?: boolean;
    liquidCurrencyCode?: string;
    isPrivate?: boolean;
    isNationalized?: boolean;
    countryOwnerId?: string;
  } = {}
): void {
  const holderShares = opts.holderShares ?? 0;
  seedDoc(fake, "corporations", {
    _id: CORP_ID,
    name: "TargetCo",
    countryId: "US",
    liquidCurrencyCode: opts.liquidCurrencyCode ?? "USD",
    sharePrice: PRICE,
    totalShares: 100_000,
    publicFloat: opts.float ?? 5_000,
    liquidCapital: opts.treasury ?? 10_000,
    shareEscrowBalance: opts.escrow ?? 0,
    ...(opts.escrowMode ? { shareBuybackMode: "escrow" } : {}),
    ...(opts.ceoIsNpp
      ? { ceoId: NPP_ID, userId: OTHER_USER_ID, ceoVacant: false }
      : { ceoId: new ObjectId("444444444444444444444444") }),
    shareholders:
      holderShares > 0
        ? [{ nppId: NPP_ID, shares: holderShares, avgCostPerShare: opts.holderAvg ?? PRICE }]
        : [],
    ...(opts.isPrivate ? { isPrivate: true } : {}),
    ...(opts.isNationalized ? { isNationalized: true } : {}),
    ...(opts.countryOwnerId ? { countryOwnerId: opts.countryOwnerId } : {}),
  });
}

function seedPool(fake: FakeDb, cash = 1_000_000, target = 1_000_000): void {
  seedDoc(fake, "equityMarketPools", {
    _id: "USD",
    cashLocal: cash,
    targetCashLocal: target,
    lifetime: { purchasesIn: 0, salesOut: 0 },
  });
}

function nppDoc(fake: FakeDb): Doc {
  return getColl(fake, "npps").get(NPP_ID.toHexString())!;
}

function corpDoc(fake: FakeDb): Doc {
  return getColl(fake, "corporations").get(CORP_ID.toHexString())!;
}

function holderShares(fake: FakeDb): number {
  const corp = corpDoc(fake);
  const rows = (corp.shareholders as Doc[] | undefined) ?? [];
  return (rows.find((row) => docKey(row.nppId) === NPP_ID.toHexString())?.shares as number) ?? 0;
}

function holderAvg(fake: FakeDb): number | undefined {
  const corp = corpDoc(fake);
  const rows = (corp.shareholders as Doc[] | undefined) ?? [];
  return rows.find((row) => docKey(row.nppId) === NPP_ID.toHexString())?.avgCostPerShare as
    number | undefined;
}

function receipt(fake: FakeDb, key: string): Doc | undefined {
  return getColl(fake, NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION).get(key);
}

function poolDoc(fake: FakeDb): Doc | undefined {
  return getColl(fake, "equityMarketPools").get("USD");
}

const BUY_KEY = (shares: number, turn = TURN): string =>
  buildNppShareBuyKey(turn, NPP_ID, CORP_ID, shares);
const SELL_KEY = (shares: number, turn = TURN): string =>
  buildNppShareSellKey(turn, NPP_ID, CORP_ID, shares);

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// NPP float buys
// ---------------------------------------------------------------------------

describe("nppBuyShares keyed flow", () => {
  it("settles cash debit, float, cap credit, and treasury dealer once", async () => {
    const fake = makeFakeDb();
    seedNpp(fake);
    seedCorp(fake);
    const key = "buy-treasury-1";
    const res = await nppBuyShares(asDb(fake), NPP, CORP_ID, SHARES, 1, {
      turn: TURN,
      idempotencyKey: key,
    });

    expect(res).toEqual({
      ok: true,
      corporationId: CORP_ID.toString(),
      shares: SHARES,
      cost: NOTIONAL,
      costAnchor: NOTIONAL,
      investmentCashAnchor: 500_000 - NOTIONAL,
    });
    expect(nppDoc(fake).nppInvestmentCashAnchor).toBe(500_000 - NOTIONAL);
    const corp = corpDoc(fake);
    expect(corp.publicFloat).toBe(5_000 - SHARES);
    expect(corp.orderFlowWindowBuyValue).toBe(NOTIONAL);
    expect(corp.liquidCapital).toBe(10_000 + NOTIONAL);
    expect(corp.shareIssuanceProceeds).toBe(NOTIONAL);
    expect(holderShares(fake)).toBe(SHARES);
    expect(holderAvg(fake)).toBe(PRICE);
    expect(receipt(fake, key)?.status).toBe("completed");
  });

  it("blends the average cost basis on repeat buys", async () => {
    const fake = makeFakeDb();
    seedNpp(fake);
    seedCorp(fake, { holderShares: 10, holderAvg: 40 });
    const res = await nppBuyShares(asDb(fake), NPP, CORP_ID, SHARES, 1, {
      turn: TURN,
      idempotencyKey: "buy-blend-1",
    });
    expect(res.ok).toBe(true);
    expect(holderShares(fake)).toBe(20);
    expect(holderAvg(fake)).toBeCloseTo(41, 10);
  });

  it("routes the issuer credit to the pool when pool-backed", async () => {
    const fake = makeFakeDb();
    seedNpp(fake);
    seedCorp(fake);
    seedPool(fake);
    const before = (poolDoc(fake)!.cashLocal as number) ?? 0;
    const res = await nppBuyShares(asDb(fake), NPP, CORP_ID, SHARES, 1, {
      turn: TURN,
      idempotencyKey: "buy-pool-1",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("expected ok");
    // Execution price carries the pool ask skew, so assert against the body.
    const pool = poolDoc(fake)!;
    expect(pool.cashLocal).toBeCloseTo(before + res.cost, 8);
    expect(corpDoc(fake).liquidCapital).toBe(10_000);
    expect(nppDoc(fake).nppInvestmentCashAnchor).toBeCloseTo(500_000 - res.costAnchor, 8);
    expect(holderShares(fake)).toBe(SHARES);
  });

  it("routes the issuer credit to escrow in escrow mode without a pool", async () => {
    const fake = makeFakeDb();
    seedNpp(fake);
    seedCorp(fake, { escrowMode: true });
    const res = await nppBuyShares(asDb(fake), NPP, CORP_ID, SHARES, 1, {
      turn: TURN,
      idempotencyKey: "buy-escrow-1",
    });
    expect(res.ok).toBe(true);
    expect(corpDoc(fake).shareEscrowBalance).toBe(NOTIONAL);
    expect(corpDoc(fake).liquidCapital).toBe(10_000);
  });

  it("converges across a crash at every durable boundary", async () => {
    const probe = makeFakeDb();
    seedNpp(probe);
    seedCorp(probe);
    const probeRes = await nppBuyShares(asDb(probe), NPP, CORP_ID, SHARES, 1, {
      turn: TURN,
      idempotencyKey: "buy-probe",
    });
    expect(probeRes.ok).toBe(true);
    const totalWrites = probe.writes;
    expect(totalWrites).toBeGreaterThan(3);

    for (let faultAt = 1; faultAt <= totalWrites; faultAt += 1) {
      const fake = makeFakeDb();
      seedNpp(fake);
      seedCorp(fake);
      const key = `buy-crash-${faultAt}`;
      const opts = { turn: TURN, idempotencyKey: key };
      fake.faultAt = faultAt;
      let first: unknown;
      try {
        first = await nppBuyShares(asDb(fake), NPP, CORP_ID, SHARES, 1, opts);
      } catch (error) {
        first = error;
      } finally {
        fake.faultAt = null;
      }
      if (first instanceof Error) {
        expect(first.message).toBe("injected-crash");
      }
      const retry = await nppBuyShares(asDb(fake), NPP, CORP_ID, SHARES, 1, opts);
      if (retry.ok) {
        expect(retry).toEqual({
          ok: true,
          corporationId: CORP_ID.toString(),
          shares: SHARES,
          cost: NOTIONAL,
          costAnchor: NOTIONAL,
          investmentCashAnchor: 500_000 - NOTIONAL,
        });
        expect(nppDoc(fake).nppInvestmentCashAnchor).toBe(500_000 - NOTIONAL);
        expect(corpDoc(fake).publicFloat).toBe(5_000 - SHARES);
        expect(holderShares(fake)).toBe(SHARES);
        expect(corpDoc(fake).liquidCapital).toBe(10_000 + NOTIONAL);
        expect(receipt(fake, key)?.status).toBe("completed");
      } else {
        // Plan-store crash: nothing moved, the key is terminal, retry needs
        // a new key. Pristine state is the truthful outcome.
        expect(nppDoc(fake).nppInvestmentCashAnchor).toBe(500_000);
        expect(corpDoc(fake).publicFloat).toBe(5_000);
        expect(holderShares(fake)).toBe(0);
        expect(corpDoc(fake).liquidCapital).toBe(10_000);
        expect(receipt(fake, key)?.status).toBe("failed");
      }
    }
  });

  it("replays the same key without moving money again", async () => {
    const fake = makeFakeDb();
    seedNpp(fake);
    seedCorp(fake);
    const opts = { turn: TURN, idempotencyKey: "buy-replay-1" };
    const first = await nppBuyShares(asDb(fake), NPP, CORP_ID, SHARES, 1, opts);
    const second = await nppBuyShares(asDb(fake), NPP, CORP_ID, SHARES, 1, opts);
    expect(second).toEqual(first);
    expect(nppDoc(fake).nppInvestmentCashAnchor).toBe(500_000 - NOTIONAL);
    expect(holderShares(fake)).toBe(SHARES);
  });

  it("fails closed when one key is reused for a different transfer", async () => {
    const fake = makeFakeDb();
    seedNpp(fake);
    seedCorp(fake);
    const opts = { turn: TURN, idempotencyKey: "buy-conflict-1" };
    const first = await nppBuyShares(asDb(fake), NPP, CORP_ID, SHARES, 1, opts);
    expect(first.ok).toBe(true);
    await expect(nppBuyShares(asDb(fake), NPP, CORP_ID, SHARES + 1, 1, opts)).rejects.toThrow(
      MoneyFlowKeyConflictError
    );
    expect(nppDoc(fake).nppInvestmentCashAnchor).toBe(500_000 - NOTIONAL);
  });

  it("derives deterministic keys per turn, corp, shares, and direction", () => {
    expect(BUY_KEY(10)).toBe(buildNppShareBuyKey(TURN, NPP_ID, CORP_ID, 10));
    expect(BUY_KEY(10, TURN + 1)).not.toBe(BUY_KEY(10));
    expect(BUY_KEY(11)).not.toBe(BUY_KEY(10));
    expect(BUY_KEY(10)).not.toBe(SELL_KEY(10));
    expect(buildNppShareBuyKey(TURN, NPP_ID, new ObjectId(), 10)).not.toBe(BUY_KEY(10));
  });

  it("rejects insufficient cash with nothing moved", async () => {
    const fake = makeFakeDb();
    seedNpp(fake, 100);
    seedCorp(fake);
    const key = "buy-poor-1";
    const res = await nppBuyShares(asDb(fake), NPP, CORP_ID, SHARES, 1, {
      turn: TURN,
      idempotencyKey: key,
    });
    expect(res).toEqual({
      ok: false,
      reason: "Insufficient investment capital for share purchase.",
    });
    expect(nppDoc(fake).nppInvestmentCashAnchor).toBe(100);
    expect(corpDoc(fake).publicFloat).toBe(5_000);
    expect(holderShares(fake)).toBe(0);
    expect(receipt(fake, key)?.status).toBe("failed");
    // Same-key retry reports the stored failure instead of throwing.
    const retry = await nppBuyShares(asDb(fake), NPP, CORP_ID, SHARES, 1, {
      turn: TURN,
      idempotencyKey: key,
    });
    expect(retry).toEqual(res);
  });

  it("compensates the cash debit when the float gate fails in-flow", async () => {
    const fake = makeFakeDb();
    seedNpp(fake);
    seedCorp(fake, { float: 5_000 });
    // Shares exceed the float: the keyed float step guard-rejects after the
    // cash debit applied, so the debit must be compensated exactly.
    const plan: NppShareTradePlan = {
      version: 1,
      tradeKey: "buy-float-race-1",
      kind: "npp-buy",
      nppIdHex: NPP_ID.toHexString(),
      corpIdHex: CORP_ID.toHexString(),
      shares: 6_000,
      executionPrice: PRICE,
      turn: TURN,
      nowIso: new Date("2026-09-01T00:00:00Z").toISOString(),
      orderFlowEligible: true,
      cashLeg: {
        collection: "npps",
        idHex: NPP_ID.toHexString(),
        field: "nppInvestmentCashAnchor",
        amount: 6_000 * PRICE,
      },
      capLeg: { field: "nppId", idHex: NPP_ID.toHexString(), pricePerShare: PRICE },
      dealer: { kind: "treasury", amountLocal: 6_000 * PRICE },
      issuerAmountLocal: 6_000 * PRICE,
      ceoVacate: null,
      errors: {
        "npp-debit": {
          message: "Insufficient investment capital for share purchase.",
          status: 400,
        },
        float: { message: "Share float no longer available; purchase refunded.", status: 409 },
        "npp-credit": { message: "Failed to record trade", status: 500 },
        dealer: { message: "Failed to record trade", status: 500 },
        "seller-debit": { message: "Failed to record trade", status: 500 },
        "proceeds-credit": { message: "Failed to record trade", status: 500 },
      },
      response: { success: true, corporationId: CORP_ID.toString(), shares: 6_000 },
    };
    const result = await executeNppShareTradeFlow(asDb(fake), plan, {
      idempotencyKey: plan.tradeKey,
    });
    expect(result).toEqual({
      ok: false,
      error: "Share float no longer available; purchase refunded.",
      status: 409,
    });
    expect(nppDoc(fake).nppInvestmentCashAnchor).toBe(500_000);
    expect(corpDoc(fake).publicFloat).toBe(5_000);
    expect(holderShares(fake)).toBe(0);
    expect(receipt(fake, plan.tradeKey)?.status).toBe("compensated");
  });

  it("rejects pre-flow guards without creating a receipt", async () => {
    for (const [name, mutate, reason] of [
      ["float", { float: 2 }, "Only 2 shares available in public float."],
      ["currency", { liquidCurrencyCode: "GBP" }, "NPPs only buy shares in their home currency."],
      ["private", { isPrivate: true }, "Corporation is private."],
      ["nationalized", { isNationalized: true }, "Corporation is nationalized."],
      [
        "national",
        { countryOwnerId: "US" },
        "National corporations are not open for equity investment.",
      ],
    ] as Array<[string, Parameters<typeof seedCorp>[1], string]>) {
      const fake = makeFakeDb();
      seedNpp(fake);
      seedCorp(fake, mutate);
      const key = `buy-guard-${name}`;
      const res = await nppBuyShares(asDb(fake), NPP, CORP_ID, SHARES, 1, {
        turn: TURN,
        idempotencyKey: key,
      });
      expect(res).toEqual({ ok: false, reason });
      expect(receipt(fake, key)).toBeUndefined();
    }
    const missing = makeFakeDb();
    seedNpp(missing);
    expect(
      await nppBuyShares(asDb(missing), NPP, CORP_ID, SHARES, 1, {
        turn: TURN,
        idempotencyKey: "buy-guard-missing",
      })
    ).toEqual({ ok: false, reason: "Corporation not found." });
    expect(
      await nppBuyShares(asDb(missing), NPP, CORP_ID, 0, 1, {
        turn: TURN,
        idempotencyKey: "buy-guard-zero",
      })
    ).toEqual({ ok: false, reason: "Shares must be a positive integer." });
  });
});

// ---------------------------------------------------------------------------
// NPP float sells
// ---------------------------------------------------------------------------

describe("nppSellShares keyed flow", () => {
  it("settles issuer debit, share debit, float, and proceeds once", async () => {
    const fake = makeFakeDb();
    seedNpp(fake);
    seedCorp(fake, { holderShares: 100 });
    const key = "sell-treasury-1";
    const res = await nppSellShares(asDb(fake), NPP, CORP_ID, SHARES, TURN, 1, {
      idempotencyKey: key,
    });

    expect(res).toEqual({
      ok: true,
      corporationId: CORP_ID.toString(),
      shares: SHARES,
      proceeds: NOTIONAL,
      proceedsAnchor: NOTIONAL,
      investmentCashAnchor: 500_000 + NOTIONAL,
    });
    expect(nppDoc(fake).nppInvestmentCashAnchor).toBe(500_000 + NOTIONAL);
    const corp = corpDoc(fake);
    expect(corp.publicFloat).toBe(5_000 + SHARES);
    expect(corp.orderFlowWindowSellValue).toBe(NOTIONAL);
    expect(corp.liquidCapital).toBe(10_000 - NOTIONAL);
    expect(corp.shareIssuanceProceeds).toBe(-NOTIONAL);
    expect(holderShares(fake)).toBe(100 - SHARES);
    expect(receipt(fake, key)?.status).toBe("completed");
  });

  it("splits escrow-mode issuer debit across escrow and treasury", async () => {
    const fake = makeFakeDb();
    seedNpp(fake);
    seedCorp(fake, { holderShares: 100, escrowMode: true, escrow: 100 });
    const res = await nppSellShares(asDb(fake), NPP, CORP_ID, SHARES, TURN, 1, {
      idempotencyKey: "sell-escrow-1",
    });
    expect(res.ok).toBe(true);
    // Pinned split: escrow covers 100, treasury covers the 320 remainder.
    expect(corpDoc(fake).shareEscrowBalance).toBe(0);
    expect(corpDoc(fake).liquidCapital).toBe(10_000 - (NOTIONAL - 100));
    expect(holderShares(fake)).toBe(100 - SHARES);
  });

  it("draws the issuer debit from the pool when pool-backed", async () => {
    const fake = makeFakeDb();
    seedNpp(fake);
    seedCorp(fake, { holderShares: 100 });
    seedPool(fake);
    const before = (poolDoc(fake)!.cashLocal as number) ?? 0;
    const res = await nppSellShares(asDb(fake), NPP, CORP_ID, SHARES, TURN, 1, {
      idempotencyKey: "sell-pool-1",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("expected ok");
    expect((poolDoc(fake)!.cashLocal as number) ?? 0).toBeCloseTo(before - res.proceeds, 8);
    expect(corpDoc(fake).liquidCapital).toBe(10_000);
    expect(nppDoc(fake).nppInvestmentCashAnchor).toBeCloseTo(500_000 + res.proceedsAnchor, 8);
  });

  it("converges across a crash at every durable boundary", async () => {
    const probe = makeFakeDb();
    seedNpp(probe);
    seedCorp(probe, { holderShares: 100 });
    const probeRes = await nppSellShares(asDb(probe), NPP, CORP_ID, SHARES, TURN, 1, {
      idempotencyKey: "sell-probe",
    });
    expect(probeRes.ok).toBe(true);
    const totalWrites = probe.writes;
    expect(totalWrites).toBeGreaterThan(3);

    for (let faultAt = 1; faultAt <= totalWrites; faultAt += 1) {
      const fake = makeFakeDb();
      seedNpp(fake);
      seedCorp(fake, { holderShares: 100 });
      const key = `sell-crash-${faultAt}`;
      const opts = { idempotencyKey: key };
      fake.faultAt = faultAt;
      let first: unknown;
      try {
        first = await nppSellShares(asDb(fake), NPP, CORP_ID, SHARES, TURN, 1, opts);
      } catch (error) {
        first = error;
      } finally {
        fake.faultAt = null;
      }
      if (first instanceof Error) {
        expect(first.message).toBe("injected-crash");
      }
      const retry = await nppSellShares(asDb(fake), NPP, CORP_ID, SHARES, TURN, 1, opts);
      if (retry.ok) {
        expect(retry).toEqual({
          ok: true,
          corporationId: CORP_ID.toString(),
          shares: SHARES,
          proceeds: NOTIONAL,
          proceedsAnchor: NOTIONAL,
          investmentCashAnchor: 500_000 + NOTIONAL,
        });
        expect(nppDoc(fake).nppInvestmentCashAnchor).toBe(500_000 + NOTIONAL);
        expect(corpDoc(fake).publicFloat).toBe(5_000 + SHARES);
        expect(holderShares(fake)).toBe(100 - SHARES);
        expect(corpDoc(fake).liquidCapital).toBe(10_000 - NOTIONAL);
        expect(receipt(fake, key)?.status).toBe("completed");
      } else {
        expect(nppDoc(fake).nppInvestmentCashAnchor).toBe(500_000);
        expect(corpDoc(fake).publicFloat).toBe(5_000);
        expect(holderShares(fake)).toBe(100);
        expect(corpDoc(fake).liquidCapital).toBe(10_000);
        expect(receipt(fake, key)?.status).toBe("failed");
      }
    }
  });

  it("replays the same key without moving money again", async () => {
    const fake = makeFakeDb();
    seedNpp(fake);
    seedCorp(fake, { holderShares: 100 });
    const opts = { idempotencyKey: "sell-replay-1" };
    const first = await nppSellShares(asDb(fake), NPP, CORP_ID, SHARES, TURN, 1, opts);
    const second = await nppSellShares(asDb(fake), NPP, CORP_ID, SHARES, TURN, 1, opts);
    expect(second).toEqual(first);
    expect(nppDoc(fake).nppInvestmentCashAnchor).toBe(500_000 + NOTIONAL);
    expect(holderShares(fake)).toBe(100 - SHARES);
  });

  it("rejects when the treasury cannot cover, with nothing moved", async () => {
    const fake = makeFakeDb();
    seedNpp(fake);
    seedCorp(fake, { holderShares: 100, treasury: 10 });
    const key = "sell-broke-1";
    const res = await nppSellShares(asDb(fake), NPP, CORP_ID, SHARES, TURN, 1, {
      idempotencyKey: key,
    });
    expect(res).toEqual({
      ok: false,
      reason: "The equity market does not have enough cash for this sale.",
    });
    expect(nppDoc(fake).nppInvestmentCashAnchor).toBe(500_000);
    expect(corpDoc(fake).publicFloat).toBe(5_000);
    expect(holderShares(fake)).toBe(100);
    expect(corpDoc(fake).liquidCapital).toBe(10);
    expect(receipt(fake, key)?.status).toBe("failed");
  });

  it("rejects the pool-depth gate before creating a receipt", async () => {
    const fake = makeFakeDb();
    seedNpp(fake);
    seedCorp(fake, { holderShares: 100 });
    seedPool(fake, 10, 1_000_000);
    const key = "sell-shallow-1";
    const res = await nppSellShares(asDb(fake), NPP, CORP_ID, SHARES, TURN, 1, {
      idempotencyKey: key,
    });
    expect(res.ok).toBe(false);
    expect(receipt(fake, key)).toBeUndefined();
    expect(holderShares(fake)).toBe(100);
  });

  it("rejects short inventory before the issuer moves", async () => {
    const fake = makeFakeDb();
    seedNpp(fake);
    seedCorp(fake, { holderShares: 3 });
    const key = "sell-short-1";
    const res = await nppSellShares(asDb(fake), NPP, CORP_ID, SHARES, TURN, 1, {
      idempotencyKey: key,
    });
    expect(res).toEqual({ ok: false, reason: "Only 3 shares owned." });
    expect(receipt(fake, key)).toBeUndefined();
    expect(corpDoc(fake).liquidCapital).toBe(10_000);
  });

  it("rejects a drained position before the issuer moves", async () => {
    const fake = makeFakeDb();
    seedNpp(fake);
    seedCorp(fake, { holderShares: 2 });
    const res = await nppSellShares(asDb(fake), NPP, CORP_ID, SHARES, TURN, 1, {
      idempotencyKey: "sell-race-1",
    });
    expect(res).toEqual({ ok: false, reason: "Only 2 shares owned." });
    expect(corpDoc(fake).liquidCapital).toBe(10_000);
    expect(receipt(fake, "sell-race-1")).toBeUndefined();
  });

  it("compensates the issuer debit when the share debit fails in-flow", async () => {
    const fake = makeFakeDb();
    seedNpp(fake);
    seedCorp(fake, { holderShares: 100 });
    // Hand-pinned plan sells more than the holder owns: the keyed
    // seller-debit guard-rejects after the issuer debit applied, so the
    // issuer leg must be compensated exactly.
    const plan: NppShareTradePlan = {
      version: 1,
      tradeKey: "sell-debit-race-1",
      kind: "npp-sell",
      nppIdHex: NPP_ID.toHexString(),
      corpIdHex: CORP_ID.toHexString(),
      shares: 200,
      executionPrice: PRICE,
      turn: TURN,
      nowIso: new Date("2026-09-01T00:00:00Z").toISOString(),
      orderFlowEligible: true,
      cashLeg: {
        collection: "npps",
        idHex: NPP_ID.toHexString(),
        field: "nppInvestmentCashAnchor",
        amount: 200 * PRICE,
      },
      capLeg: { field: "nppId", idHex: NPP_ID.toHexString(), pricePerShare: PRICE },
      dealer: { kind: "treasury", amountLocal: -(200 * PRICE) },
      issuerAmountLocal: 200 * PRICE,
      ceoVacate: null,
      errors: {
        "npp-debit": { message: "Failed to record trade", status: 500 },
        float: { message: "Failed to record trade", status: 500 },
        "npp-credit": { message: "Failed to record trade", status: 500 },
        dealer: {
          message: "The equity market does not have enough cash for this sale.",
          status: 400,
        },
        "seller-debit": { message: "Shares no longer available; sale reversed.", status: 409 },
        "proceeds-credit": { message: "Failed to record trade", status: 500 },
      },
      response: { success: true, corporationId: CORP_ID.toString(), shares: 200 },
    };
    const result = await executeNppShareTradeFlow(asDb(fake), plan, {
      idempotencyKey: plan.tradeKey,
    });
    expect(result).toEqual({
      ok: false,
      error: "Shares no longer available; sale reversed.",
      status: 409,
    });
    expect(corpDoc(fake).liquidCapital).toBe(10_000);
    expect(holderShares(fake)).toBe(100);
    expect(corpDoc(fake).publicFloat).toBe(5_000);
    expect(receipt(fake, plan.tradeKey)?.status).toBe("compensated");
  });

  it("vacates the CEO seat on a full sale and keeps userId", async () => {
    const fake = makeFakeDb();
    seedNpp(fake);
    seedCorp(fake, { holderShares: SHARES, ceoIsNpp: true });
    const res = await nppSellShares(asDb(fake), NPP, CORP_ID, SHARES, TURN, 1, {
      idempotencyKey: "sell-vacate-1",
    });
    expect(res.ok).toBe(true);
    const corp = corpDoc(fake);
    expect(corp.ceoVacant).toBe(true);
    expect(corp.ceoVacantSinceTurn).toBe(TURN);
    expect(corp.ceoId).toBeUndefined();
    expect(docKey(corp.userId)).toBe(OTHER_USER_ID.toHexString());
    expect(holderShares(fake)).toBe(0);
    expect((corp.shareholders as Doc[]) ?? []).toHaveLength(0);
  });

  it("does not vacate the CEO seat on a partial sale", async () => {
    const fake = makeFakeDb();
    seedNpp(fake);
    seedCorp(fake, { holderShares: 20, ceoIsNpp: true });
    const res = await nppSellShares(asDb(fake), NPP, CORP_ID, SHARES, TURN, 1, {
      idempotencyKey: "sell-novacc-1",
    });
    expect(res.ok).toBe(true);
    const corp = corpDoc(fake);
    expect(docKey(corp.ceoId)).toBe(NPP_ID.toHexString());
    expect(corp.ceoVacant).toBe(false);
    expect(corp.ceoVacantSinceTurn).toBeUndefined();
  });

  it("restores the CEO seat when a vacating sale compensates", async () => {
    const fake = makeFakeDb();
    seedNpp(fake);
    seedCorp(fake, { holderShares: SHARES, ceoIsNpp: true });
    // Remove the NPP cash doc so the terminal proceeds credit misses: the
    // dealer, share debit, and CEO-vacating float step must all reverse.
    getColl(fake, "npps").delete(NPP_ID.toHexString());
    const res = await nppSellShares(asDb(fake), NPP, CORP_ID, SHARES, TURN, 1, {
      idempotencyKey: "sell-vacate-restore-1",
    });
    expect(res.ok).toBe(false);
    const corp = corpDoc(fake);
    expect(docKey(corp.ceoId)).toBe(NPP_ID.toHexString());
    expect(corp.ceoVacant).toBe(false);
    expect(corp.ceoVacantSinceTurn).toBeUndefined();
    expect(holderShares(fake)).toBe(SHARES);
    expect(corp.publicFloat).toBe(5_000);
    expect(corp.liquidCapital).toBe(10_000);
    expect(receipt(fake, "sell-vacate-restore-1")?.status).toBe("compensated");
  });

  it("rejects pre-flow sell guards without creating a receipt", async () => {
    for (const [name, mutate, reason] of [
      [
        "currency",
        { holderShares: 100, liquidCurrencyCode: "GBP" },
        "NPPs only sell shares in their home currency.",
      ],
      ["private", { holderShares: 100, isPrivate: true }, "Corporation is private."],
      ["nationalized", { holderShares: 100, isNationalized: true }, "Corporation is nationalized."],
      [
        "national",
        { holderShares: 100, countryOwnerId: "US" },
        "National corporations are not open for equity trading.",
      ],
    ] as Array<[string, Parameters<typeof seedCorp>[1], string]>) {
      const fake = makeFakeDb();
      seedNpp(fake);
      seedCorp(fake, mutate);
      const key = `sell-guard-${name}`;
      const res = await nppSellShares(asDb(fake), NPP, CORP_ID, SHARES, TURN, 1, {
        idempotencyKey: key,
      });
      expect(res).toEqual({ ok: false, reason });
      expect(receipt(fake, key)).toBeUndefined();
    }
  });

  it("conserves cash and shares exactly across a buy then sell round trip", async () => {
    const fake = makeFakeDb();
    seedNpp(fake);
    seedCorp(fake);
    const buy = await nppBuyShares(asDb(fake), NPP, CORP_ID, SHARES, 1, {
      turn: TURN,
      idempotencyKey: "rt-buy-1",
    });
    expect(buy.ok).toBe(true);
    const sell = await nppSellShares(asDb(fake), NPP, CORP_ID, SHARES, TURN + 1, 1, {
      idempotencyKey: "rt-sell-1",
    });
    expect(sell.ok).toBe(true);
    // Money is conserved: every issuer credit reverses on the sell.
    expect(nppDoc(fake).nppInvestmentCashAnchor).toBe(500_000);
    expect(corpDoc(fake).liquidCapital).toBe(10_000);
    expect(corpDoc(fake).shareIssuanceProceeds ?? 0).toBe(0);
    // Shares are conserved: float restored, holder row pulled.
    expect(corpDoc(fake).publicFloat).toBe(5_000);
    expect(holderShares(fake)).toBe(0);
    expect((corpDoc(fake).shareholders as Doc[] | undefined) ?? []).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Recovery and orphan scans
// ---------------------------------------------------------------------------

describe("nppShareTradeSpend recovery", () => {
  it("reports a missing key lookup as null so the caller validates fresh", async () => {
    const fake = makeFakeDb();
    expect(await getStoredNppShareTradeResponse(asDb(fake), "no-such-key")).toBeNull();
  });

  it("settles a plan-less receipt as failed without moving money", async () => {
    const fake = makeFakeDb();
    seedNpp(fake);
    seedCorp(fake, { holderShares: 100 });
    seedDoc(fake, NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION, {
      _id: "npp-planless-1",
      status: "in_progress",
      fingerprint: `${NPP_SHARE_TRADE_FINGERPRINT_DOMAIN}:npp-buy:x`,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const recovered = await recoverNppShareTradeReceipt(asDb(fake), "npp-planless-1");
    expect(recovered).toEqual({ tradeKey: "npp-planless-1", action: "settled-failed-no-plan" });
    expect(receipt(fake, "npp-planless-1")?.status).toBe("failed");
    expect(nppDoc(fake).nppInvestmentCashAnchor).toBe(500_000);
    expect(corpDoc(fake).publicFloat).toBe(5_000);
  });

  it("recovers a crashed in-progress trade from its stored plan", async () => {
    const fake = makeFakeDb();
    seedNpp(fake);
    seedCorp(fake);
    const key = "npp-recover-1";
    fake.faultAt = 4;
    await expect(
      nppBuyShares(asDb(fake), NPP, CORP_ID, SHARES, 1, { turn: TURN, idempotencyKey: key })
    ).rejects.toThrow("injected-crash");
    fake.faultAt = null;
    const recovered = await recoverNppShareTradeByKey(asDb(fake), key);
    expect(recovered.ok).toBe(true);
    expect(nppDoc(fake).nppInvestmentCashAnchor).toBe(500_000 - NOTIONAL);
    expect(holderShares(fake)).toBe(SHARES);
    expect(receipt(fake, key)?.status).toBe("completed");
  });

  it("converges orphans, settles plan-less receipts, and skips foreign ones", async () => {
    const fake = makeFakeDb();
    seedNpp(fake);
    seedCorp(fake, { holderShares: 100 });
    // Orphaned NPP buy: crash mid-flow, then scan.
    const orphanKey = "npp-orphan-buy-1";
    fake.faultAt = 3;
    await expect(
      nppBuyShares(asDb(fake), NPP, CORP_ID, SHARES, 1, { turn: TURN, idempotencyKey: orphanKey })
    ).rejects.toThrow("injected-crash");
    fake.faultAt = null;
    // Plan-less NPP receipt and a foreign-domain receipt.
    seedDoc(fake, NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION, {
      _id: "npp-orphan-planless-1",
      status: "in_progress",
      fingerprint: `${NPP_SHARE_TRADE_FINGERPRINT_DOMAIN}:npp-sell:y`,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    seedDoc(fake, NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION, {
      _id: "foreign-orphan-1",
      status: "in_progress",
      fingerprint: "public-share-trade:market-buy:zzz",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    // Settled NPP receipt stays untouched.
    seedDoc(fake, NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION, {
      _id: "npp-orphan-settled-1",
      status: "completed",
      fingerprint: `${NPP_SHARE_TRADE_FINGERPRINT_DOMAIN}:npp-buy:done`,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const results = await recoverNppShareTradeOrphans(asDb(fake), 50);
    const byKey = new Map(results.map((r) => [r.tradeKey, r.action]));
    expect(byKey.get(orphanKey)).toBe("trade-recovered");
    expect(byKey.get("npp-orphan-planless-1")).toBe("settled-failed-no-plan");
    expect(byKey.has("foreign-orphan-1")).toBe(false);
    expect(byKey.has("npp-orphan-settled-1")).toBe(false);
    expect(receipt(fake, "foreign-orphan-1")?.status).toBe("in_progress");
    expect(nppDoc(fake).nppInvestmentCashAnchor).toBe(500_000 - NOTIONAL);
    expect(holderShares(fake)).toBe(100 + SHARES);
  });
});
