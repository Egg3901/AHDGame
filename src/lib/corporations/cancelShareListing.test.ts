import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import {
  MoneyFlowTerminalError,
  NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION,
} from "@/lib/db/nonAtomicMoneyFlow";
import {
  SHARE_LISTING_CANCEL_FINGERPRINT_DOMAIN,
  cancelShareListingAndRefund,
  executeShareListingCancelFlow,
  getStoredShareListingCancelResponse,
  recoverShareListingCancelByKey,
  recoverShareListingCancelOrphans,
  recoverShareListingCancelReceipt,
  type ShareListingCancelPlan,
} from "./cancelShareListing";
import { emitTx } from "@/lib/financialTxLog/emit";

vi.mock("@/lib/financialTxLog/emit", () => ({
  emitTx: vi.fn(),
}));
vi.mock("@/lib/turn/currentTurn", () => ({
  getCurrentTurn: vi.fn().mockResolvedValue(23),
}));

// ---------------------------------------------------------------------------
// Stateful in-memory fake honoring exactly the operators the listing-cancel
// flow emits: receipt insert/find/update with dotted `$set` paths and
// duplicate-key (11000) inserts, CAS listing/offer claim `$set` updates with
// `$ne: key` guards (skips converge instead of failing), keyed `$inc`
// escrow-refund credits with `$gte` debit guards, keyed positional
// cap-table updates (`shareholders.$`) with `$elemMatch` sufficiency or
// dotted-array equality guards, inc/push/inc restore triples under one
// subkey, `$push` key records in `$each`+`$slice` form, `$exists` finds for
// the orphan scan, `countDocuments` for the flipped-offer count, and a fault
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
          applyObjectUpdate(doc, update, filter);
          return { matchedCount: 1, modifiedCount: 1 };
        }
      }
      return { matchedCount: 0, modifiedCount: 0 };
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

