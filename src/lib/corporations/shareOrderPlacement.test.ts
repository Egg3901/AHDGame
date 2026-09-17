import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId, type Db } from "mongodb";
import {
  MoneyFlowKeyConflictError,
  MoneyFlowTerminalError,
  NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION,
  keyedInsertId,
} from "@/lib/db/nonAtomicMoneyFlow";
import {
  SHARE_ORDER_PLACEMENT_FINGERPRINT_DOMAIN,
  SHARE_ORDER_PLACEMENT_ORDER_DOMAIN,
  buildShareOrderPlacementSteps,
  executeShareOrderPlacementFlow,
  recoverShareOrderPlacementByKey,
  recoverShareOrderPlacementOrphans,
  type ShareOrderPlacementPlan,
} from "./shareOrderPlacement";
import { EQUITY_MARKET_POOLS_COLLECTION } from "@/lib/db/types/equityMarketPool";

vi.mock("@/lib/audit/recordAudit", () => ({
  recordAudit: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Stateful in-memory fake honoring exactly the operators the placement flow
// emits: receipt insert/find/update with dotted `$set` paths and duplicate
// key (11000) inserts, keyed `$inc` legs with `$gte` + `$ne: key` guards,
// keyed positional cap-table updates (`shareholders.$`) with `$elemMatch`
// sufficiency, inc/push/inc credit triples under one subkey, plain `$pull`
// zero-row cleanup, `$push` key records in `$each`+`$slice` form, the single
// escrow-split pipeline update (floored escrow/treasury debit plus key
// record in one atomic write), `$exists` finds for the orphan scan, and a
// fault counter where the Nth write throws without landing, modeling a
// process death between sequential Mongo writes.
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

function valueEquals(actual: unknown, expected: unknown): boolean {
  if (actual instanceof ObjectId && expected instanceof ObjectId) return actual.equals(expected);
  if (actual instanceof ObjectId || expected instanceof ObjectId) {
    return docKey(actual) === docKey(expected);
  }
  return actual === expected;
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
    if ("$max" in ops) {
      const vals = ((ops.$max as Expr[]).map((e) => evalExpr(doc, e)) as number[]).filter((v) =>
        Number.isFinite(v)
      );
      return vals.length > 0 ? Math.max(...vals) : 0;
    }
    if ("$min" in ops) {
      const vals = ((ops.$min as Expr[]).map((e) => evalExpr(doc, e)) as number[]).filter((v) =>
        Number.isFinite(v)
      );
      return vals.length > 0 ? Math.min(...vals) : 0;
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

function applyObjectUpdate(doc: Doc, update: Doc, filter: Doc): void {
  for (const [path, delta] of Object.entries((update.$inc as Doc | undefined) ?? {})) {
    if (path.includes(".$.")) {
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
    if (path.includes(".$.")) {
      const [arrayField] = path.split(".$.");
      const idx = positionalIndex(doc, filter, arrayField!);
      if (idx < 0) throw new Error("positional operator did not find the match");
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

function fakeCollection(db: FakeDb, name: string): Record<string, (...args: never[]) => unknown> {
  const coll = () => getColl(db, name);
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
    find: (filter: Doc) => ({
      limit: (n: number) => ({
        toArray: async () => {
          const out: Doc[] = [];
          for (const doc of coll().values()) {
            if (matchesFilter(doc, filter)) {
              out.push(clone(doc));
              if (out.length >= n) break;
            }
          }
          return out;
        },
      }),
    }),
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

const CHAR_ID = new ObjectId("111111111111111111111111");
const PLACER_CORP_ID = new ObjectId("222222222222222222222222");
const TARGET_CORP_ID = new ObjectId("333333333333333333333333");

function seedWorld(
  fake: FakeDb,
  opts: { escrowMode?: boolean; escrowBalance?: number; corpShares?: number } = {}
): void {
  seedDoc(fake, "characters", { _id: CHAR_ID, name: "Buyer", cashOnHand: 1000 });
  seedDoc(fake, "corporations", { _id: PLACER_CORP_ID, name: "PlacerCo", liquidCapital: 5000 });
  seedDoc(fake, "corporations", {
    _id: TARGET_CORP_ID,
    name: "TargetCo",
    liquidCapital: 10000,
    publicFloat: 500,
    ...(opts.escrowMode
      ? { shareBuybackMode: "escrow", shareEscrowBalance: opts.escrowBalance ?? 0 }
      : {}),
    shareholders:
      opts.corpShares !== undefined
        ? [{ corporationId: PLACER_CORP_ID, shares: opts.corpShares, avgCostPerShare: 9 }]
        : [{ characterId: CHAR_ID, shares: 100, avgCostPerShare: 9 }],
  });
}

interface PlanOverrides {
  key?: string;
  kind?: ShareOrderPlacementPlan["kind"];
  placer?: "character" | "corporation";
  shares?: number;
  limitPrice?: number;
  executionPrice?: number;
  debitAmount?: number | null;
  proceedsAmount?: number | null;
  capDebitIdHex?: string;
  capCreditIdHex?: string;
  dealer?: ShareOrderPlacementPlan["dealer"];
  orderFlowEligible?: boolean;
  response?: Record<string, unknown>;
}

function buildPlan(fakeKey: string, overrides: PlanOverrides = {}): ShareOrderPlacementPlan {
  const kind = overrides.kind ?? "buy-pending";
  const placer = overrides.placer ?? "character";
  const shares = overrides.shares ?? 10;
  const limitPrice = overrides.limitPrice ?? 8;
  const executionPrice = overrides.executionPrice ?? 10;
  const isBuy = kind.startsWith("buy");
  const immediate = kind.endsWith("immediate");
  const placerIdHex = placer === "character" ? CHAR_ID.toHexString() : PLACER_CORP_ID.toHexString();
  const debitAmount =
    overrides.debitAmount !== undefined
      ? overrides.debitAmount
      : isBuy
        ? immediate
          ? shares * executionPrice
          : shares * limitPrice
        : null;
  const proceedsAmount =
    overrides.proceedsAmount !== undefined
      ? overrides.proceedsAmount
      : !isBuy && immediate
        ? shares * executionPrice
        : null;
  const orderIdHex = keyedInsertId(fakeKey, SHARE_ORDER_PLACEMENT_ORDER_DOMAIN).toHexString();
  const now = new Date("2026-09-01T00:00:00Z");
  return {
    version: 1,
    placementKey: fakeKey,
    orderIdHex,
    kind,
    corpIdHex: TARGET_CORP_ID.toHexString(),
    corpName: "TargetCo",
    shares,
    limitPrice,
    executionPrice,
    turn: 7,
    nowIso: now.toISOString(),
    orderFlowEligible: overrides.orderFlowEligible ?? false,
    placerKind: placer,
    placerIdHex,
    placerName: placer === "character" ? "Buyer" : "PlacerCo",
    characterIdHex: CHAR_ID.toHexString(),
    debitLeg:
      debitAmount === null
        ? null
        : {
            collection: placer === "character" ? "characters" : "corporations",
            idHex: placerIdHex,
            field: placer === "character" ? "cashOnHand" : "liquidCapital",
            amount: debitAmount,
          },
    proceedsLeg:
      proceedsAmount === null
        ? null
        : {
            collection: placer === "character" ? "characters" : "corporations",
            idHex: placerIdHex,
            field: placer === "character" ? "cashOnHand" : "liquidCapital",
            amount: proceedsAmount,
          },
    capDebit: !isBuy
      ? {
          field: placer === "character" ? "characterId" : "corporationId",
          idHex: overrides.capDebitIdHex ?? placerIdHex,
          pricePerShare: executionPrice,
        }
      : null,
    capCredit:
      isBuy && immediate
        ? {
            field: placer === "character" ? "characterId" : "corporationId",
            idHex: overrides.capCreditIdHex ?? placerIdHex,
            pricePerShare: executionPrice,
          }
        : null,
    floatDelta: immediate ? (isBuy ? -shares : shares) : 0,
    dealer:
      overrides.dealer !== undefined
        ? overrides.dealer
        : immediate
          ? {
              kind: "treasury",
              amountLocal: isBuy ? shares * executionPrice : -(shares * executionPrice),
            }
          : null,
    orderDoc: immediate
      ? null
      : ({
          _id: keyedInsertId(fakeKey, SHARE_ORDER_PLACEMENT_ORDER_DOMAIN),
          corporationId: TARGET_CORP_ID,
          characterId: CHAR_ID,
          ...(placer === "corporation" ? { placerCorporationId: PLACER_CORP_ID } : {}),
          type: isBuy ? "buy" : "sell",
          shares,
          sharesRemaining: shares,
          ...(isBuy ? {} : { sharesDebitedAtCreation: true }),
          pricePerShare: limitPrice,
          escrowAmount: isBuy ? shares * limitPrice : 0,
          status: "open",
          createdAt: now,
          updatedAt: now,
        } as unknown as ShareOrderPlacementPlan["orderDoc"]),
    tx: immediate
      ? {
          type: isBuy ? "stock_trade_buy" : "stock_trade_sell",
          subjectType: placer,
          subjectIdHex: placerIdHex,
          subjectName: placer === "character" ? "Buyer" : "PlacerCo",
          amount: isBuy ? -(debitAmount ?? 0) : (proceedsAmount ?? 0),
          includeBalanceAfter: isBuy,
          currencyCode: "USD",
          counterpartyType: "corporation",
          counterpartyName: "TargetCo",
          counterpartyIdHex: TARGET_CORP_ID.toHexString(),
          meta: {
            corporationId: TARGET_CORP_ID.toHexString(),
            shares,
            pricePerShare: executionPrice,
            source: "limit_order_immediate_fill",
          },
        }
      : isBuy
        ? {
            type: "stock_order_escrow",
            subjectType: placer,
            subjectIdHex: placerIdHex,
            subjectName: placer === "character" ? "Buyer" : "PlacerCo",
            amount: -(debitAmount ?? 0),
            includeBalanceAfter: true,
            currencyCode: "USD",
            counterpartyType: "system",
            counterpartyName: "Order book escrow",
            meta: {
              corporationId: TARGET_CORP_ID.toHexString(),
              shares,
              pricePerShare: limitPrice,
            },
          }
        : null,
    history: immediate
      ? {
          shares,
          pricePerShareAnchor: executionPrice,
          from: isBuy ? null : { characterId: CHAR_ID, name: "Buyer" },
          to: isBuy ? { characterId: CHAR_ID, name: "Buyer" } : null,
          corpCurrencyCode: undefined,
        }
      : null,
    spread: null,
    audit: {
      counterpartyType: placer,
      counterpartyIdHex: placerIdHex,
      counterpartyName: placer === "character" ? "Buyer" : "PlacerCo",
      ...(immediate || isBuy ? { amount: 0, currencyCode: "USD" } : {}),
      orderType: isBuy ? "buy" : "sell",
      status: immediate ? "filled" : "open",
      shares,
      pricePerShare: immediate ? executionPrice : limitPrice,
    },
    errors: {
      debit: { message: "ERR_DEBIT", status: 400 },
      float: { message: "ERR_FLOAT", status: 409 },
      reserve: { message: "ERR_RESERVE", status: 409 },
      dealer: { message: "ERR_DEALER", status: 400 },
    },
    response: overrides.response ?? { success: true, marker: kind },
  };
}

function charCash(fake: FakeDb): number {
  return (getColl(fake, "characters").get(CHAR_ID.toHexString())?.cashOnHand ?? NaN) as number;
}

function placerCapital(fake: FakeDb): number {
  return (getColl(fake, "corporations").get(PLACER_CORP_ID.toHexString())?.liquidCapital ??
    NaN) as number;
}

function targetCorp(fake: FakeDb): Doc {
  return getColl(fake, "corporations").get(TARGET_CORP_ID.toHexString())!;
}

function openOrders(fake: FakeDb): Doc[] {
  return [...(getColl(fake, "shareOrders").values() ?? [])];
}

function receipt(fake: FakeDb, key: string): Doc | undefined {
  return getColl(fake, NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION).get(key);
}

/** Execute and assert success; returns the stored response body. */
async function expectSuccess(
  fake: FakeDb,
  plan: ShareOrderPlacementPlan,
  key: string
): Promise<Record<string, unknown>> {
  const result = await executeShareOrderPlacementFlow(asDb(fake), plan, { idempotencyKey: key });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("expected ok");
  return result.body;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Final-state assertions per path
// ---------------------------------------------------------------------------

function expectBuyPendingState(fake: FakeDb, key: string, wallet: number, escrow: number): void {
  expect(charCash(fake)).toBe(wallet);
  const orders = openOrders(fake);
  expect(orders).toHaveLength(1);
  expect(docKey(orders[0]!._id)).toBe(
    keyedInsertId(key, SHARE_ORDER_PLACEMENT_ORDER_DOMAIN).toHexString()
  );
  expect(orders[0]!.escrowAmount).toBe(escrow);
  expect(orders[0]!.status).toBe("open");
  expect(receipt(fake, key)?.status).toBe("completed");
}

function expectBuyImmediateState(fake: FakeDb, key: string): void {
  expect(charCash(fake)).toBe(900);
  const corp = targetCorp(fake);
  expect(corp.publicFloat).toBe(490);
  expect(corp.liquidCapital).toBe(10100);
  expect(corp.shareIssuanceProceeds).toBe(100);
  const row = (corp.shareholders as Doc[]).find(
    (r) => docKey(r.characterId) === CHAR_ID.toHexString()
  );
  expect(row!.shares).toBe(110);
  expect(getColl(fake, "shareTradeHistory").size).toBe(1);
  expect(receipt(fake, key)?.status).toBe("completed");
}

function expectSellPendingState(fake: FakeDb, key: string): void {
  expect(charCash(fake)).toBe(1000);
  const corp = targetCorp(fake);
  const row = (corp.shareholders as Doc[]).find(
    (r) => docKey(r.characterId) === CHAR_ID.toHexString()
  );
  expect(row!.shares).toBe(90);
  const orders = openOrders(fake);
  expect(orders).toHaveLength(1);
  expect(orders[0]!.sharesDebitedAtCreation).toBe(true);
  expect(receipt(fake, key)?.status).toBe("completed");
}

function expectSellImmediateState(fake: FakeDb, key: string): void {
  expect(charCash(fake)).toBe(1100);
  const corp = targetCorp(fake);
  expect(corp.publicFloat).toBe(510);
  expect(corp.liquidCapital).toBe(9900);
  const row = (corp.shareholders as Doc[]).find(
    (r) => docKey(r.characterId) === CHAR_ID.toHexString()
  );
  expect(row!.shares).toBe(90);
  expect(getColl(fake, "shareTradeHistory").size).toBe(1);
  expect(receipt(fake, key)?.status).toBe("completed");
}

/** Crash at every write boundary, then retry the same key to convergence. */
async function crashAcrossWrites(
  overrides: PlanOverrides,
  assertState: (fake: FakeDb, key: string) => void,
  seedOpts: { escrowMode?: boolean; escrowBalance?: number; corpShares?: number } = {}
): Promise<void> {
  const probe = makeFakeDb();
  seedWorld(probe, seedOpts);
  const probePlan = buildPlan("probe", overrides);
  await expectSuccess(probe, probePlan, "probe");
  const totalWrites = probe.writes;
  expect(totalWrites).toBeGreaterThan(3);
  for (let faultAt = 1; faultAt <= totalWrites; faultAt += 1) {
    const fake = makeFakeDb();
    seedWorld(fake, seedOpts);
    const key = `crash-${faultAt}`;
    const plan = buildPlan(key, overrides);
    fake.faultAt = faultAt;
    let first: unknown;
    try {
      first = await executeShareOrderPlacementFlow(asDb(fake), plan, { idempotencyKey: key });
    } catch (error) {
      first = error;
    } finally {
      fake.faultAt = null;
    }
    if (first instanceof Error) {
      expect(first.message).toBe("injected-crash");
    }
    let retry: Awaited<ReturnType<typeof executeShareOrderPlacementFlow>>;
    try {
      retry = await executeShareOrderPlacementFlow(asDb(fake), plan, { idempotencyKey: key });
    } catch (error) {
      // Plan-store crash: the fake keeps executing the settle-failed line a
      // real crash would never reach, so the same-key retry throws terminal.
      // Either way the state is truthful: nothing moved, new key required.
      expect(error).toBeInstanceOf(MoneyFlowTerminalError);
      expect((error as Error).message).toContain("plan-store");
      expect(charCash(fake)).toBe(1000);
      expect(placerCapital(fake)).toBe(5000);
      expect(openOrders(fake)).toHaveLength(0);
      expect(receipt(fake, key)?.status).toBe("failed");
      continue;
    }
    if (retry.ok) {
      expect(retry.body).toEqual(plan.response);
      assertState(fake, key);
    } else {
      // Plan-store crash: the claim landed but no step ever ran, so the
      // failure is terminal-for-this-key with nothing moved.
      expect(retry.status).toBe(500);
      expect(charCash(fake)).toBe(1000);
      expect(placerCapital(fake)).toBe(5000);
      expect(openOrders(fake)).toHaveLength(0);
      expect(receipt(fake, key)?.status).toBe("failed");
    }
  }
}

describe("shareOrderPlacement", () => {
  it("character buy-pending escrows once and converges across every write crash", async () => {
    const fake = makeFakeDb();
    seedWorld(fake);
    const plan = buildPlan("buy-pending-1", { kind: "buy-pending" });
    const body = await expectSuccess(fake, plan, "buy-pending-1");
    expect(body).toEqual(plan.response);
    expectBuyPendingState(fake, "buy-pending-1", 920, 80);

    await crashAcrossWrites({ kind: "buy-pending" }, (f, k) =>
      expectBuyPendingState(f, k, 920, 80)
    );
  });

  it("character buy-immediate fills once and converges across every write crash", async () => {
    const fake = makeFakeDb();
    seedWorld(fake);
    const plan = buildPlan("buy-now-1", { kind: "buy-immediate" });
    await expectSuccess(fake, plan, "buy-now-1");
    expectBuyImmediateState(fake, "buy-now-1");

    await crashAcrossWrites({ kind: "buy-immediate" }, expectBuyImmediateState);
  });

  it("character sell-pending reserves once and converges across every write crash", async () => {
    const fake = makeFakeDb();
    seedWorld(fake);
    const plan = buildPlan("sell-pending-1", { kind: "sell-pending" });
    await expectSuccess(fake, plan, "sell-pending-1");
    expectSellPendingState(fake, "sell-pending-1");

    await crashAcrossWrites({ kind: "sell-pending" }, expectSellPendingState);
  });

  it("character sell-immediate pays once and converges across every write crash", async () => {
    const fake = makeFakeDb();
    seedWorld(fake);
    const plan = buildPlan("sell-now-1", { kind: "sell-immediate" });
    await expectSuccess(fake, plan, "sell-now-1");
    expectSellImmediateState(fake, "sell-now-1");

    await crashAcrossWrites({ kind: "sell-immediate" }, expectSellImmediateState);
  });

  it("corporation buy-pending debits the treasury and converges", async () => {
    const fake = makeFakeDb();
    seedWorld(fake);
    const plan = buildPlan("corp-buy-pending-1", { kind: "buy-pending", placer: "corporation" });
    await expectSuccess(fake, plan, "corp-buy-pending-1");
    expect(placerCapital(fake)).toBe(4920);
    expect(openOrders(fake)).toHaveLength(1);
    expect(receipt(fake, "corp-buy-pending-1")?.status).toBe("completed");

    await crashAcrossWrites({ kind: "buy-pending", placer: "corporation" }, (f, k) => {
      expect(placerCapital(f)).toBe(4920);
      expect(openOrders(f)).toHaveLength(1);
      expect(receipt(f, k)?.status).toBe("completed");
    });
  });

  it("corporation buy-immediate credits the corp cap row and converges", async () => {
    const fake = makeFakeDb();
    seedWorld(fake);
    seedDoc(fake, "corporations", {
      _id: TARGET_CORP_ID,
      name: "TargetCo",
      liquidCapital: 10000,
      publicFloat: 500,
      shareholders: [{ corporationId: PLACER_CORP_ID, shares: 50, avgCostPerShare: 9 }],
    });
    const plan = buildPlan("corp-buy-now-1", { kind: "buy-immediate", placer: "corporation" });
    await expectSuccess(fake, plan, "corp-buy-now-1");
    expect(placerCapital(fake)).toBe(4900);
    const corp = targetCorp(fake);
    expect(corp.publicFloat).toBe(490);
    const row = (corp.shareholders as Doc[]).find(
      (r) => docKey(r.corporationId) === PLACER_CORP_ID.toHexString()
    );
    expect(row!.shares).toBe(60);
    expect(receipt(fake, "corp-buy-now-1")?.status).toBe("completed");

    await crashAcrossWrites({ kind: "buy-immediate", placer: "corporation" }, (f, k) => {
      expect(placerCapital(f)).toBe(4900);
      const c = targetCorp(f);
      expect(c.publicFloat).toBe(490);
      const pushed = (c.shareholders as Doc[]).find(
        (r) => docKey(r.corporationId) === PLACER_CORP_ID.toHexString()
      );
      expect(pushed!.shares).toBe(10);
      expect(receipt(f, k)?.status).toBe("completed");
    });
  });

  it("corporation sell-pending reserves corp shares and converges", async () => {
    const fake = makeFakeDb();
    seedWorld(fake);
    seedDoc(fake, "corporations", {
      _id: TARGET_CORP_ID,
      name: "TargetCo",
      liquidCapital: 10000,
      publicFloat: 500,
      shareholders: [{ corporationId: PLACER_CORP_ID, shares: 50, avgCostPerShare: 9 }],
    });
    const plan = buildPlan("corp-sell-pending-1", { kind: "sell-pending", placer: "corporation" });
    await expectSuccess(fake, plan, "corp-sell-pending-1");
    const corp = targetCorp(fake);
    const row = (corp.shareholders as Doc[]).find(
      (r) => docKey(r.corporationId) === PLACER_CORP_ID.toHexString()
    );
    expect(row!.shares).toBe(40);
    expect(openOrders(fake)).toHaveLength(1);
    expect(receipt(fake, "corp-sell-pending-1")?.status).toBe("completed");

    await crashAcrossWrites(
      { kind: "sell-pending", placer: "corporation" },
      (f, k) => {
        const c = targetCorp(f);
        const reserved = (c.shareholders as Doc[]).find(
          (r) => docKey(r.corporationId) === PLACER_CORP_ID.toHexString()
        );
        expect(reserved!.shares).toBe(40);
        expect(openOrders(f)).toHaveLength(1);
        expect(receipt(f, k)?.status).toBe("completed");
      },
      { corpShares: 50 }
    );
  });

  it("corporation sell-immediate through the escrow split debits both pots exactly", async () => {
    const fake = makeFakeDb();
    seedWorld(fake, { escrowMode: true, escrowBalance: 60 });
    seedDoc(fake, "corporations", {
      _id: TARGET_CORP_ID,
      name: "TargetCo",
      liquidCapital: 10000,
      publicFloat: 500,
      shareBuybackMode: "escrow",
      shareEscrowBalance: 60,
      shareholders: [{ corporationId: PLACER_CORP_ID, shares: 50, avgCostPerShare: 9 }],
    });
    const plan = buildPlan("corp-sell-escrow-1", {
      kind: "sell-immediate",
      placer: "corporation",
      dealer: { kind: "escrow-split", amountLocal: 100, escrowPart: 60, treasuryPart: 40 },
    });
    await expectSuccess(fake, plan, "corp-sell-escrow-1");
    const corp = targetCorp(fake);
    expect(corp.shareEscrowBalance).toBe(0);
    expect(corp.liquidCapital).toBe(9960);
    expect(placerCapital(fake)).toBe(5100);
    expect(corp.publicFloat).toBe(510);

    await crashAcrossWrites(
      {
        kind: "sell-immediate",
        placer: "corporation",
        dealer: { kind: "escrow-split", amountLocal: 100, escrowPart: 60, treasuryPart: 40 },
      },
      (f, k) => {
        const c = targetCorp(f);
        expect(c.shareEscrowBalance).toBe(0);
        expect(c.liquidCapital).toBe(9960);
        expect(receipt(f, k)?.status).toBe("completed");
      },
      { escrowMode: true, escrowBalance: 60, corpShares: 50 }
    );
  });

  it("escrow-split revert restores both pots when the seller debit loses the race", async () => {
    const fake = makeFakeDb();
    seedWorld(fake, { escrowMode: true, escrowBalance: 60 });
    const stranger = new ObjectId("999999999999999999999999");
    const plan = buildPlan("escrow-race-1", {
      kind: "sell-immediate",
      capDebitIdHex: stranger.toHexString(),
      dealer: { kind: "escrow-split", amountLocal: 100, escrowPart: 60, treasuryPart: 40 },
    });
    const result = await executeShareOrderPlacementFlow(asDb(fake), plan, {
      idempotencyKey: "escrow-race-1",
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error).toBe("ERR_RESERVE");
    expect(result.status).toBe(409);
    const corp = targetCorp(fake);
    expect(corp.shareEscrowBalance).toBe(60);
    expect(corp.liquidCapital).toBe(10000);
    expect(charCash(fake)).toBe(1000);
    expect(receipt(fake, "escrow-race-1")?.status).toBe("compensated");
  });

  it("pool dealer credit converges and a pool-depth race keeps the legacy 400", async () => {
    const fake = makeFakeDb();
    seedWorld(fake);
    seedDoc(fake, EQUITY_MARKET_POOLS_COLLECTION, { _id: "USD", cashLocal: 10000 });
    const plan = buildPlan("pool-buy-1", {
      kind: "buy-immediate",
      dealer: { kind: "pool", currency: "USD", amountLocal: 100, flowKind: "purchasesIn" },
    });
    await expectSuccess(fake, plan, "pool-buy-1");
    const pool = getColl(fake, EQUITY_MARKET_POOLS_COLLECTION).get("USD")!;
    expect(pool.cashLocal).toBe(10100);
    expect(charCash(fake)).toBe(900);

    const shallow = makeFakeDb();
    seedWorld(shallow);
    seedDoc(shallow, EQUITY_MARKET_POOLS_COLLECTION, { _id: "USD", cashLocal: 50 });
    const sellPlan = buildPlan("pool-sell-race-1", {
      kind: "sell-immediate",
      dealer: { kind: "pool", currency: "USD", amountLocal: -100, flowKind: "salesOut" },
    });
    const raced = await executeShareOrderPlacementFlow(asDb(shallow), sellPlan, {
      idempotencyKey: "pool-sell-race-1",
    });
    expect(raced.ok).toBe(false);
    if (raced.ok) throw new Error("expected failure");
    expect(raced.error).toBe("ERR_DEALER");
    expect(raced.status).toBe(400);
    expect(charCash(shallow)).toBe(1000);
    const corp = targetCorp(shallow);
    const row = (corp.shareholders as Doc[]).find(
      (r) => docKey(r.characterId) === CHAR_ID.toHexString()
    );
    expect(row!.shares).toBe(100);
    expect(receipt(shallow, "pool-sell-race-1")?.status).toBe("failed");
  });

  it("float race on an immediate buy compensates the debit with the legacy 409", async () => {
    const fake = makeFakeDb();
    seedWorld(fake);
    seedDoc(fake, "corporations", {
      _id: TARGET_CORP_ID,
      name: "TargetCo",
      liquidCapital: 10000,
      publicFloat: 5,
      shareholders: [{ characterId: CHAR_ID, shares: 100, avgCostPerShare: 9 }],
    });
    const plan = buildPlan("float-race-1", { kind: "buy-immediate" });
    const result = await executeShareOrderPlacementFlow(asDb(fake), plan, {
      idempotencyKey: "float-race-1",
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error).toBe("ERR_FLOAT");
    expect(result.status).toBe(409);
    expect(charCash(fake)).toBe(1000);
    expect(receipt(fake, "float-race-1")?.status).toBe("compensated");
  });

  it("same-key replay returns the stored body without moving money twice", async () => {
    const fake = makeFakeDb();
    seedWorld(fake);
    const plan = buildPlan("replay-1", { kind: "buy-pending" });
    const first = await expectSuccess(fake, plan, "replay-1");
    const second = await executeShareOrderPlacementFlow(asDb(fake), plan, {
      idempotencyKey: "replay-1",
    });
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error("expected ok");
    expect(second.replayed).toBe(true);
    expect(second.body).toEqual(first);
    expect(charCash(fake)).toBe(920);
    expect(openOrders(fake)).toHaveLength(1);
  });

  it("competing keys race truthfully: the loser keeps the legacy 400 with nothing moved twice", async () => {
    const fake = makeFakeDb();
    seedWorld(fake);
    const planA = buildPlan("race-a", { kind: "buy-pending" });
    const planB = buildPlan("race-b", { kind: "buy-pending" });
    await expectSuccess(fake, planA, "race-a");
    // Only 50 left: the competing key's debit guard rejects truthfully.
    getColl(fake, "characters").get(CHAR_ID.toHexString())!.cashOnHand = 50;
    const loser = await executeShareOrderPlacementFlow(asDb(fake), planB, {
      idempotencyKey: "race-b",
    });
    expect(loser.ok).toBe(false);
    if (loser.ok) throw new Error("expected failure");
    expect(loser.error).toBe("ERR_DEBIT");
    expect(loser.status).toBe(400);
    expect(openOrders(fake)).toHaveLength(1);
    expect(receipt(fake, "race-b")?.status).toBe("failed");
  });

  it("same key with a different fingerprint fails closed", async () => {
    const fake = makeFakeDb();
    seedWorld(fake);
    const plan = buildPlan("conflict-1", { kind: "buy-pending" });
    await expectSuccess(fake, plan, "conflict-1");
    const other = buildPlan("conflict-1", { kind: "buy-pending", shares: 5 });
    await expect(
      executeShareOrderPlacementFlow(asDb(fake), other, { idempotencyKey: "conflict-1" })
    ).rejects.toBeInstanceOf(MoneyFlowKeyConflictError);
    expect(charCash(fake)).toBe(920);
    expect(openOrders(fake)).toHaveLength(1);
  });

  it("a settled-failed key stays terminal for the same key", async () => {
    const fake = makeFakeDb();
    seedWorld(fake);
    seedDoc(fake, "characters", { _id: CHAR_ID, name: "Buyer", cashOnHand: 10 });
    const plan = buildPlan("terminal-1", { kind: "buy-pending" });
    const first = await executeShareOrderPlacementFlow(asDb(fake), plan, {
      idempotencyKey: "terminal-1",
    });
    expect(first.ok).toBe(false);
    await expect(
      executeShareOrderPlacementFlow(asDb(fake), plan, { idempotencyKey: "terminal-1" })
    ).rejects.toBeInstanceOf(MoneyFlowTerminalError);
  });

  it("partial placement failure leaves conservation intact across a new-key retry and the orphan scan", async () => {
    const fake = makeFakeDb();
    seedWorld(fake);
    const planA = buildPlan("partial-a", { kind: "buy-immediate" });
    // Crash after the debit applied but before the fill completed.
    fake.faultAt = 3;
    try {
      await executeShareOrderPlacementFlow(asDb(fake), planA, { idempotencyKey: "partial-a" });
      throw new Error("expected crash");
    } catch (error) {
      expect((error as Error).message).toBe("injected-crash");
    } finally {
      fake.faultAt = null;
    }
    expect(receipt(fake, "partial-a")?.status).toBe("in_progress");
    // New-key retry of the same intent succeeds against the remaining cash.
    const planB = buildPlan("partial-b", { kind: "buy-immediate" });
    await expectSuccess(fake, planB, "partial-b");
    // The orphan scan converges the crashed attempt: two debits funded two fills.
    const scanned = await recoverShareOrderPlacementOrphans(asDb(fake), 50);
    expect(scanned).toHaveLength(1);
    expect(scanned[0]!.action).toBe("placement-recovered");
    expect(charCash(fake)).toBe(800);
    const corp = targetCorp(fake);
    expect(corp.publicFloat).toBe(480);
    const row = (corp.shareholders as Doc[]).find(
      (r) => docKey(r.characterId) === CHAR_ID.toHexString()
    );
    expect(row!.shares).toBe(120);
    expect(getColl(fake, "shareTradeHistory").size).toBe(2);
    expect(receipt(fake, "partial-a")?.status).toBe("completed");
  });

  it("orphan scan settles plan-less placement receipts failed and ignores foreign domains", async () => {
    const fake = makeFakeDb();
    seedWorld(fake);
    seedDoc(fake, NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION, {
      _id: "planless-1",
      status: "in_progress",
      fingerprint: `${SHARE_ORDER_PLACEMENT_FINGERPRINT_DOMAIN}:buy-pending:x`,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    seedDoc(fake, NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION, {
      _id: "foreign-1",
      status: "in_progress",
      fingerprint: "forex-fill:other",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const results = await recoverShareOrderPlacementOrphans(asDb(fake), 50);
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({ placementKey: "planless-1", action: "settled-failed-no-plan" });
    expect(receipt(fake, "planless-1")?.status).toBe("failed");
    expect(receipt(fake, "foreign-1")?.status).toBe("in_progress");
    expect(charCash(fake)).toBe(1000);
    expect(openOrders(fake)).toHaveLength(0);
  });

  it("key recovery converges a stranded receipt from only the key", async () => {
    const fake = makeFakeDb();
    seedWorld(fake);
    const plan = buildPlan("stranded-1", { kind: "sell-pending" });
    fake.faultAt = 4;
    try {
      await executeShareOrderPlacementFlow(asDb(fake), plan, { idempotencyKey: "stranded-1" });
    } catch (error) {
      expect((error as Error).message).toBe("injected-crash");
    } finally {
      fake.faultAt = null;
    }
    expect(receipt(fake, "stranded-1")?.status).toBe("in_progress");
    const recovered = await recoverShareOrderPlacementByKey(asDb(fake), "stranded-1");
    expect(recovered.ok).toBe(true);
    if (!recovered.ok) throw new Error("expected ok");
    expect(recovered.body).toEqual(plan.response);
    expectSellPendingState(fake, "stranded-1");
  });

  it("step builder covers buy/sell, immediate/pending, and dealer variants", () => {
    const fake = makeFakeDb();
    const kinds = ["buy-pending", "buy-immediate", "sell-pending", "sell-immediate"] as const;
    for (const kind of kinds) {
      const plan = buildPlan(`shape-${kind}`, { kind });
      const steps = buildShareOrderPlacementSteps(asDb(fake), plan);
      const names = steps.map((s) => s.name);
      if (kind === "buy-pending") expect(names).toEqual(["escrow-debit", "order-insert"]);
      if (kind === "buy-immediate") {
        expect(names).toEqual(["buyer-debit", "float", "buyer-credit", "dealer", "history"]);
      }
      if (kind === "sell-pending") expect(names).toEqual(["seller-debit", "order-insert"]);
      if (kind === "sell-immediate") {
        expect(names).toEqual(["dealer", "seller-debit", "float", "proceeds-credit", "history"]);
      }
    }
  });
});
