import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import {
  MoneyFlowKeyConflictError,
  MoneyFlowTerminalError,
  NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION,
  keyedInsertId,
} from "@/lib/db/nonAtomicMoneyFlow";
import {
  PUBLIC_SHARE_TRADE_FINGERPRINT_DOMAIN,
  PUBLIC_SHARE_TRADE_HISTORY_DOMAIN,
  buildOrderBookFillFingerprint,
  executePublicShareTradeFlow,
  getStoredPublicShareTradeResponse,
  recordCompletedTradeResponse,
  recoverPublicShareTradeByKey,
  recoverPublicShareTradeOrphans,
  recoverPublicShareTradeReceipt,
  type PublicShareTradePlan,
} from "./publicShareTradeSpend";
import { assertCeoAcquisitionWithinCap } from "@/lib/corporations/ceoShareAcquisitionCap";
import { emitTx } from "@/lib/financialTxLog/emit";
import { recordAudit } from "@/lib/audit/recordAudit";
import { safeDistributeConversionSpread } from "@/lib/currency/marketMaker";
import { onFloatSellCommitted } from "@/lib/corporations/shareEscrowSettlement";
import { closeCeoTenure } from "@/lib/corporations/ceoHistory";

vi.mock("@/lib/financialTxLog/emit", () => ({
  emitTx: vi.fn(),
}));
vi.mock("@/lib/audit/recordAudit", () => ({
  recordAudit: vi.fn(),
}));
vi.mock("@/lib/currency/marketMaker", () => ({
  safeDistributeConversionSpread: vi.fn(),
}));
vi.mock("@/lib/corporations/shareEscrowSettlement", () => ({
  onFloatSellCommitted: vi.fn(),
}));
vi.mock("@/lib/corporations/ceoHistory", () => ({
  closeCeoTenure: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Stateful in-memory fake honoring exactly the operators the public-share
// trade flow emits: receipt insert/find/update with dotted `$set` paths and
// duplicate-key (11000) inserts, keyed `$inc` legs with `$gte` + `$ne: key`
// guards, keyed positional cap-table updates (`shareholders.$`) with
// `$elemMatch` sufficiency or dotted-array equality guards, inc/push/inc
// credit triples under one subkey, plain `$pull` zero-row cleanup, `$push`
// key records in `$each`+`$slice` form, the single escrow-split pipeline
// update (floored escrow/treasury debit plus key record in one atomic
// write), CEO-vacate `$set`/`$unset` folded into the float step, `$exists`
// finds for the orphan scan, `countDocuments`, `deleteMany`, and a fault
// counter where the Nth write throws without landing, modeling a process
// death between sequential Mongo writes.
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
    updateMany: async (filter: Doc, update: Doc) => {
      maybeFault(fake);
      let matched = 0;
      for (const doc of coll().values()) {
        if (matchesFilter(doc, filter)) {
          applyObjectUpdate(doc, update, filter);
          matched += 1;
        }
      }
      return { matchedCount: matched, modifiedCount: matched };
    },
    deleteMany: async (filter: Doc) => {
      maybeFault(fake);
      let deleted = 0;
      for (const [key, doc] of [...coll().entries()]) {
        if (matchesFilter(doc, filter)) {
          coll().delete(key);
          deleted += 1;
        }
      }
      return { deletedCount: deleted };
    },
    countDocuments: async (filter: Doc) => {
      let count = 0;
      for (const doc of coll().values()) {
        if (matchesFilter(doc, filter)) count += 1;
      }
      return count;
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

const BUYER_ID = new ObjectId("111111111111111111111111");
const SELLER_ID = new ObjectId("444444444444444444444444");
const TARGET_CORP_ID = new ObjectId("333333333333333333333333");
const CEO_USER_ID = new ObjectId("666666666666666666666666");
const NOW_ISO = new Date("2026-09-01T00:00:00Z").toISOString();

function seedBuyerWorld(fake: FakeDb, opts: { cash?: number; float?: number } = {}): void {
  seedDoc(fake, "characters", { _id: BUYER_ID, name: "Buyer", cashOnHand: opts.cash ?? 1000 });
  seedDoc(fake, "corporations", {
    _id: TARGET_CORP_ID,
    name: "TargetCo",
    liquidCapital: 10000,
    publicFloat: opts.float ?? 500,
    shareholders: [{ characterId: BUYER_ID, shares: 100, avgCostPerShare: 9 }],
  });
}

function seedSellerWorld(
  fake: FakeDb,
  opts: { cash?: number; shares?: number; treasury?: number; escrow?: number } = {}
): void {
  seedDoc(fake, "characters", { _id: SELLER_ID, name: "Seller", cashOnHand: opts.cash ?? 1000 });
  seedDoc(fake, "corporations", {
    _id: TARGET_CORP_ID,
    name: "TargetCo",
    liquidCapital: opts.treasury ?? 10000,
    shareEscrowBalance: opts.escrow ?? 0,
    publicFloat: 500,
    shareholders: [{ characterId: SELLER_ID, shares: opts.shares ?? 100, avgCostPerShare: 9 }],
  });
}

function seedCeoSellerWorld(fake: FakeDb): void {
  seedDoc(fake, "characters", { _id: SELLER_ID, name: "SellerCeo", cashOnHand: 1000 });
  seedDoc(fake, "corporations", {
    _id: TARGET_CORP_ID,
    name: "TargetCo",
    liquidCapital: 10000,
    publicFloat: 500,
    ceoId: SELLER_ID,
    userId: CEO_USER_ID,
    ceoVacant: false,
    shareholders: [{ characterId: SELLER_ID, shares: 100, avgCostPerShare: 9 }],
  });
  seedDoc(fake, "corporationCeoVotes", {
    _id: new ObjectId("777777777777777777777777"),
    corporationId: TARGET_CORP_ID,
    voter: SELLER_ID,
  });
}

interface TradePlanOverrides {
  key?: string;
  kind?: PublicShareTradePlan["kind"];
  shares?: number;
  executionPrice?: number;
  debitAmount?: number;
  proceedsAmount?: number;
  dealer?: PublicShareTradePlan["dealer"];
  ceoVacate?: PublicShareTradePlan["ceoVacate"];
  closeTenure?: boolean;
  spread?: PublicShareTradePlan["spread"];
  audit?: PublicShareTradePlan["audit"];
  missingProceeds?: boolean;
  errors?: PublicShareTradePlan["errors"];
  response?: Record<string, unknown>;
}

const BASE_ERRORS: PublicShareTradePlan["errors"] = {
  "buyer-debit": { message: "ERR_BUYER_DEBIT", status: 400 },
  float: { message: "ERR_FLOAT", status: 409 },
  "buyer-credit": { message: "ERR_BUYER_CREDIT", status: 500 },
  dealer: { message: "ERR_DEALER", status: 500 },
  "seller-debit": { message: "ERR_SELLER_DEBIT", status: 409 },
  "proceeds-credit": { message: "ERR_PROCEEDS", status: 500 },
  history: { message: "ERR_HISTORY", status: 500 },
};

function buildTradePlan(
  tradeKey: string,
  overrides: TradePlanOverrides = {}
): PublicShareTradePlan {
  const kind = overrides.kind ?? "market-buy";
  const shares = overrides.shares ?? 10;
  const executionPrice = overrides.executionPrice ?? 10;
  const notional = shares * executionPrice;
  const isBuy = kind === "market-buy";
  const partyIdHex = isBuy ? BUYER_ID.toHexString() : SELLER_ID.toHexString();
  const partyName = isBuy ? "Buyer" : "Seller";
  return {
    version: 1,
    tradeKey,
    kind,
    corpIdHex: TARGET_CORP_ID.toHexString(),
    corpName: "TargetCo",
    shares,
    executionPrice,
    turn: 7,
    nowIso: NOW_ISO,
    orderFlowEligible: false,
    washExcluded: false,
    buyerDebit: isBuy
      ? {
          collection: "characters",
          idHex: partyIdHex,
          field: "cashOnHand",
          amount: overrides.debitAmount ?? notional,
        }
      : null,
    capCredit: isBuy
      ? { field: "characterId", idHex: partyIdHex, pricePerShare: executionPrice }
      : null,
    capDebit: !isBuy ? { field: "characterId", idHex: partyIdHex, pricePerShare: 9 } : null,
    proceedsLeg: !isBuy
      ? {
          collection: "characters",
          idHex: overrides.missingProceeds ? new ObjectId().toHexString() : partyIdHex,
          field: "cashOnHand",
          amount: overrides.proceedsAmount ?? notional,
        }
      : null,
    dealer:
      overrides.dealer !== undefined
        ? overrides.dealer
        : isBuy
          ? { kind: "treasury", amountLocal: notional }
          : { kind: "treasury", amountLocal: -notional },
    ceoVacate: overrides.ceoVacate ?? null,
    closeTenureHolderIdHex: overrides.closeTenure ? SELLER_ID.toHexString() : null,
    tx: {
      type: isBuy ? "stock_trade_buy" : "stock_trade_sell",
      subjectType: "character",
      subjectIdHex: partyIdHex,
      subjectName: partyName,
      amount: isBuy ? -(overrides.debitAmount ?? notional) : (overrides.proceedsAmount ?? notional),
      includeBalanceAfter: isBuy,
      currencyCode: "USD",
      counterpartyType: "corporation",
      counterpartyIdHex: TARGET_CORP_ID.toHexString(),
      counterpartyName: "TargetCo",
      meta: { corporationId: TARGET_CORP_ID.toHexString(), shares, pricePerShare: executionPrice },
    },
    history: {
      kind: isBuy ? "market_buy" : "market_sell",
      shares,
      pricePerShareAnchor: executionPrice,
      from: isBuy ? null : { characterId: SELLER_ID, name: "Seller" },
      to: isBuy ? { characterId: BUYER_ID, name: "Buyer" } : null,
      corpCurrencyCode: undefined,
    },
    spread: overrides.spread ?? null,
    audit:
      overrides.audit !== undefined
        ? overrides.audit
        : !isBuy
          ? {
              counterpartyType: "character",
              counterpartyIdHex: partyIdHex,
              counterpartyName: partyName,
              amount: overrides.proceedsAmount ?? notional,
              currencyCode: "USD",
              shares,
              pricePerShare: executionPrice,
            }
          : null,
    notifyTakeover: isBuy,
    errors: overrides.errors ?? { ...BASE_ERRORS },
    response: overrides.response ?? { success: true, marker: `${kind}:${tradeKey}` },
  };
}

function targetCorp(fake: FakeDb): Doc {
  return getColl(fake, "corporations").get(TARGET_CORP_ID.toHexString())!;
}

function charDoc(fake: FakeDb, id: ObjectId): Doc {
  return getColl(fake, "characters").get(id.toHexString())!;
}

function holderShares(fake: FakeDb, holderId: ObjectId): number | undefined {
  const rows = (targetCorp(fake).shareholders as Doc[] | undefined) ?? [];
  return rows.find((row) => valueEquals(row.characterId, holderId))?.shares as number | undefined;
}

function receipt(fake: FakeDb, key: string): Doc | undefined {
  return getColl(fake, NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION).get(key);
}

function historyRows(fake: FakeDb): Doc[] {
  return [...getColl(fake, "shareTradeHistory").values()];
}

async function flushPostCommit(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function expectOk(
  fake: FakeDb,
  plan: PublicShareTradePlan,
  key: string
): Promise<Record<string, unknown>> {
  const result = await executePublicShareTradeFlow(asDb(fake), plan, { idempotencyKey: key });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`expected ok: ${(result as { error: string }).error}`);
  await flushPostCommit();
  return result.body;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(emitTx).mockResolvedValue("applied");
  vi.mocked(safeDistributeConversionSpread).mockResolvedValue(undefined);
  vi.mocked(onFloatSellCommitted).mockResolvedValue(undefined);
  vi.mocked(closeCeoTenure).mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// Market buys
// ---------------------------------------------------------------------------

function expectBuyState(fake: FakeDb, key: string): void {
  expect(charDoc(fake, BUYER_ID).cashOnHand).toBe(900);
  const corp = targetCorp(fake);
  expect(corp.publicFloat).toBe(490);
  expect(corp.liquidCapital).toBe(10100);
  expect(corp.shareIssuanceProceeds).toBe(100);
  expect(holderShares(fake, BUYER_ID)).toBe(110);
  expect(historyRows(fake)).toHaveLength(1);
  expect(receipt(fake, key)?.status).toBe("completed");
}

/** Crash at every write boundary, then retry the same key to convergence. */
async function crashBuyAcrossWrites(): Promise<void> {
  const probe = makeFakeDb();
  seedBuyerWorld(probe);
  await expectOk(probe, buildTradePlan("probe"), "probe");
  const totalWrites = probe.writes;
  expect(totalWrites).toBeGreaterThan(3);
  for (let faultAt = 1; faultAt <= totalWrites; faultAt += 1) {
    const fake = makeFakeDb();
    seedBuyerWorld(fake);
    const key = `buy-crash-${faultAt}`;
    const plan = buildTradePlan(key);
    fake.faultAt = faultAt;
    let first: unknown;
    try {
      first = await executePublicShareTradeFlow(asDb(fake), plan, { idempotencyKey: key });
      await flushPostCommit();
    } catch (error) {
      first = error;
    } finally {
      fake.faultAt = null;
    }
    if (first instanceof Error) {
      expect(first.message).toBe("injected-crash");
    }
    let retry: Awaited<ReturnType<typeof executePublicShareTradeFlow>>;
    try {
      retry = await executePublicShareTradeFlow(asDb(fake), plan, { idempotencyKey: key });
      await flushPostCommit();
    } catch (error) {
      // Plan-store crash: the fake keeps executing the settle-failed line a
      // real crash would never reach, so the same-key retry throws terminal.
      // Either way the state is truthful: nothing moved, new key required.
      expect(error).toBeInstanceOf(MoneyFlowTerminalError);
      expect((error as Error).message).toContain("plan-store");
      expect(charDoc(fake, BUYER_ID).cashOnHand).toBe(1000);
      expect(targetCorp(fake).publicFloat).toBe(500);
      expect(holderShares(fake, BUYER_ID)).toBe(100);
      expect(historyRows(fake)).toHaveLength(0);
      expect(receipt(fake, key)?.status).toBe("failed");
      continue;
    }
    if (retry.ok) {
      expect(retry.body).toEqual(plan.response);
      expectBuyState(fake, key);
    } else {
      expect(retry.status).toBe(500);
      expect(charDoc(fake, BUYER_ID).cashOnHand).toBe(1000);
      expect(targetCorp(fake).publicFloat).toBe(500);
      expect(holderShares(fake, BUYER_ID)).toBe(100);
      expect(historyRows(fake)).toHaveLength(0);
      expect(receipt(fake, key)?.status).toBe("failed");
    }
  }
}

describe("publicShareTradeSpend market-buy", () => {
  it("settles buyer debit, float, cap credit, treasury dealer, and history once", async () => {
    const fake = makeFakeDb();
    seedBuyerWorld(fake);
    const plan = buildTradePlan("buy-1");
    const body = await expectOk(fake, plan, "buy-1");
    expect(body).toEqual(plan.response);
    expectBuyState(fake, "buy-1");

    const rows = historyRows(fake);
    expect(docKey(rows[0]!._id)).toBe(
      keyedInsertId("buy-1", PUBLIC_SHARE_TRADE_HISTORY_DOMAIN).toHexString()
    );
    expect(rows[0]!.kind).toBe("market_buy");
    expect(vi.mocked(emitTx)).toHaveBeenCalledTimes(1);
    const txCall = vi.mocked(emitTx).mock.calls[0]!;
    expect(txCall[1]).toMatchObject({ type: "stock_trade_buy", amount: -100 });
    expect(txCall[3]).toMatchObject({ _id: expect.any(ObjectId) });
    expect(vi.mocked(recordAudit)).not.toHaveBeenCalled();
  });

  it("converges across a crash at every durable boundary", async () => {
    await crashBuyAcrossWrites();
  });

  it("replays a duplicate Idempotency-Key before guards without moving money", async () => {
    const fake = makeFakeDb();
    seedBuyerWorld(fake);
    const plan = buildTradePlan("buy-replay");
    await expectOk(fake, plan, "buy-replay");
    expect(vi.mocked(emitTx)).toHaveBeenCalledTimes(1);

    // Post-debit state would fail every guard; the replay must not re-run them.
    (getColl(fake, "characters").get(BUYER_ID.toHexString()) as Doc).cashOnHand = 0;
    (targetCorp(fake) as Doc).publicFloat = 0;
    const retry = await executePublicShareTradeFlow(asDb(fake), plan, {
      idempotencyKey: "buy-replay",
    });
    await flushPostCommit();
    expect(retry).toEqual({ ok: true, body: plan.response, replayed: true });
    expect(charDoc(fake, BUYER_ID).cashOnHand).toBe(0);
    expect(targetCorp(fake).publicFloat).toBe(0);
    expect(holderShares(fake, BUYER_ID)).toBe(110);
    expect(historyRows(fake)).toHaveLength(1);
    expect(vi.mocked(recordAudit)).not.toHaveBeenCalled();
  });

  it("fails closed when one key is reused for a different trade", async () => {
    const fake = makeFakeDb();
    seedBuyerWorld(fake);
    await expectOk(fake, buildTradePlan("buy-conflict", { shares: 10 }), "buy-conflict");
    await expect(
      executePublicShareTradeFlow(asDb(fake), buildTradePlan("buy-conflict", { shares: 11 }), {
        idempotencyKey: "buy-conflict",
      })
    ).rejects.toBeInstanceOf(MoneyFlowKeyConflictError);
    expect(charDoc(fake, BUYER_ID).cashOnHand).toBe(900);
  });

  it("settles distinct keys as distinct trades", async () => {
    const fake = makeFakeDb();
    seedBuyerWorld(fake);
    await expectOk(fake, buildTradePlan("buy-a"), "buy-a");
    await expectOk(fake, buildTradePlan("buy-b"), "buy-b");
    expect(charDoc(fake, BUYER_ID).cashOnHand).toBe(800);
    expect(targetCorp(fake).publicFloat).toBe(480);
    expect(holderShares(fake, BUYER_ID)).toBe(120);
    expect(historyRows(fake)).toHaveLength(2);
  });

  it("fails insufficient funds with nothing moved", async () => {
    const fake = makeFakeDb();
    seedBuyerWorld(fake, { cash: 50 });
    const plan = buildTradePlan("buy-poor", {
      errors: { ...BASE_ERRORS, "buyer-debit": { message: "Insufficient funds", status: 400 } },
    });
    const result = await executePublicShareTradeFlow(asDb(fake), plan, {
      idempotencyKey: "buy-poor",
    });
    await flushPostCommit();
    expect(result).toEqual({ ok: false, error: "Insufficient funds", status: 400 });
    expect(charDoc(fake, BUYER_ID).cashOnHand).toBe(50);
    expect(targetCorp(fake).publicFloat).toBe(500);
    expect(holderShares(fake, BUYER_ID)).toBe(100);
    expect(historyRows(fake)).toHaveLength(0);
    expect(receipt(fake, "buy-poor")?.status).toBe("failed");
    expect(vi.mocked(emitTx)).not.toHaveBeenCalled();
  });

  it("compensates the buyer debit when the float gate fails", async () => {
    const fake = makeFakeDb();
    seedBuyerWorld(fake, { float: 5 });
    const plan = buildTradePlan("buy-dry", {
      errors: {
        ...BASE_ERRORS,
        float: { message: "Only 5 shares available in public float", status: 409 },
      },
    });
    const result = await executePublicShareTradeFlow(asDb(fake), plan, {
      idempotencyKey: "buy-dry",
    });
    await flushPostCommit();
    expect(result).toEqual({
      ok: false,
      error: "Only 5 shares available in public float",
      status: 409,
    });
    expect(charDoc(fake, BUYER_ID).cashOnHand).toBe(1000);
    expect(targetCorp(fake).publicFloat).toBe(5);
    expect(holderShares(fake, BUYER_ID)).toBe(100);
    expect(historyRows(fake)).toHaveLength(0);
    expect(receipt(fake, "buy-dry")?.status).toBe("compensated");
    expect(vi.mocked(emitTx)).not.toHaveBeenCalled();
  });

  it("counts the keyed history row toward the CEO acquisition cap", async () => {
    const fake = makeFakeDb();
    seedBuyerWorld(fake);
    seedDoc(fake, "corporations", {
      ...targetCorp(fake),
      totalShares: 100,
      ceoId: BUYER_ID,
      ceoVacant: false,
    });
    const plan = buildTradePlan("buy-ceo-cap");
    await expectOk(fake, plan, "buy-ceo-cap");
    const over = await assertCeoAcquisitionWithinCap(
      asDb(fake),
      {
        _id: TARGET_CORP_ID,
        name: "TargetCo",
        totalShares: 100,
        ceoId: BUYER_ID,
        ceoVacant: false,
      },
      BUYER_ID,
      "characterId",
      1,
      7
    );
    // Cap is 10% of 100 = 10 shares; the keyed buy of 10 leaves no room.
    expect(over).not.toBeNull();
    expect(over!.status).toBe(400);
    const under = await assertCeoAcquisitionWithinCap(
      asDb(fake),
      {
        _id: TARGET_CORP_ID,
        name: "TargetCo",
        totalShares: 10000,
        ceoId: BUYER_ID,
        ceoVacant: false,
      },
      BUYER_ID,
      "characterId",
      1,
      7
    );
    expect(under).toBeNull();
  });

  it("keeps the trade completed when post-commit tx and spread writes fail", async () => {
    const fake = makeFakeDb();
    seedBuyerWorld(fake);
    vi.mocked(emitTx).mockRejectedValue(new Error("tx-down"));
    vi.mocked(safeDistributeConversionSpread).mockRejectedValue(new Error("spread-down"));
    const plan = buildTradePlan("buy-best-effort", {
      spread: { fee: 3, from: "USD", to: "EUR" },
    });
    const body = await expectOk(fake, plan, "buy-best-effort");
    expect(body).toEqual(plan.response);
    expectBuyState(fake, "buy-best-effort");
    expect(vi.mocked(safeDistributeConversionSpread).mock.calls[0]!.slice(1)).toEqual([
      3,
      "USD",
      "EUR",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Market sells
// ---------------------------------------------------------------------------

function expectSellState(fake: FakeDb, key: string): void {
  expect(charDoc(fake, SELLER_ID).cashOnHand).toBe(1100);
  const corp = targetCorp(fake);
  expect(corp.publicFloat).toBe(510);
  expect(corp.liquidCapital).toBe(9900);
  expect(holderShares(fake, SELLER_ID)).toBe(90);
  expect(historyRows(fake)).toHaveLength(1);
  expect(historyRows(fake)[0]!.kind).toBe("market_sell");
  expect(receipt(fake, key)?.status).toBe("completed");
}

describe("publicShareTradeSpend market-sell", () => {
  it("settles issuer debit, share debit, float, and proceeds once", async () => {
    const fake = makeFakeDb();
    seedSellerWorld(fake);
    const plan = buildTradePlan("sell-1", { kind: "market-sell" });
    const body = await expectOk(fake, plan, "sell-1");
    expect(body).toEqual(plan.response);
    expectSellState(fake, "sell-1");

    expect(vi.mocked(emitTx)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(emitTx).mock.calls[0]![1]).toMatchObject({
      type: "stock_trade_sell",
      amount: 100,
    });
    expect(vi.mocked(recordAudit)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(onFloatSellCommitted)).toHaveBeenCalledTimes(1);

    // Same-key replay returns the stored body and fires no new notifications.
    const replay = await executePublicShareTradeFlow(asDb(fake), plan, {
      idempotencyKey: "sell-1",
    });
    await flushPostCommit();
    expect(replay).toEqual({ ok: true, body: plan.response, replayed: true });
    expectSellState(fake, "sell-1");
    expect(vi.mocked(recordAudit)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(onFloatSellCommitted)).toHaveBeenCalledTimes(1);
  });

  it("splits escrow-mode issuer debit across escrow and treasury", async () => {
    const fake = makeFakeDb();
    seedSellerWorld(fake, { escrow: 50 });
    const plan = buildTradePlan("sell-escrow", {
      kind: "market-sell",
      dealer: { kind: "escrow-split", amountLocal: 100, escrowPart: 30, treasuryPart: 70 },
    });
    await expectOk(fake, plan, "sell-escrow");
    const corp = targetCorp(fake);
    expect(corp.shareEscrowBalance).toBe(20);
    expect(corp.liquidCapital).toBe(9930);
    expect(charDoc(fake, SELLER_ID).cashOnHand).toBe(1100);
    expect(holderShares(fake, SELLER_ID)).toBe(90);
    expect(corp.publicFloat).toBe(510);
    expect(receipt(fake, "sell-escrow")?.status).toBe("completed");
  });

  it("compensates the issuer debit when the seller lacks shares", async () => {
    const fake = makeFakeDb();
    seedSellerWorld(fake, { shares: 5 });
    const plan = buildTradePlan("sell-short", {
      kind: "market-sell",
      errors: {
        ...BASE_ERRORS,
        "seller-debit": {
          message: "Shares were already sold or reserved by another action",
          status: 409,
        },
      },
    });
    const result = await executePublicShareTradeFlow(asDb(fake), plan, {
      idempotencyKey: "sell-short",
    });
    await flushPostCommit();
    expect(result).toEqual({
      ok: false,
      error: "Shares were already sold or reserved by another action",
      status: 409,
    });
    expect(targetCorp(fake).liquidCapital).toBe(10000);
    expect(holderShares(fake, SELLER_ID)).toBe(5);
    expect(targetCorp(fake).publicFloat).toBe(500);
    expect(charDoc(fake, SELLER_ID).cashOnHand).toBe(1000);
    expect(historyRows(fake)).toHaveLength(0);
    expect(receipt(fake, "sell-short")?.status).toBe("compensated");
    expect(vi.mocked(recordAudit)).not.toHaveBeenCalled();
    expect(vi.mocked(closeCeoTenure)).not.toHaveBeenCalled();
  });

  it("fails the treasury gate with nothing moved", async () => {
    const fake = makeFakeDb();
    seedSellerWorld(fake, { treasury: 40 });
    const plan = buildTradePlan("sell-broke-treasury", {
      kind: "market-sell",
      errors: {
        ...BASE_ERRORS,
        dealer: { message: "TargetCo's treasury can't cover this sale", status: 400 },
      },
    });
    const result = await executePublicShareTradeFlow(asDb(fake), plan, {
      idempotencyKey: "sell-broke-treasury",
    });
    await flushPostCommit();
    expect(result).toEqual({
      ok: false,
      error: "TargetCo's treasury can't cover this sale",
      status: 400,
    });
    expect(targetCorp(fake).liquidCapital).toBe(40);
    expect(holderShares(fake, SELLER_ID)).toBe(100);
    expect(receipt(fake, "sell-broke-treasury")?.status).toBe("failed");
  });

  it("vacates the CEO seat on a full sell and restores it on compensation", async () => {
    const fake = makeFakeDb();
    seedCeoSellerWorld(fake);
    const vacatePlan = buildTradePlan("sell-vacate", {
      kind: "market-sell",
      ceoVacate: {
        ceoIdHex: SELLER_ID.toHexString(),
        userIdHex: CEO_USER_ID.toHexString(),
        ceoVacant: false,
      },
      closeTenure: true,
    });
    await expectOk(fake, vacatePlan, "sell-vacate");
    const vacated = targetCorp(fake);
    expect(vacated.ceoVacant).toBe(true);
    expect(vacated.ceoId).toBeUndefined();
    expect(vacated.userId).toBeUndefined();
    expect(holderShares(fake, SELLER_ID)).toBe(90);
    expect(vi.mocked(closeCeoTenure)).toHaveBeenCalledTimes(1);
    const tenureCall = vi.mocked(closeCeoTenure).mock.calls[0]!;
    expect(tenureCall[1]).toEqual(TARGET_CORP_ID);
    expect(tenureCall[2]).toEqual({ holderId: SELLER_ID, turn: 7 });
    expect(getColl(fake, "corporationCeoVotes").size).toBe(0);

    // A late proceeds failure compensates the whole prefix, including the
    // vacate: the exact prior CEO fields come back.
    const doomed = makeFakeDb();
    seedCeoSellerWorld(doomed);
    const doomedPlan = buildTradePlan("sell-vacate-doomed", {
      kind: "market-sell",
      ceoVacate: {
        ceoIdHex: SELLER_ID.toHexString(),
        userIdHex: CEO_USER_ID.toHexString(),
        ceoVacant: false,
      },
      closeTenure: true,
      missingProceeds: true,
    });
    const doomedResult = await executePublicShareTradeFlow(asDb(doomed), doomedPlan, {
      idempotencyKey: "sell-vacate-doomed",
    });
    await flushPostCommit();
    expect(doomedResult.ok).toBe(false);
    const restored = targetCorp(doomed);
    expect(restored.ceoVacant).toBe(false);
    expect(docKey(restored.ceoId)).toBe(SELLER_ID.toHexString());
    expect(docKey(restored.userId)).toBe(CEO_USER_ID.toHexString());
    expect(holderShares(doomed, SELLER_ID)).toBe(100);
    expect(restored.publicFloat).toBe(500);
    expect(restored.liquidCapital).toBe(10000);
    expect(charDoc(doomed, SELLER_ID).cashOnHand).toBe(1000);
    expect(receipt(doomed, "sell-vacate-doomed")?.status).toBe("compensated");
    expect(vi.mocked(closeCeoTenure)).toHaveBeenCalledTimes(1);
    expect(getColl(doomed, "corporationCeoVotes").size).toBe(1);
  });

  it("keeps the sell completed when tenure close and escrow hooks fail", async () => {
    const fake = makeFakeDb();
    seedCeoSellerWorld(fake);
    vi.mocked(closeCeoTenure).mockRejectedValue(new Error("tenure-down"));
    vi.mocked(onFloatSellCommitted).mockRejectedValue(new Error("escrow-hook-down"));
    vi.mocked(emitTx).mockRejectedValue(new Error("tx-down"));
    const plan = buildTradePlan("sell-best-effort", {
      kind: "market-sell",
      ceoVacate: {
        ceoIdHex: SELLER_ID.toHexString(),
        userIdHex: CEO_USER_ID.toHexString(),
        ceoVacant: false,
      },
      closeTenure: true,
    });
    await expectOk(fake, plan, "sell-best-effort");
    expect(targetCorp(fake).ceoVacant).toBe(true);
    expect(holderShares(fake, SELLER_ID)).toBe(90);
    expect(receipt(fake, "sell-best-effort")?.status).toBe("completed");
  });
});

// ---------------------------------------------------------------------------
// Order-book completed receipts, legacy recovery, and orphan scans
// ---------------------------------------------------------------------------

describe("publicShareTradeSpend order-book and recovery", () => {
  it("stores an order-book fill as a completed receipt and replays it", async () => {
    const fake = makeFakeDb();
    const db = asDb(fake);
    const fingerprint = buildOrderBookFillFingerprint({
      corpId: TARGET_CORP_ID,
      sellerId: SELLER_ID,
      shares: 10,
      pricePerShareLocal: 10,
      proceedsAnchor: 100,
    });
    const body = { success: true, sharesSold: 10, proceeds: 100 };
    const first = await recordCompletedTradeResponse(db, "fill-key-1", fingerprint, body);
    expect(first).toEqual({ replayed: false, body });
    const second = await recordCompletedTradeResponse(db, "fill-key-1", fingerprint, body);
    expect(second).toEqual({ replayed: true, body });
    // A different fill under the same key fails closed.
    const other = buildOrderBookFillFingerprint({
      corpId: TARGET_CORP_ID,
      sellerId: SELLER_ID,
      shares: 11,
      pricePerShareLocal: 10,
      proceedsAnchor: 110,
    });
    await expect(
      recordCompletedTradeResponse(db, "fill-key-1", other, body)
    ).rejects.toBeInstanceOf(MoneyFlowKeyConflictError);
    // Route-level recovery replays the stored body.
    const recovered = await recoverPublicShareTradeByKey(db, "fill-key-1");
    expect(recovered).toEqual({ ok: true, body, replayed: true });
  });

  it("settles a plan-less legacy receipt as failed without moving money", async () => {
    const fake = makeFakeDb();
    seedBuyerWorld(fake);
    const now = new Date(NOW_ISO);
    seedDoc(fake, NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION, {
      _id: "legacy-trade",
      status: "in_progress",
      fingerprint: `${PUBLIC_SHARE_TRADE_FINGERPRINT_DOMAIN}:market-buy:legacy`,
      createdAt: now,
      updatedAt: now,
    });
    const lookup = await getStoredPublicShareTradeResponse(asDb(fake), "legacy-trade");
    expect(lookup).toEqual({ settled: false });
    const result = await recoverPublicShareTradeReceipt(asDb(fake), "legacy-trade");
    expect(result).toEqual({ tradeKey: "legacy-trade", action: "settled-failed-no-plan" });
    expect(receipt(fake, "legacy-trade")?.status).toBe("failed");
    expect(charDoc(fake, BUYER_ID).cashOnHand).toBe(1000);
    expect(targetCorp(fake).publicFloat).toBe(500);
    expect(holderShares(fake, BUYER_ID)).toBe(100);

    // A terminal receipt fails closed at the route surface.
    await expect(recoverPublicShareTradeByKey(asDb(fake), "legacy-trade")).rejects.toBeInstanceOf(
      MoneyFlowTerminalError
    );
  });

  it("reports a missing key lookup as null so the route validates fresh", async () => {
    const fake = makeFakeDb();
    expect(await getStoredPublicShareTradeResponse(asDb(fake), "no-such-key")).toBeNull();
    const missing = await recoverPublicShareTradeReceipt(asDb(fake), "no-such-key");
    expect(missing).toEqual({ tradeKey: "no-such-key", action: "skipped-missing" });
  });

  it("recovers a crashed in-progress trade from its stored plan", async () => {
    const fake = makeFakeDb();
    seedBuyerWorld(fake);
    const plan = buildTradePlan("buy-crash-recover");
    fake.faultAt = 3;
    await expect(
      executePublicShareTradeFlow(asDb(fake), plan, { idempotencyKey: "buy-crash-recover" })
    ).rejects.toThrow("injected-crash");
    fake.faultAt = null;
    expect(receipt(fake, "buy-crash-recover")?.status).toBe("in_progress");
    expect(await getStoredPublicShareTradeResponse(asDb(fake), "buy-crash-recover")).toEqual({
      settled: false,
    });
    const recovered = await recoverPublicShareTradeByKey(asDb(fake), "buy-crash-recover");
    expect(recovered.ok).toBe(true);
    if (recovered.ok) expect(recovered.body).toEqual(plan.response);
    await flushPostCommit();
    expectBuyState(fake, "buy-crash-recover");
  });

  it("converges orphans, settles plan-less receipts, and skips foreign ones", async () => {
    const fake = makeFakeDb();
    seedBuyerWorld(fake);
    // Crashed trade with a stored plan.
    const crashedPlan = buildTradePlan("orphan-trade");
    fake.faultAt = 4;
    await expect(
      executePublicShareTradeFlow(asDb(fake), crashedPlan, { idempotencyKey: "orphan-trade" })
    ).rejects.toThrow("injected-crash");
    fake.faultAt = null;
    expect(receipt(fake, "orphan-trade")?.status).toBe("in_progress");

    // Plan-less legacy receipt in this domain.
    const now = new Date(NOW_ISO);
    seedDoc(fake, NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION, {
      _id: "orphan-planless",
      status: "in_progress",
      fingerprint: `${PUBLIC_SHARE_TRADE_FINGERPRINT_DOMAIN}:market-sell:legacy`,
      createdAt: now,
      updatedAt: now,
    });
    // Foreign-domain receipt: never touched by this scan.
    seedDoc(fake, NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION, {
      _id: "orphan-foreign",
      status: "in_progress",
      fingerprint: "share-listing-cancel:foreign",
      createdAt: now,
      updatedAt: now,
    });
    // Settled receipts are out of scope.
    seedDoc(fake, NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION, {
      _id: "orphan-settled",
      status: "completed",
      fingerprint: `${PUBLIC_SHARE_TRADE_FINGERPRINT_DOMAIN}:market-buy:done`,
      createdAt: now,
      updatedAt: now,
    });

    const results = await recoverPublicShareTradeOrphans(asDb(fake), 50);
    await flushPostCommit();
    const byKey = new Map(results.map((r) => [r.tradeKey, r.action]));
    expect(byKey.get("orphan-trade")).toBe("trade-recovered");
    expect(byKey.get("orphan-planless")).toBe("settled-failed-no-plan");
    expect(byKey.has("orphan-foreign")).toBe(false);
    expect(byKey.has("orphan-settled")).toBe(false);
    expectBuyState(fake, "orphan-trade");
    expect(receipt(fake, "orphan-planless")?.status).toBe("failed");
    expect(receipt(fake, "orphan-foreign")?.status).toBe("in_progress");
  });
});