async function flushPostCommit(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
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
const OFFER_ID = new ObjectId("ffffffffffffffffffffffff");
const NOW_ISO = new Date("2026-09-01T00:00:00Z").toISOString();

function seedListingWorld(
  fake: FakeDb,
  opts: {
    buyerCash?: number;
    sellerShares?: number;
    offerStatus?: string;
    extraOffers?: Doc[];
    buyerCountryId?: string;
  } = {}
): void {
  seedDoc(fake, "corporations", {
    _id: LISTING_CORP_ID,
    name: "ListCo",
    shareholders: [
      { characterId: SELLER_ID, shares: opts.sellerShares ?? 200, avgCostPerShare: 12 },
    ],
  });
  seedDoc(fake, "shareListings", {
    _id: LISTING_ID,
    corporationId: LISTING_CORP_ID,
    sellerCharacterId: SELLER_ID,
    sharesListed: 50,
    sharesRemaining: 50,
    marketPriceAtCreation: 1000,
    status: "open",
    createdAt: new Date(NOW_ISO),
    expiresAt: new Date(Date.now() + 60_000),
  });
  seedDoc(fake, "shareOffers", {
    _id: OFFER_ID,
    listingId: LISTING_ID,
    corporationId: LISTING_CORP_ID,
    buyerCharacterId: BUYER_ID,
    shares: 50,
    pricePerShare: 1000,
    escrowAmount: 50_000,
    status: opts.offerStatus ?? "pending",
    createdAt: new Date(NOW_ISO),
  });
  for (const extra of opts.extraOffers ?? []) {
    seedDoc(fake, "shareOffers", extra);
  }
  seedDoc(fake, "characters", {
    _id: BUYER_ID,
    name: "Buyer",
    cashOnHand: opts.buyerCash ?? 1000,
    ...(opts.buyerCountryId ? { countryId: opts.buyerCountryId } : {}),
  });
}

function listingDoc(fake: FakeDb): Doc {
  return getColl(fake, "shareListings").get(LISTING_ID.toHexString())!;
}

function offerDoc(fake: FakeDb, id: ObjectId): Doc {
  return getColl(fake, "shareOffers").get(id.toHexString())!;
}

function sellerShares(fake: FakeDb): number | undefined {
  const corp = getColl(fake, "corporations").get(LISTING_CORP_ID.toHexString())!;
  const rows = (corp.shareholders as Doc[] | undefined) ?? [];
  return rows.find((row) => valueEquals(row.characterId, SELLER_ID))?.shares as number | undefined;
}

function receipt(fake: FakeDb, key: string): Doc | undefined {
  return getColl(fake, NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION).get(key);
}

function listingInput(fake: FakeDb): { listing: unknown; now: Date } {
  return { listing: clone(listingDoc(fake)), now: new Date(NOW_ISO) };
}

interface CancelPlanOverrides {
  offerIds?: ObjectId[];
  refundTargets?: Array<{ offerId: ObjectId; buyerId: ObjectId; amount: number }>;
  restoreShares?: number;
  response?: { refundedOffers: number; sharesReturned: number };
}

function buildCancelPlan(
  cancelKey: string,
  overrides: CancelPlanOverrides = {}
): ShareListingCancelPlan {
  const offerIds = overrides.offerIds ?? [OFFER_ID];
  const targets =
    overrides.refundTargets ??
    offerIds.map((offerId) => ({ offerId, buyerId: BUYER_ID, amount: 50_000 }));
  return {
    version: 1,
    cancelKey,
    listingIdHex: LISTING_ID.toHexString(),
    corpIdHex: LISTING_CORP_ID.toHexString(),
    turn: 23,
    nowIso: NOW_ISO,
    forexEnabled: false,
    sharesRemaining: overrides.restoreShares ?? 50,
    restoreLeg:
      (overrides.restoreShares ?? 50) > 0
        ? { field: "characterId", idHex: SELLER_ID.toHexString(), pricePerShare: 12 }
        : null,
    returnPrice: 12,
    refunds: targets.map((target) => ({
      offerIdHex: target.offerId.toHexString(),
      subjectType: "character",
      subjectIdHex: target.buyerId.toHexString(),
      subjectName: "Buyer",
      currencyCode: "USD",
      refundLeg: {
        collection: "characters",
        idHex: target.buyerId.toHexString(),
        field: "cashOnHand",
        amount: target.amount,
      },
      shares: 50,
      pricePerShare: 1000,
      missingError: "Buyer character not found",
      txMeta: { shares: 50, pricePerShare: 1000 },
    })),
  };
}

function expectCancelState(fake: FakeDb, key: string): void {
  expect(listingDoc(fake).status).toBe("cancelled");
  expect(offerDoc(fake, OFFER_ID).status).toBe("cancelled");
  expect(getColl(fake, "characters").get(BUYER_ID.toHexString())?.cashOnHand).toBe(51_000);
  expect(sellerShares(fake)).toBe(250);
  expect(receipt(fake, key)?.status).toBe("completed");
}

describe("cancelShareListing keyed cancel", () => {
  it("cancels the listing, refunds escrow, and restores seller shares once", async () => {
    const fake = makeFakeDb();
    seedListingWorld(fake);
    const { listing, now } = listingInput(fake);
    const result = await cancelShareListingAndRefund(asDb(fake), listing as never, now, false);
    await flushPostCommit();
    expect(result).toEqual({ ok: true, refundedOffers: 1, sharesReturned: 50 });
    const keys = [...getColl(fake, NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION).keys()];
    expect(keys).toHaveLength(1);
    expectCancelState(fake, keys[0]!);
    expect(vi.mocked(emitTx)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(emitTx).mock.calls[0]![1]).toMatchObject({
      type: "share_listing_refund",
      amount: 50_000,
    });
  });

  it("replays a duplicate Idempotency-Key without double-refunding", async () => {
    const fake = makeFakeDb();
    seedListingWorld(fake);
    const firstInput = listingInput(fake);
    const first = await cancelShareListingAndRefund(
      asDb(fake),
      firstInput.listing as never,
      firstInput.now,
      false,
      null,
      {
        idempotencyKey: "cancel-replay",
      }
    );
    await flushPostCommit();
    expect(first).toEqual({ ok: true, refundedOffers: 1, sharesReturned: 50 });
    expect(vi.mocked(emitTx)).toHaveBeenCalledTimes(1);

    // The listing now reads cancelled, so re-entering through the helper
    // reports "Listing is not open". The route replays before guards: with
    // a receipt on file it reconciles through the key instead.
    const secondInput = listingInput(fake);
    const naive = await cancelShareListingAndRefund(
      asDb(fake),
      secondInput.listing as never,
      secondInput.now,
      false,
      null,
      { idempotencyKey: "cancel-replay" }
    );
    expect(naive).toEqual({ ok: false, error: "Listing is not open" });
    expect(await getStoredShareListingCancelResponse(asDb(fake), "cancel-replay")).toEqual({
      settled: true,
    });
    const second = await recoverShareListingCancelByKey(asDb(fake), "cancel-replay");
    await flushPostCommit();
    expect(second).toEqual({
      ok: true,
      body: { refundedOffers: 1, sharesReturned: 50 },
      replayed: true,
    });
    expect(getColl(fake, "characters").get(BUYER_ID.toHexString())?.cashOnHand).toBe(51_000);
    expect(sellerShares(fake)).toBe(250);
    expect(vi.mocked(emitTx)).toHaveBeenCalledTimes(1);
  });

  it("reports Listing is not open for a distinct key after settle", async () => {
    const fake = makeFakeDb();
    seedListingWorld(fake);
    const firstInput = listingInput(fake);
    await cancelShareListingAndRefund(
      asDb(fake),
      firstInput.listing as never,
      firstInput.now,
      false
    );
    const secondInput = listingInput(fake);
    const second = await cancelShareListingAndRefund(
      asDb(fake),
      secondInput.listing as never,
      secondInput.now,
      false,
      null,
      { idempotencyKey: "cancel-other-key" }
    );
    expect(second).toEqual({ ok: false, error: "Listing is not open" });
    expect(getColl(fake, "characters").get(BUYER_ID.toHexString())?.cashOnHand).toBe(51_000);
  });

  it("refunds a corporation buyer to liquidCapital", async () => {
    const fake = makeFakeDb();
    seedListingWorld(fake);
    seedDoc(fake, "corporations", { _id: BUYER_CORP_ID, name: "BuyerCo", liquidCapital: 2000 });
    const corpOfferId = new ObjectId("101010101010101010101010");
    seedDoc(fake, "shareOffers", {
      _id: corpOfferId,
      listingId: LISTING_ID,
      corporationId: LISTING_CORP_ID,
      buyerCharacterId: BUYER_ID,
      buyerCorporationId: BUYER_CORP_ID,
      shares: 10,
      pricePerShare: 1000,
      escrowAmount: 10_000,
      status: "pending",
      createdAt: new Date(NOW_ISO),
    });
    const { listing, now } = listingInput(fake);
    const listingCorp = getColl(fake, "corporations").get(LISTING_CORP_ID.toHexString());
    const result = await cancelShareListingAndRefund(
      asDb(fake),
      listing as never,
      now,
      false,
      listingCorp as never
    );
    await flushPostCommit();
    expect(result).toEqual({ ok: true, refundedOffers: 2, sharesReturned: 50 });
    expect(getColl(fake, "corporations").get(BUYER_CORP_ID.toHexString())?.liquidCapital).toBe(
      12_000
    );
    expect(getColl(fake, "characters").get(BUYER_ID.toHexString())?.cashOnHand).toBe(51_000);
    expect(vi.mocked(emitTx)).toHaveBeenCalledTimes(2);
  });

  it("keeps the listing open when forex data is unavailable", async () => {
    const fake = makeFakeDb();
    seedListingWorld(fake, { buyerCountryId: "UK" });
    const { listing, now } = listingInput(fake);
    const result = await cancelShareListingAndRefund(asDb(fake), listing as never, now, true);
    expect(result).toEqual({
      ok: false,
      rateUnavailable: true,
      error: "Exchange rate unavailable, try again shortly",
    });
    expect(listingDoc(fake).status).toBe("open");
    expect(offerDoc(fake, OFFER_ID).status).toBe("pending");
    expect(getColl(fake, NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION).size).toBe(0);
    expect(vi.mocked(emitTx)).not.toHaveBeenCalled();
  });

  it("reports a missing buyer with nothing written", async () => {
    const fake = makeFakeDb();
    seedListingWorld(fake);
    getColl(fake, "characters").delete(BUYER_ID.toHexString());
    const { listing, now } = listingInput(fake);
    const result = await cancelShareListingAndRefund(asDb(fake), listing as never, now, false);
    expect(result).toEqual({ ok: false, error: "Buyer character not found" });
    expect(listingDoc(fake).status).toBe("open");
    expect(getColl(fake, NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION).size).toBe(0);
  });

  it("skips a foreign-resolved offer without crediting or reopening it", async () => {
    const fake = makeFakeDb();
    const filledId = new ObjectId("202020202020202020202020");
    const filledBuyerId = new ObjectId("303030303030303030303030");
    seedListingWorld(fake, {
      extraOffers: [
        {
          _id: filledId,
          listingId: LISTING_ID,
          corporationId: LISTING_CORP_ID,
          buyerCharacterId: filledBuyerId,
          shares: 10,
          pricePerShare: 1000,
          escrowAmount: 10_000,
          status: "filled",
          createdAt: new Date(NOW_ISO),
        },
      ],
    });
    seedDoc(fake, "characters", { _id: filledBuyerId, name: "FilledBuyer", cashOnHand: 700 });
    // The filled offer was pending at plan pin time and resolved elsewhere
    // before the claim: both its steps converge as skips.
    const plan = buildCancelPlan("cancel-skip", {
      offerIds: [OFFER_ID, filledId],
      refundTargets: [
        { offerId: OFFER_ID, buyerId: BUYER_ID, amount: 50_000 },
        { offerId: filledId, buyerId: filledBuyerId, amount: 10_000 },
      ],
    });
    const result = await executeShareListingCancelFlow(asDb(fake), plan, {
      idempotencyKey: "cancel-skip",
    });
    await flushPostCommit();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.body).toEqual({ refundedOffers: 1, sharesReturned: 50 });
    expect(offerDoc(fake, OFFER_ID).status).toBe("cancelled");
    const filled = offerDoc(fake, filledId);
    expect(filled.status).toBe("filled");
    expect(filled.lastShareListingCancelKey).toBeUndefined();
    expect(getColl(fake, "characters").get(filledBuyerId.toHexString())?.cashOnHand).toBe(700);
    expect(getColl(fake, "characters").get(BUYER_ID.toHexString())?.cashOnHand).toBe(51_000);
    expect(sellerShares(fake)).toBe(250);
    expect(receipt(fake, "cancel-skip")?.status).toBe("completed");
  });

  it("compensates without reopening a foreign-resolved offer", async () => {
    const fake = makeFakeDb();
    const filledId = new ObjectId("202020202020202020202020");
    const filledBuyerId = new ObjectId("303030303030303030303030");
    seedListingWorld(fake, {
      extraOffers: [
        {
          _id: filledId,
          listingId: LISTING_ID,
          corporationId: LISTING_CORP_ID,
          buyerCharacterId: filledBuyerId,
          shares: 10,
          pricePerShare: 1000,
          escrowAmount: 10_000,
          status: "filled",
          createdAt: new Date(NOW_ISO),
        },
      ],
    });
    seedDoc(fake, "characters", { _id: filledBuyerId, name: "FilledBuyer", cashOnHand: 700 });
    // The pending offer's buyer vanishes at step time (the hand-built plan
    // skips the route pre-validation), so the refund fails after the claims
    // applied and the flow compensates.
    getColl(fake, "characters").delete(BUYER_ID.toHexString());
    const plan = buildCancelPlan("cancel-compensate", {
      offerIds: [OFFER_ID, filledId],
      refundTargets: [
        { offerId: OFFER_ID, buyerId: BUYER_ID, amount: 50_000 },
        { offerId: filledId, buyerId: filledBuyerId, amount: 10_000 },
      ],
    });
    const result = await executeShareListingCancelFlow(asDb(fake), plan, {
      idempotencyKey: "cancel-compensate",
    });
    await flushPostCommit();
    expect(result).toEqual({ ok: false, error: "Buyer character not found" });
    // The listing claim and our own offer claim revert...
    expect(listingDoc(fake).status).toBe("open");
    expect(offerDoc(fake, OFFER_ID).status).toBe("pending");
    // ...but the foreign-resolved offer is never credited, reopened, or
    // debited by the compensation.
    const filled = offerDoc(fake, filledId);
    expect(filled.status).toBe("filled");
    expect(filled.lastShareListingCancelKey).toBeUndefined();
    expect(getColl(fake, "characters").get(filledBuyerId.toHexString())?.cashOnHand).toBe(700);
    expect(sellerShares(fake)).toBe(200);
    expect(receipt(fake, "cancel-compensate")?.status).toBe("compensated");
    expect(vi.mocked(emitTx)).not.toHaveBeenCalled();
  });

  it("counts only the offers this cancel actually flipped", async () => {
    const fake = makeFakeDb();
    const filledId = new ObjectId("202020202020202020202020");
    seedListingWorld(fake, {
      extraOffers: [
        {
          _id: filledId,
          listingId: LISTING_ID,
          corporationId: LISTING_CORP_ID,
          buyerCharacterId: BUYER_ID,
          shares: 10,
          pricePerShare: 1000,
          escrowAmount: 10_000,
          status: "filled",
          createdAt: new Date(NOW_ISO),
        },
      ],
    });
    const { listing, now } = listingInput(fake);
    const result = await cancelShareListingAndRefund(asDb(fake), listing as never, now, false);
    await flushPostCommit();
    expect(result).toEqual({ ok: true, refundedOffers: 1, sharesReturned: 50 });
    expect(offerDoc(fake, filledId).status).toBe("filled");
    expect(offerDoc(fake, filledId).lastShareListingCancelKey).toBeUndefined();
  });

  it("keeps the cancel completed when refund tx rows fail", async () => {
    const fake = makeFakeDb();
    seedListingWorld(fake);
    vi.mocked(emitTx).mockRejectedValue(new Error("tx-down"));
    const { listing, now } = listingInput(fake);
    const result = await cancelShareListingAndRefund(asDb(fake), listing as never, now, false);
    await flushPostCommit();
    expect(result).toEqual({ ok: true, refundedOffers: 1, sharesReturned: 50 });
    const keys = [...getColl(fake, NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION).keys()];
    expectCancelState(fake, keys[0]!);
  });

  it("converges across a crash at every durable boundary", async () => {
    const probe = makeFakeDb();
    seedListingWorld(probe);
    const probePlan = buildCancelPlan("cancel-probe");
    const probeResult = await executeShareListingCancelFlow(asDb(probe), probePlan, {
      idempotencyKey: "cancel-probe",
    });
    await flushPostCommit();
    expect(probeResult.ok).toBe(true);
    expectCancelState(probe, "cancel-probe");
    const totalWrites = probe.writes;
    expect(totalWrites).toBeGreaterThan(3);
    for (let faultAt = 1; faultAt <= totalWrites; faultAt += 1) {
      const fake = makeFakeDb();
      seedListingWorld(fake);
      const key = `cancel-crash-${faultAt}`;
      const plan = buildCancelPlan(key);
      fake.faultAt = faultAt;
      let first: unknown;
      try {
        first = await executeShareListingCancelFlow(asDb(fake), plan, { idempotencyKey: key });
        await flushPostCommit();
      } catch (error) {
        first = error;
      } finally {
        fake.faultAt = null;
      }
      if (first instanceof Error) {
        expect(first.message).toBe("injected-crash");
      }
      let retry: Awaited<ReturnType<typeof executeShareListingCancelFlow>>;
      try {
        retry = await executeShareListingCancelFlow(asDb(fake), plan, { idempotencyKey: key });
        await flushPostCommit();
      } catch (error) {
        // Plan-store crash: the fake keeps executing the settle-failed line
        // a real crash would never reach, so the same-key retry throws
        // terminal. Either way nothing moved and a new key is required.
        expect(error).toBeInstanceOf(MoneyFlowTerminalError);
        expect((error as Error).message).toContain("plan-store");
        expect(listingDoc(fake).status).toBe("open");
        expect(offerDoc(fake, OFFER_ID).status).toBe("pending");
        expect(sellerShares(fake)).toBe(200);
        expect(receipt(fake, key)?.status).toBe("failed");
        continue;
      }
      if (retry.ok) {
        expect(retry.body).toEqual({ refundedOffers: 1, sharesReturned: 50 });
        expectCancelState(fake, key);
      } else {
        expect(listingDoc(fake).status).toBe("open");
        expect(offerDoc(fake, OFFER_ID).status).toBe("pending");
        expect(sellerShares(fake)).toBe(200);
        expect(receipt(fake, key)?.status).toBe("failed");
      }
    }
  });

  it("recovers a crashed in-progress cancel from its stored plan", async () => {
    const fake = makeFakeDb();
    seedListingWorld(fake);
    const plan = buildCancelPlan("cancel-crash-recover");
    fake.faultAt = 4;
    await expect(
      executeShareListingCancelFlow(asDb(fake), plan, { idempotencyKey: "cancel-crash-recover" })
    ).rejects.toThrow("injected-crash");
    fake.faultAt = null;
    expect(receipt(fake, "cancel-crash-recover")?.status).toBe("in_progress");
    expect(await getStoredShareListingCancelResponse(asDb(fake), "cancel-crash-recover")).toEqual({
      settled: false,
    });
    const recovered = await recoverShareListingCancelByKey(asDb(fake), "cancel-crash-recover");
    await flushPostCommit();
    expect(recovered.ok).toBe(true);
    if (recovered.ok) expect(recovered.body).toEqual({ refundedOffers: 1, sharesReturned: 50 });
    expectCancelState(fake, "cancel-crash-recover");
  });

  it("settles a plan-less legacy receipt as failed without moving money", async () => {
    const fake = makeFakeDb();
    seedListingWorld(fake);
    const now = new Date(NOW_ISO);
    seedDoc(fake, NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION, {
      _id: "legacy-cancel",
      status: "in_progress",
      fingerprint: `${SHARE_LISTING_CANCEL_FINGERPRINT_DOMAIN}:legacy`,
      createdAt: now,
      updatedAt: now,
    });
    const result = await recoverShareListingCancelReceipt(asDb(fake), "legacy-cancel");
    expect(result).toEqual({ cancelKey: "legacy-cancel", action: "settled-failed-no-plan" });
    expect(receipt(fake, "legacy-cancel")?.status).toBe("failed");
    expect(listingDoc(fake).status).toBe("open");
    expect(offerDoc(fake, OFFER_ID).status).toBe("pending");
    expect(sellerShares(fake)).toBe(200);
    await expect(
      recoverShareListingCancelByKey(asDb(fake), "legacy-cancel")
    ).rejects.toBeInstanceOf(MoneyFlowTerminalError);
  });

  it("reports a missing key lookup as null so the route validates fresh", async () => {
    const fake = makeFakeDb();
    expect(await getStoredShareListingCancelResponse(asDb(fake), "no-such-key")).toBeNull();
    const missing = await recoverShareListingCancelReceipt(asDb(fake), "no-such-key");
    expect(missing).toEqual({ cancelKey: "no-such-key", action: "skipped-missing" });
  });

  it("converges orphans, settles plan-less receipts, and skips foreign ones", async () => {
    const fake = makeFakeDb();
    seedListingWorld(fake);
    const crashedPlan = buildCancelPlan("orphan-cancel");
    fake.faultAt = 5;
    await expect(
      executeShareListingCancelFlow(asDb(fake), crashedPlan, { idempotencyKey: "orphan-cancel" })
    ).rejects.toThrow("injected-crash");
    fake.faultAt = null;
    expect(receipt(fake, "orphan-cancel")?.status).toBe("in_progress");

    const now = new Date(NOW_ISO);
    seedDoc(fake, NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION, {
      _id: "orphan-cancel-planless",
      status: "in_progress",
      fingerprint: `${SHARE_LISTING_CANCEL_FINGERPRINT_DOMAIN}:legacy`,
      createdAt: now,
      updatedAt: now,
    });
    seedDoc(fake, NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION, {
      _id: "orphan-cancel-foreign",
      status: "in_progress",
      fingerprint: "public-share-trade:foreign",
      createdAt: now,
      updatedAt: now,
    });

    const results = await recoverShareListingCancelOrphans(asDb(fake), 50);
    await flushPostCommit();
    const byKey = new Map(results.map((r) => [r.cancelKey, r.action]));
    expect(byKey.get("orphan-cancel")).toBe("cancel-recovered");
    expect(byKey.get("orphan-cancel-planless")).toBe("settled-failed-no-plan");
    expect(byKey.has("orphan-cancel-foreign")).toBe(false);
    expectCancelState(fake, "orphan-cancel");
    expect(receipt(fake, "orphan-cancel-planless")?.status).toBe("failed");
    expect(receipt(fake, "orphan-cancel-foreign")?.status).toBe("in_progress");
  });
});
