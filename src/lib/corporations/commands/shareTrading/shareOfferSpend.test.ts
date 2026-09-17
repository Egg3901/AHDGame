import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import {
  MoneyFlowKeyConflictError,
  MoneyFlowTerminalError,
  NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION,
} from "@/lib/db/nonAtomicMoneyFlow";
import {
  buildShareOfferSubmitOfferId,
  executeShareOfferAcceptFlow,
  executeShareOfferSubmitFlow,
  recoverShareOfferAcceptByKey,
  recoverShareOfferAcceptOrphans,
  recoverShareOfferSubmitByKey,
  recoverShareOfferSubmitOrphans,
  type ShareOfferAcceptPlan,
  type ShareOfferSubmitPlan,
} from "./shareOfferSpend";
import { splitSpreadFee } from "@/lib/currency/spreadFees";
import { getCountryForCurrency } from "@/lib/currency/marketMaker";
import { getBankId } from "@/lib/centralBank/helpers";
import { emitTx } from "@/lib/financialTxLog/emit";

vi.mock("@/lib/financialTxLog/emit", () => ({
  emitTx: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Stateful in-memory fake honoring exactly the operators the offer flows
// emit: receipt insert/find/update with dotted `$set` paths and duplicate-key
// (11000) inserts, the shareOffers pending-unique (listingId,
// buyerCharacterId) partial index, CAS claim `$set` updates with `$ne: key`
// guards, keyed `$inc` cash credits/debits with `$gte` debit guards, keyed
// positional cap-table updates (`shareholders.$`) with dotted-array equality
// and `$not`/`$elemMatch` guards plus inc/push/inc triples under one subkey,
// `$push` key records in `$each`+`$slice` form, `$pull` deletes, `$exists`
// finds for the orphan scans, `countDocuments`, `deleteOne`, and a fault
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

function dupKey(message: string): Error {
  return Object.assign(new Error(message), { code: 11000 });
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
      if (coll().has(key)) throw dupKey("E11000 duplicate key error (_id)");
      // Mirror of unique_pending_share_offer_per_buyer_listing: partial on
      // status === "pending" over (listingId, buyerCharacterId).
      if (name === "shareOffers" && doc.status === "pending") {
        for (const existing of coll().values()) {
          if (
            existing.status === "pending" &&
            valueEquals(existing.listingId, doc.listingId) &&
            valueEquals(existing.buyerCharacterId, doc.buyerCharacterId)
          ) {
            throw dupKey(
              "E11000 duplicate key error collection: shareOffers index: unique_pending_share_offer_per_buyer_listing dup key"
            );
          }
        }
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
          applyObjectUpdate(doc, update, filter);
          return { matchedCount: 1, modifiedCount: 1 };
        }
      }
      return { matchedCount: 0, modifiedCount: 0 };
    },
    deleteOne: async (filter: Doc) => {
      maybeFault(fake);
      for (const [key, doc] of coll().entries()) {
        if (matchesFilter(doc, filter)) {
          coll().delete(key);
          return { deletedCount: 1 };
        }
      }
      return { deletedCount: 0 };
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

function readDoc(fake: FakeDb, collection: string, id: ObjectId): Doc {
  const doc = getColl(fake, collection).get(docKey(id));
  if (!doc) throw new Error(`missing ${collection} doc ${docKey(id)}`);
  return clone(doc);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(emitTx).mockResolvedValue("applied");
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const LISTING_ID = new ObjectId("aaaaaaaaaaaaaaaaaaaaaaaa");
const LISTING_CORP_ID = new ObjectId("bbbbbbbbbbbbbbbbbbbbbbbb");
const SELLER_ID = new ObjectId("cccccccccccccccccccccccc");
const BUYER_ID = new ObjectId("dddddddddddddddddddddddd");
const BUYER_CORP_ID = new ObjectId("eeeeeeeeeeeeeeeeeeeeeeee");
const NOW_ISO = new Date("2026-09-01T00:00:00Z").toISOString();

function seedBuyerChar(fake: FakeDb, cashOnHand: number): void {
  seedDoc(fake, "characters", { _id: BUYER_ID, name: "Buyer", cashOnHand });
}

function submitPlan(
  key: string,
  overrides: Partial<ShareOfferSubmitPlan> = {}
): ShareOfferSubmitPlan {
  return {
    version: 1,
    submitKey: key,
    listingIdHex: LISTING_ID.toHexString(),
    corpIdHex: LISTING_CORP_ID.toHexString(),
    buyerCharacterIdHex: BUYER_ID.toHexString(),
    buyerCorporationIdHex: null,
    shares: 10,
    pricePerShare: 100,
    escrowAmount: 1000,
    escrowDebit: {
      collection: "characters",
      idHex: BUYER_ID.toHexString(),
      field: "cashOnHand",
      amount: 1000,
    },
    payerType: "character",
    payerIdHex: BUYER_ID.toHexString(),
    payerName: "Buyer",
    payerCurrencyCode: "USD",
    insufficientError: "Insufficient funds for escrow",
    turn: 23,
    nowIso: NOW_ISO,
    offerIdHex: buildShareOfferSubmitOfferId(key).toHexString(),
    spread: null,
    response: { escrowAmount: 1000, spreadPaid: 0 },
    ...overrides,
  };
}

function acceptPlan(
  key: string,
  overrides: Partial<ShareOfferAcceptPlan> = {}
): ShareOfferAcceptPlan {
  return {
    version: 1,
    acceptKey: key,
    listingIdHex: LISTING_ID.toHexString(),
    offerIdHex: new ObjectId("ffffffffffffffffffffffff").toHexString(),
    corpIdHex: LISTING_CORP_ID.toHexString(),
    sharesToAccept: 10,
    sharesOffered: 10,
    pricePerShare: 100,
    turn: 23,
    nowIso: NOW_ISO,
    forexEnabled: false,
    buyerCredit: {
      field: "characterId",
      idHex: BUYER_ID.toHexString(),
      pricePerShare: 100,
    },
    buyerIsCorp: false,
    buyerIdHex: BUYER_ID.toHexString(),
    buyerName: "Buyer",
    buyerCurrencyCode: "USD",
    proceedsLeg: {
      collection: "characters",
      idHex: SELLER_ID.toHexString(),
      field: "cashOnHand",
      amount: 1000,
    },
    sellerType: "character",
    sellerIdHex: SELLER_ID.toHexString(),
    sellerName: "Seller",
    sellerCurrencyCode: "USD",
    refundLeg: null,
    proceeds: 1000,
    refund: 0,
    listingCorpName: "Target",
    ...overrides,
  };
}

function seedAcceptWorld(
  fake: FakeDb,
  opts: {
    sharesRemaining?: number;
    listingStatus?: string;
    offerStatus?: string;
    buyerCash?: number;
    sellerCash?: number;
    seedBuyer?: boolean;
    seedSeller?: boolean;
  } = {}
): void {
  seedDoc(fake, "shareListings", {
    _id: LISTING_ID,
    corporationId: LISTING_CORP_ID,
    sellerCharacterId: SELLER_ID,
    sharesRemaining: opts.sharesRemaining ?? 50,
    status: opts.listingStatus ?? "open",
  });
  seedDoc(fake, "shareOffers", {
    _id: new ObjectId("ffffffffffffffffffffffff"),
    listingId: LISTING_ID,
    corporationId: LISTING_CORP_ID,
    buyerCharacterId: BUYER_ID,
    shares: 10,
    pricePerShare: 100,
    escrowAmount: 1000,
    status: opts.offerStatus ?? "pending",
    createdAt: new Date(NOW_ISO),
  });
  seedDoc(fake, "corporations", { _id: LISTING_CORP_ID, name: "Target", shareholders: [] });
  if (opts.seedBuyer ?? true) {
    seedDoc(fake, "characters", {
      _id: BUYER_ID,
      name: "Buyer",
      cashOnHand: opts.buyerCash ?? 5000,
    });
  }
  if (opts.seedSeller ?? true) {
    seedDoc(fake, "characters", {
      _id: SELLER_ID,
      name: "Seller",
      cashOnHand: opts.sellerCash ?? 0,
    });
  }
}

async function convergeSubmit(
  fake: FakeDb,
  key: string
): Promise<{
  ok: true;
  body: { escrowAmount: number; spreadPaid: number };
  replayed: boolean;
} | null> {
  try {
    const rec = await recoverShareOfferSubmitByKey(asDb(fake), key);
    if (rec.ok) return rec;
    return executeShareOfferSubmitFlow(asDb(fake), submitPlan(key), { idempotencyKey: key });
  } catch (e) {
    if (e instanceof MoneyFlowTerminalError) {
      expect(readDoc(fake, "characters", BUYER_ID).cashOnHand).toBe(5000);
      expect(offersOf(fake)).toHaveLength(0);
      return null;
    }
    throw e;
  }
}

async function convergeAccept(
  fake: FakeDb,
  plan: ShareOfferAcceptPlan,
  key: string,
  expectBody: {
    sharesTransferred: number;
    proceeds: number;
    refundedToOffer: number;
    listingSharesRemaining: number;
  }
): Promise<void> {
  let rec;
  try {
    rec = await recoverShareOfferAcceptByKey(asDb(fake), key);
    if (!rec.ok) {
      rec = await executeShareOfferAcceptFlow(asDb(fake), plan, { idempotencyKey: key });
    }
  } catch (e) {
    if (e instanceof MoneyFlowTerminalError) {
      expect(readDoc(fake, "characters", SELLER_ID).cashOnHand).toBe(0);
      expect(readDoc(fake, "characters", BUYER_ID).cashOnHand).toBe(5000);
      expect(readDoc(fake, "shareListings", LISTING_ID).sharesRemaining).toBe(50);
      expect(readDoc(fake, "shareOffers", new ObjectId("ffffffffffffffffffffffff")).status).toBe(
        "pending"
      );
      return;
    }
    throw e;
  }
  expect(rec.ok).toBe(true);
  if (!rec.ok) throw new Error(`crash did not converge for ${key}`);
  expect(rec.body).toEqual(expectBody);
  expect(receiptOf(fake, key).status).toBe("completed");
}

function receiptOf(fake: FakeDb, key: string): Doc {
  const coll = getColl(fake, NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION);
  const doc = coll.get(key);
  if (!doc) throw new Error(`missing receipt ${key}`);
  return clone(doc);
}

function offersOf(fake: FakeDb): Doc[] {
  return [...getColl(fake, "shareOffers").values()].map(clone);
}

describe("share-offer submit flow", () => {
  it("debits escrow and inserts a deterministic pending offer", async () => {
    const fake = makeFakeDb();
    seedBuyerChar(fake, 5000);
    const plan = submitPlan("submit-ok");
    const result = await executeShareOfferSubmitFlow(asDb(fake), plan, {
      idempotencyKey: "submit-ok",
    });
    expect(result).toEqual({
      ok: true,
      body: { escrowAmount: 1000, spreadPaid: 0 },
      replayed: false,
    });
    expect(readDoc(fake, "characters", BUYER_ID).cashOnHand).toBe(4000);
    const offers = offersOf(fake);
    expect(offers).toHaveLength(1);
    expect(offers[0]).toMatchObject({
      _id: buildShareOfferSubmitOfferId("submit-ok"),
      listingId: LISTING_ID,
      shares: 10,
      pricePerShare: 100,
      escrowAmount: 1000,
      status: "pending",
    });
    expect(receiptOf(fake, "submit-ok").status).toBe("completed");
    expect(vi.mocked(emitTx)).toHaveBeenCalledTimes(1);
  });

  it("converges a crash after every write to exactly-once", async () => {
    const probe = makeFakeDb();
    seedBuyerChar(probe, 5000);
    await executeShareOfferSubmitFlow(asDb(probe), submitPlan("submit-crash"), {
      idempotencyKey: "submit-crash",
    });
    const totalWrites = probe.writes;
    expect(totalWrites).toBeGreaterThan(3);

    for (let n = 1; n <= totalWrites; n += 1) {
      const crashed = makeFakeDb();
      seedBuyerChar(crashed, 5000);
      const key = `submit-crash-${n}`;
      crashed.faultAt = n;
      let first: unknown;
      try {
        first = await executeShareOfferSubmitFlow(asDb(crashed), submitPlan(key), {
          idempotencyKey: key,
        });
      } catch (error) {
        first = error;
      } finally {
        crashed.faultAt = null;
      }
      // A fault inside a best-effort post-commit write is swallowed by
      // design (the receipt already settled), so the first attempt may
      // resolve; either way the same key must converge exactly once.
      if (first instanceof Error) {
        expect(first.message).toBe("injected-crash");
      }
      const recovered = await convergeSubmit(crashed, key);
      if (recovered) {
        expect(recovered.body).toEqual({ escrowAmount: 1000, spreadPaid: 0 });
        expect(readDoc(crashed, "characters", BUYER_ID).cashOnHand).toBe(4000);
        expect(offersOf(crashed)).toHaveLength(1);
      }
    }
  });

  it("replays a completed key without moving money again", async () => {
    const fake = makeFakeDb();
    seedBuyerChar(fake, 5000);
    const first = await executeShareOfferSubmitFlow(asDb(fake), submitPlan("submit-replay"), {
      idempotencyKey: "submit-replay",
    });
    expect(first.replayed).toBe(false);
    const retry = await executeShareOfferSubmitFlow(asDb(fake), submitPlan("submit-replay"), {
      idempotencyKey: "submit-replay",
    });
    expect(retry).toEqual({
      ok: true,
      body: { escrowAmount: 1000, spreadPaid: 0 },
      replayed: true,
    });
    expect(readDoc(fake, "characters", BUYER_ID).cashOnHand).toBe(4000);
    expect(offersOf(fake)).toHaveLength(1);
  });

  it("fails closed on key reuse with a different fingerprint", async () => {
    const fake = makeFakeDb();
    seedBuyerChar(fake, 5000);
    await executeShareOfferSubmitFlow(asDb(fake), submitPlan("submit-conflict"), {
      idempotencyKey: "submit-conflict",
    });
    await expect(
      executeShareOfferSubmitFlow(asDb(fake), submitPlan("submit-conflict", { shares: 11 }), {
        idempotencyKey: "submit-conflict",
      })
    ).rejects.toBeInstanceOf(MoneyFlowKeyConflictError);
    expect(readDoc(fake, "characters", BUYER_ID).cashOnHand).toBe(4000);
  });

  it("settles insufficient funds terminal and serves a new key fresh", async () => {
    const fake = makeFakeDb();
    seedBuyerChar(fake, 100);
    const short = await executeShareOfferSubmitFlow(asDb(fake), submitPlan("submit-broke"), {
      idempotencyKey: "submit-broke",
    });
    expect(short).toEqual({ ok: false, error: "Insufficient funds for escrow" });
    expect(readDoc(fake, "characters", BUYER_ID).cashOnHand).toBe(100);
    expect(offersOf(fake)).toHaveLength(0);
    await expect(recoverShareOfferSubmitByKey(asDb(fake), "submit-broke")).rejects.toBeInstanceOf(
      MoneyFlowTerminalError
    );
    // A new key starts fresh (the terminal receipt poisons only its own
    // key), so fund the buyer and prove the same amounts settle cleanly.
    seedBuyerChar(fake, 5000);
    const retry = await executeShareOfferSubmitFlow(asDb(fake), submitPlan("submit-fresh"), {
      idempotencyKey: "submit-fresh",
    });
    expect(retry.ok).toBe(true);
  });

  it("loses the pending-unique race with a compensated debit and the legacy 400", async () => {
    const fake = makeFakeDb();
    seedBuyerChar(fake, 5000);
    seedDoc(fake, "shareOffers", {
      _id: new ObjectId(),
      listingId: LISTING_ID,
      corporationId: LISTING_CORP_ID,
      buyerCharacterId: BUYER_ID,
      shares: 5,
      pricePerShare: 100,
      escrowAmount: 500,
      status: "pending",
      createdAt: new Date(NOW_ISO),
    });
    const result = await executeShareOfferSubmitFlow(asDb(fake), submitPlan("submit-race"), {
      idempotencyKey: "submit-race",
    });
    expect(result).toEqual({
      ok: false,
      error: "You already have a pending offer on this listing",
    });
    expect(readDoc(fake, "characters", BUYER_ID).cashOnHand).toBe(5000);
    expect(offersOf(fake)).toHaveLength(1);
    expect(receiptOf(fake, "submit-race").status).toBe("compensated");
  });

  it("routes a corp cross-currency spread exactly once", async () => {
    const fake = makeFakeDb();
    seedDoc(fake, "corporations", { _id: BUYER_CORP_ID, name: "Placer", liquidCapital: 20000 });
    const key = "submit-spread";
    const plan = submitPlan(key, {
      buyerCorporationIdHex: BUYER_CORP_ID.toHexString(),
      escrowDebit: {
        collection: "corporations",
        idHex: BUYER_CORP_ID.toHexString(),
        field: "liquidCapital",
        amount: 1500,
      },
      payerType: "corporation",
      payerIdHex: BUYER_CORP_ID.toHexString(),
      payerName: "Placer",
      payerCurrencyCode: "GBP",
      insufficientError: "Insufficient corporation funds for escrow",
      spread: { fee: 25, from: "GBP", to: "USD" },
      response: { escrowAmount: 1000, spreadPaid: 25 },
    });
    const result = await executeShareOfferSubmitFlow(asDb(fake), plan, { idempotencyKey: key });
    expect(result).toEqual({
      ok: true,
      body: { escrowAmount: 1000, spreadPaid: 25 },
      replayed: false,
    });
    expect(readDoc(fake, "corporations", BUYER_CORP_ID).liquidCapital).toBe(18500);
    const { toReserveBalance, toForexRevenue } = splitSpreadFee(25);
    const sourceBank = readDoc(
      fake,
      "centralBanks",
      getBankId(getCountryForCurrency("GBP")!) as unknown as ObjectId
    );
    expect(sourceBank.forexRevenue).toBe(toForexRevenue);
    const reserveBank = readDoc(
      fake,
      "centralBanks",
      getBankId(getCountryForCurrency("USD")!) as unknown as ObjectId
    );
    expect((reserveBank.spreadFeeReserveBalances as Doc).GBP).toBe(toReserveBalance);
    const retry = await executeShareOfferSubmitFlow(asDb(fake), plan, { idempotencyKey: key });
    expect(retry.replayed).toBe(true);
    expect(readDoc(fake, "corporations", BUYER_CORP_ID).liquidCapital).toBe(18500);
    expect(
      readDoc(fake, "centralBanks", getBankId(getCountryForCurrency("GBP")!) as unknown as ObjectId)
        .forexRevenue
    ).toBe(toForexRevenue);
  });

  it("recovers orphans by key and settles plan-less receipts failed", async () => {
    const fake = makeFakeDb();
    seedBuyerChar(fake, 5000);
    const crashed = makeFakeDb();
    seedBuyerChar(crashed, 5000);
    crashed.faultAt = 3;
    await expect(
      executeShareOfferSubmitFlow(asDb(crashed), submitPlan("submit-orphan"), {
        idempotencyKey: "submit-orphan",
      })
    ).rejects.toThrow("injected-crash");
    // Move the stranded receipt into the scan fake with the same docs.
    for (const [name, coll] of crashed.docs.entries()) {
      for (const [id, doc] of coll.entries()) {
        getColl(fake, name).set(id, clone(doc));
      }
    }
    const scanned = await recoverShareOfferSubmitOrphans(asDb(fake), 50);
    expect(scanned).toEqual([{ submitKey: "submit-orphan", action: "submit-recovered" }]);
    expect(readDoc(fake, "characters", BUYER_ID).cashOnHand).toBe(4000);

    seedDoc(fake, NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION, {
      _id: "submit-planless",
      status: "in_progress",
      fingerprint: "share-offer-submit:dead:beef",
      createdAt: new Date(NOW_ISO),
      updatedAt: new Date(NOW_ISO),
    });
    seedDoc(fake, NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION, {
      _id: "foreign-planless",
      status: "in_progress",
      fingerprint: "share-fill-money:dead:beef",
      createdAt: new Date(NOW_ISO),
      updatedAt: new Date(NOW_ISO),
    });
    const second = await recoverShareOfferSubmitOrphans(asDb(fake), 50);
    expect(second).toEqual([{ submitKey: "submit-planless", action: "settled-failed-no-plan" }]);
  });
});

describe("share-offer accept flow", () => {
  it("settles a full accept with shares, proceeds, and a filled listing", async () => {
    const fake = makeFakeDb();
    seedAcceptWorld(fake);
    const result = await executeShareOfferAcceptFlow(asDb(fake), acceptPlan("accept-full"), {
      idempotencyKey: "accept-full",
    });
    expect(result).toEqual({
      ok: true,
      body: {
        sharesTransferred: 10,
        proceeds: 1000,
        refundedToOffer: 0,
        listingSharesRemaining: 40,
      },
      replayed: false,
    });
    expect(readDoc(fake, "shareOffers", new ObjectId("ffffffffffffffffffffffff")).status).toBe(
      "accepted"
    );
    const listing = readDoc(fake, "shareListings", LISTING_ID);
    expect(listing.sharesRemaining).toBe(40);
    expect(listing.status).toBe("open");
    expect(readDoc(fake, "characters", SELLER_ID).cashOnHand).toBe(1000);
    expect(readDoc(fake, "characters", BUYER_ID).cashOnHand).toBe(5000);
    const corp = readDoc(fake, "corporations", LISTING_CORP_ID);
    expect(corp.shareholders).toHaveLength(1);
    expect(receiptOf(fake, "accept-full").status).toBe("completed");
  });

  it("refunds the partial remainder with proceeds plus refund equal to escrow", async () => {
    const fake = makeFakeDb();
    seedAcceptWorld(fake);
    const plan = acceptPlan("accept-partial", {
      sharesToAccept: 6,
      proceedsLeg: {
        collection: "characters",
        idHex: SELLER_ID.toHexString(),
        field: "cashOnHand",
        amount: 600,
      },
      refundLeg: {
        collection: "characters",
        idHex: BUYER_ID.toHexString(),
        field: "cashOnHand",
        amount: 400,
      },
      proceeds: 600,
      refund: 400,
    });
    const result = await executeShareOfferAcceptFlow(asDb(fake), plan, {
      idempotencyKey: "accept-partial",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.body).toEqual({
      sharesTransferred: 6,
      proceeds: 600,
      refundedToOffer: 400,
      listingSharesRemaining: 44,
    });
    expect(result.body.proceeds + result.body.refundedToOffer).toBe(1000);
    expect(readDoc(fake, "characters", SELLER_ID).cashOnHand).toBe(600);
    expect(readDoc(fake, "characters", BUYER_ID).cashOnHand).toBe(5400);
  });

  it("credits a corp buyer in shares and liquid capital", async () => {
    const fake = makeFakeDb();
    seedAcceptWorld(fake);
    seedDoc(fake, "corporations", { _id: BUYER_CORP_ID, name: "BuyerCorp", liquidCapital: 5000 });
    const coll = getColl(fake, "shareOffers");
    const offer = coll.get("ffffffffffffffffffffffff");
    if (!offer) throw new Error("missing offer");
    offer.buyerCorporationId = BUYER_CORP_ID;
    const plan = acceptPlan("accept-corp", {
      sharesToAccept: 4,
      buyerCredit: {
        field: "corporationId",
        idHex: BUYER_CORP_ID.toHexString(),
        pricePerShare: 100,
      },
      buyerIsCorp: true,
      buyerIdHex: BUYER_CORP_ID.toHexString(),
      buyerName: "BuyerCorp",
      proceedsLeg: {
        collection: "characters",
        idHex: SELLER_ID.toHexString(),
        field: "cashOnHand",
        amount: 400,
      },
      refundLeg: {
        collection: "corporations",
        idHex: BUYER_CORP_ID.toHexString(),
        field: "liquidCapital",
        amount: 600,
      },
      proceeds: 400,
      refund: 600,
    });
    const result = await executeShareOfferAcceptFlow(asDb(fake), plan, {
      idempotencyKey: "accept-corp",
    });
    expect(result.ok).toBe(true);
    expect(readDoc(fake, "corporations", BUYER_CORP_ID).liquidCapital).toBe(5600);
    const corp = readDoc(fake, "corporations", LISTING_CORP_ID);
    expect(corp.shareholders).toHaveLength(1);
    expect((corp.shareholders as Doc[])[0]).toMatchObject({ shares: 4 });
  });

  it("converges a crash after every write to exactly-once", async () => {
    const probe = makeFakeDb();
    seedAcceptWorld(probe);
    const plan = acceptPlan("accept-crash", {
      sharesToAccept: 6,
      proceedsLeg: {
        collection: "characters",
        idHex: SELLER_ID.toHexString(),
        field: "cashOnHand",
        amount: 600,
      },
      refundLeg: {
        collection: "characters",
        idHex: BUYER_ID.toHexString(),
        field: "cashOnHand",
        amount: 400,
      },
      proceeds: 600,
      refund: 400,
    });
    await executeShareOfferAcceptFlow(asDb(probe), plan, { idempotencyKey: "accept-crash" });
    const totalWrites = probe.writes;
    expect(totalWrites).toBeGreaterThan(5);

    for (let n = 1; n <= totalWrites; n += 1) {
      const fake = makeFakeDb();
      seedAcceptWorld(fake);
      const key = `accept-crash-${n}`;
      const iterPlan = acceptPlan(key, {
        sharesToAccept: 6,
        proceedsLeg: {
          collection: "characters",
          idHex: SELLER_ID.toHexString(),
          field: "cashOnHand",
          amount: 600,
        },
        refundLeg: {
          collection: "characters",
          idHex: BUYER_ID.toHexString(),
          field: "cashOnHand",
          amount: 400,
        },
        proceeds: 600,
        refund: 400,
      });
      fake.faultAt = n;
      let first: unknown;
      try {
        first = await executeShareOfferAcceptFlow(asDb(fake), iterPlan, { idempotencyKey: key });
      } catch (error) {
        first = error;
      } finally {
        fake.faultAt = null;
      }
      // A fault inside a best-effort post-commit write is swallowed by
      // design (the receipt already settled), so the first attempt may
      // resolve; either way the same key must converge exactly once.
      if (first instanceof Error) {
        expect(first.message).toBe("injected-crash");
      }
      await convergeAccept(fake, iterPlan, key, {
        sharesTransferred: 6,
        proceeds: 600,
        refundedToOffer: 400,
        listingSharesRemaining: 44,
      });
      if (receiptOf(fake, key).status === "completed") {
        expect(readDoc(fake, "characters", SELLER_ID).cashOnHand).toBe(600);
        expect(readDoc(fake, "characters", BUYER_ID).cashOnHand).toBe(5400);
        expect(readDoc(fake, "shareListings", LISTING_ID).sharesRemaining).toBe(44);
        expect(readDoc(fake, "shareOffers", new ObjectId("ffffffffffffffffffffffff")).status).toBe(
          "accepted"
        );
      }
    }
  });

  it("reports a lost offer race as 409 without moving money", async () => {
    const fake = makeFakeDb();
    seedAcceptWorld(fake, { offerStatus: "accepted" });
    const result = await executeShareOfferAcceptFlow(asDb(fake), acceptPlan("accept-lost"), {
      idempotencyKey: "accept-lost",
    });
    expect(result).toEqual({
      ok: false,
      error: "Offer changed before this acceptance could be applied",
      status: 409,
    });
    expect(readDoc(fake, "shareListings", LISTING_ID).sharesRemaining).toBe(50);
    expect(readDoc(fake, "characters", SELLER_ID).cashOnHand).toBe(0);
  });

  it("compensates a short listing with the offer back to pending", async () => {
    const fake = makeFakeDb();
    seedAcceptWorld(fake, { sharesRemaining: 5 });
    const result = await executeShareOfferAcceptFlow(asDb(fake), acceptPlan("accept-short"), {
      idempotencyKey: "accept-short",
    });
    expect(result).toEqual({
      ok: false,
      error: "Not enough shares remaining (concurrent acceptance detected)",
      status: 400,
    });
    expect(readDoc(fake, "shareOffers", new ObjectId("ffffffffffffffffffffffff")).status).toBe(
      "pending"
    );
    expect(readDoc(fake, "shareListings", LISTING_ID).sharesRemaining).toBe(5);
    expect(readDoc(fake, "characters", SELLER_ID).cashOnHand).toBe(0);
    expect(readDoc(fake, "characters", BUYER_ID).cashOnHand).toBe(5000);
  });

  it("disambiguates a cancelled or missing listing", async () => {
    const cancelled = makeFakeDb();
    seedAcceptWorld(cancelled, { listingStatus: "cancelled" });
    const closedResult = await executeShareOfferAcceptFlow(
      asDb(cancelled),
      acceptPlan("accept-closed"),
      { idempotencyKey: "accept-closed" }
    );
    expect(closedResult).toEqual({
      ok: false,
      error: "Listing is no longer open",
      status: 400,
    });

    const gone = makeFakeDb();
    seedAcceptWorld(gone);
    getColl(gone, "shareListings").clear();
    const goneResult = await executeShareOfferAcceptFlow(asDb(gone), acceptPlan("accept-gone"), {
      idempotencyKey: "accept-gone",
    });
    expect(goneResult).toEqual({ ok: false, error: "Listing not found", status: 404 });
  });

  it("reverses the prefix when the refund cannot land on a gone buyer", async () => {
    const fake = makeFakeDb();
    seedAcceptWorld(fake, { seedBuyer: false });
    const plan = acceptPlan("accept-nobuyer", {
      sharesToAccept: 6,
      proceedsLeg: {
        collection: "characters",
        idHex: SELLER_ID.toHexString(),
        field: "cashOnHand",
        amount: 600,
      },
      refundLeg: {
        collection: "characters",
        idHex: BUYER_ID.toHexString(),
        field: "cashOnHand",
        amount: 400,
      },
      proceeds: 600,
      refund: 400,
    });
    await expect(
      executeShareOfferAcceptFlow(asDb(fake), plan, {
        idempotencyKey: "accept-nobuyer",
      })
    ).rejects.toThrow("Buyer character not found");
    expect(readDoc(fake, "shareOffers", new ObjectId("ffffffffffffffffffffffff")).status).toBe(
      "pending"
    );
    expect(readDoc(fake, "shareListings", LISTING_ID).sharesRemaining).toBe(50);
    expect(readDoc(fake, "characters", SELLER_ID).cashOnHand).toBe(0);
  });

  it("recovers accept orphans by key and settles plan-less receipts failed", async () => {
    const fake = makeFakeDb();
    seedAcceptWorld(fake);
    fake.faultAt = 4;
    const plan = acceptPlan("accept-orphan");
    await expect(
      executeShareOfferAcceptFlow(asDb(fake), plan, { idempotencyKey: "accept-orphan" })
    ).rejects.toThrow("injected-crash");
    fake.faultAt = null;
    const scanned = await recoverShareOfferAcceptOrphans(asDb(fake), 50);
    expect(scanned).toEqual([{ acceptKey: "accept-orphan", action: "accept-recovered" }]);
    expect(readDoc(fake, "characters", SELLER_ID).cashOnHand).toBe(1000);

    seedDoc(fake, NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION, {
      _id: "accept-planless",
      status: "in_progress",
      fingerprint: "share-offer-accept:dead:beef",
      createdAt: new Date(NOW_ISO),
      updatedAt: new Date(NOW_ISO),
    });
    const second = await recoverShareOfferAcceptOrphans(asDb(fake), 50);
    expect(second).toEqual([{ acceptKey: "accept-planless", action: "settled-failed-no-plan" }]);
  });
});
