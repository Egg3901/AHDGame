import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import { MoneyFlowTerminalError } from "@/lib/db/nonAtomicMoneyFlow";
import {
  executeShareOrderRefundFlow,
  recoverShareOrderRefundByKey,
  recoverShareOrderRefundOrphans,
} from "./shareOrderRefund";
import { cancelFundShareOrder } from "@/lib/indexFunds/fundShareOrders";

vi.mock("@/lib/turn/currentTurn", () => ({
  getCurrentTurn: vi.fn().mockResolvedValue(7),
}));

// Fund cancels with a stored anchor remainder must never consult FX: the
// matcher pins the residual at fill time. Any FX read here is a bug.
vi.mock("@/lib/currency/corporationCapital", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/currency/corporationCapital")>();
  return {
    ...actual,
    getCorpFxRate: vi.fn(async () => {
      throw new Error("FX must not be consulted for stored-anchor fund refunds");
    }),
  };
});

// ---------------------------------------------------------------------------
// Minimal stateful fake covering exactly the operators the fund-cancel flow
// emits: receipt insert/find/update with dotted `$set` paths and duplicate
// key (11000) inserts, keyed updates with `$ne: key` guards plus `$set` /
// `$inc` / `$push` (`$each` + `$slice`) merges, `$exists` finds for the
// orphan scan, and a fault counter where the Nth write throws without
// landing, modeling a process death between sequential Mongo writes.
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

function matchesFilter(doc: Doc, filter: Doc): boolean {
  return Object.entries(filter).every(([key, cond]) => {
    const actual = key.includes(".") ? getPath(doc, key) : doc[key];
    if (cond !== null && typeof cond === "object" && !(cond instanceof ObjectId)) {
      const ops = cond as Doc;
      if ("$ne" in ops) {
        const unwanted = ops.$ne;
        if (Array.isArray(actual)) return !actual.some((entry) => valueEquals(entry, unwanted));
        if (actual === undefined) return true;
        return !valueEquals(actual, unwanted);
      }
      if ("$exists" in ops) {
        const exists = actual !== undefined;
        return exists === (ops.$exists as boolean);
      }
      if ("$gte" in ops) return (actual as number) >= (ops.$gte as number);
    }
    return valueEquals(actual, cond);
  });
}

function applyUpdate(doc: Doc, update: Doc): void {
  if (update.$set && typeof update.$set === "object") {
    for (const [path, value] of Object.entries(update.$set as Doc)) setPath(doc, path, value);
  }
  if (update.$inc && typeof update.$inc === "object") {
    for (const [path, delta] of Object.entries(update.$inc as Doc)) {
      setPath(doc, path, ((getPath(doc, path) as number) ?? 0) + (delta as number));
    }
  }
  if (update.$push && typeof update.$push === "object") {
    for (const [path, spec] of Object.entries(update.$push as Doc)) {
      const current = (getPath(doc, path) as unknown[]) ?? [];
      const each = (spec as Doc).$each as unknown[];
      const merged = [...current, ...each];
      const slice = (spec as Doc).$slice as number | undefined;
      setPath(doc, path, slice !== undefined ? merged.slice(slice) : merged);
    }
  }
}

interface FakeState {
  docs: Map<string, Map<string, Doc>>;
  writeCount: number;
  faultAt: number | null;
}

function makeDb(state: FakeState): { db: unknown; fundWrites: () => number } {
  let fundWrites = 0;
  const coll = (name: string) => {
    const store = (() => {
      let map = state.docs.get(name);
      if (!map) {
        map = new Map();
        state.docs.set(name, map);
      }
      return map;
    })();
    const maybeFault = (kind: "insert" | "update"): void => {
      void kind;
      state.writeCount += 1;
      if (state.faultAt !== null && state.writeCount === state.faultAt) {
        throw new Error("injected-crash");
      }
    };
    return {
      insertOne: async (doc: Doc) => {
        maybeFault("insert");
        const key = docKey(doc._id);
        if (store.has(key)) {
          const err = new Error("duplicate key") as Error & { code: number };
          err.code = 11000;
          throw err;
        }
        store.set(key, clone(doc));
        return { insertedId: doc._id };
      },
      findOne: async (filter: Doc) => {
        for (const doc of store.values()) {
          if (matchesFilter(doc, filter)) return clone(doc);
        }
        return null;
      },
      updateOne: async (filter: Doc, update: Doc) => {
        maybeFault("update");
        if (name === "indexFunds") fundWrites += 1;
        for (const doc of store.values()) {
          if (matchesFilter(doc, filter)) {
            applyUpdate(doc, update);
            return { matchedCount: 1, modifiedCount: 1 };
          }
        }
        return { matchedCount: 0, modifiedCount: 0 };
      },
      find: (filter: Doc) => {
        const matched = [...store.values()].filter((doc) => matchesFilter(doc, filter));
        return {
          limit: (n: number) => ({
            toArray: async () => clone(matched.slice(0, n)),
          }),
        };
      },
    };
  };
  const db = { collection: (name: string) => coll(name) };
  return { db, fundWrites: () => fundWrites };
}

function freshState(): FakeState {
  return { docs: new Map(), writeCount: 0, faultAt: null };
}

const FUND_KEY = "test-fund-cancel-key";

function seedFundOrder(
  state: FakeState,
  overrides: { sharesRemaining?: number; escrowAmount?: number; escrowAnchor?: number } = {}
): { orderId: ObjectId; fundId: ObjectId; corpId: ObjectId } {
  const orderId = new ObjectId();
  const fundId = new ObjectId();
  const corpId = new ObjectId();
  const orders = state.docs.get("shareOrders") ?? new Map<string, Doc>();
  orders.set(orderId.toHexString(), {
    _id: orderId,
    corporationId: corpId,
    placerFundId: fundId,
    type: "buy",
    shares: 100,
    sharesRemaining: overrides.sharesRemaining ?? 100,
    pricePerShare: 50,
    escrowAmount: overrides.escrowAmount ?? 5000,
    escrowAnchor: overrides.escrowAnchor ?? 2500,
    status: "open",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  state.docs.set("shareOrders", orders);
  const funds = state.docs.get("indexFunds") ?? new Map<string, Doc>();
  funds.set(fundId.toHexString(), { _id: fundId, cashAnchor: 10000 });
  state.docs.set("indexFunds", funds);
  return { orderId, fundId, corpId };
}

function readOrder(state: FakeState, orderId: ObjectId): Doc {
  return state.docs.get("shareOrders")?.get(orderId.toHexString()) as Doc;
}

function readFund(state: FakeState, fundId: ObjectId): Doc {
  return state.docs.get("indexFunds")?.get(fundId.toHexString()) as Doc;
}

function readReceipt(state: FakeState, key: string): Doc | undefined {
  return state.docs.get("nonAtomicMoneyFlowReceipts")?.get(key);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("fund-cancel keyed refund", () => {
  it("cancels and refunds the stored anchor remainder without touching FX", async () => {
    const state = freshState();
    const { orderId, fundId } = seedFundOrder(state);
    const { db } = makeDb(state);
    const order = readOrder(state, orderId);

    const result = await executeShareOrderRefundFlow(db as never, order as never, {
      idempotencyKey: FUND_KEY,
    });

    expect(result).toEqual({ ok: true });
    expect(readOrder(state, orderId).status).toBe("cancelled");
    expect(readFund(state, fundId).cashAnchor).toBe(12500);
    expect(readReceipt(state, FUND_KEY)?.status).toBe("completed");
  });

  it("refunds only the post-partial-fill residual, never the original escrow", async () => {
    const state = freshState();
    const { orderId, fundId } = seedFundOrder(state, {
      sharesRemaining: 60,
      escrowAmount: 3000,
      escrowAnchor: 1500,
    });
    const { db } = makeDb(state);

    const result = await executeShareOrderRefundFlow(
      db as never,
      readOrder(state, orderId) as never,
      { idempotencyKey: FUND_KEY }
    );

    expect(result).toEqual({ ok: true });
    expect(readFund(state, fundId).cashAnchor).toBe(11500);
  });

  it("cancels without refund when the fund document is gone", async () => {
    const state = freshState();
    const { orderId, fundId } = seedFundOrder(state);
    state.docs.get("indexFunds")?.delete(fundId.toHexString());
    const { db, fundWrites } = makeDb(state);

    const result = await executeShareOrderRefundFlow(
      db as never,
      readOrder(state, orderId) as never,
      { idempotencyKey: FUND_KEY }
    );

    expect(result).toEqual({ ok: true });
    expect(readOrder(state, orderId).status).toBe("cancelled");
    expect(fundWrites()).toBe(0);
  });

  it("same-key replay after success converges without double refund", async () => {
    const state = freshState();
    const { orderId, fundId } = seedFundOrder(state);
    const { db } = makeDb(state);

    await executeShareOrderRefundFlow(db as never, readOrder(state, orderId) as never, {
      idempotencyKey: FUND_KEY,
    });
    // The caller passes its stale open read again, like a retried request.
    const replay = await executeShareOrderRefundFlow(
      db as never,
      { ...readOrder(state, orderId), status: "open" } as never,
      { idempotencyKey: FUND_KEY }
    );

    expect(replay).toEqual({ ok: true });
    expect(readFund(state, fundId).cashAnchor).toBe(12500);
  });

  it("a competing key after success keeps the legacy not-open surface and moves no money", async () => {
    const state = freshState();
    const { orderId, fundId } = seedFundOrder(state);
    const { db } = makeDb(state);

    await executeShareOrderRefundFlow(db as never, readOrder(state, orderId) as never, {
      idempotencyKey: FUND_KEY,
    });
    const rival = await executeShareOrderRefundFlow(
      db as never,
      { ...readOrder(state, orderId), status: "open" } as never,
      { idempotencyKey: "rival-key" }
    );

    expect(rival).toEqual({ ok: false, error: "Order is not open" });
    expect(readFund(state, fundId).cashAnchor).toBe(12500);
  });

  it("crash at every write boundary converges to exactly-once or pristine", async () => {
    // Writes on the fresh fund-cancel path: receipt claim, order claim,
    // plan store, order-claim re-apply, fund refund, settle, outcome store.
    const totalWrites = 7;
    for (let crashAt = 1; crashAt <= totalWrites; crashAt += 1) {
      const state = freshState();
      const { orderId, fundId } = seedFundOrder(state);
      const { db } = makeDb(state);
      state.faultAt = crashAt;

      let attempt: unknown;
      try {
        attempt = await executeShareOrderRefundFlow(
          db as never,
          readOrder(state, orderId) as never,
          {
            idempotencyKey: FUND_KEY,
          }
        );
      } catch (err) {
        attempt = err;
      }
      if (crashAt <= 3 || crashAt === 7) {
        // Pre-step and post-settle writes propagate: nothing to compensate.
        expect((attempt as Error).message).toBe("injected-crash");
      } else {
        // Mid-step writes are caught into ok:false with the receipt left
        // in_progress holding the stored plan; recovery converges below.
        expect(attempt).toEqual({ ok: false, error: "injected-crash" });
        expect(readReceipt(state, FUND_KEY)?.status).toBe("in_progress");
      }
      state.faultAt = null;

      if (crashAt === 1) {
        // Nothing landed: a same-key retry is a fresh attempt and completes.
        const retry = await executeShareOrderRefundFlow(
          db as never,
          readOrder(state, orderId) as never,
          { idempotencyKey: FUND_KEY }
        );
        expect(retry).toEqual({ ok: true });
        expect(readFund(state, fundId).cashAnchor).toBe(12500);
        expect(readOrder(state, orderId).status).toBe("cancelled");
      } else if (crashAt === 2) {
        // Receipt claimed, order still open: recovery settles failed
        // truthfully (nothing moved) and a new key completes.
        const recovered = await recoverShareOrderRefundByKey(db as never, FUND_KEY);
        expect(recovered).toEqual({ ok: false, error: "Order is not open" });
        expect(readReceipt(state, FUND_KEY)?.status).toBe("failed");
        expect(readOrder(state, orderId).status).toBe("open");
        expect(readFund(state, fundId).cashAnchor).toBe(10000);
        const retry = await executeShareOrderRefundFlow(
          db as never,
          readOrder(state, orderId) as never,
          { idempotencyKey: "fresh-after-crash-2" }
        );
        expect(retry).toEqual({ ok: true });
        expect(readFund(state, fundId).cashAnchor).toBe(12500);
      } else if (crashAt === 3) {
        // Plan store failed: the claim reverted, the order is open, the
        // receipt is failed, and the key is terminal fail-closed.
        expect(readOrder(state, orderId).status).toBe("open");
        expect(readReceipt(state, FUND_KEY)?.status).toBe("failed");
        await expect(
          executeShareOrderRefundFlow(db as never, readOrder(state, orderId) as never, {
            idempotencyKey: FUND_KEY,
          })
        ).rejects.toBeInstanceOf(MoneyFlowTerminalError);
        const retry = await executeShareOrderRefundFlow(
          db as never,
          readOrder(state, orderId) as never,
          { idempotencyKey: "fresh-after-crash-3" }
        );
        expect(retry).toEqual({ ok: true });
        expect(readFund(state, fundId).cashAnchor).toBe(12500);
      } else {
        // Stored plan exists: key recovery replays to completion exactly once.
        const recovered = await recoverShareOrderRefundByKey(db as never, FUND_KEY);
        expect(recovered).toEqual({ ok: true });
        expect(readOrder(state, orderId).status).toBe("cancelled");
        expect(readFund(state, fundId).cashAnchor).toBe(12500);
        expect(readReceipt(state, FUND_KEY)?.status).toBe("completed");
      }
    }
  });

  it("the turn-driver orphan scan recovers a stranded mid-refund fund cancel", async () => {
    const state = freshState();
    const { orderId, fundId } = seedFundOrder(state);
    const { db } = makeDb(state);
    state.faultAt = 5;
    await expect(
      executeShareOrderRefundFlow(db as never, readOrder(state, orderId) as never, {
        idempotencyKey: FUND_KEY,
      })
    ).resolves.toEqual({ ok: false, error: "injected-crash" });
    state.faultAt = null;

    const results = await recoverShareOrderRefundOrphans(db as never, 50);

    expect(results).toEqual([{ refundKey: FUND_KEY, action: "refund-recovered" }]);
    expect(readFund(state, fundId).cashAnchor).toBe(12500);
    expect(readOrder(state, orderId).status).toBe("cancelled");
  });
});

describe("cancelFundShareOrder wrapper", () => {
  it("cancels and refunds through the keyed flow", async () => {
    const state = freshState();
    const { orderId, fundId } = seedFundOrder(state);
    const { db } = makeDb(state);

    await cancelFundShareOrder(db as never, orderId);

    expect(readOrder(state, orderId).status).toBe("cancelled");
    expect(readFund(state, fundId).cashAnchor).toBe(12500);
  });

  it("no-ops on missing, closed, and non-fund orders without writing receipts", async () => {
    const state = freshState();
    seedFundOrder(state);
    const { db } = makeDb(state);

    await cancelFundShareOrder(db as never, new ObjectId());
    const closedId = new ObjectId();
    const orders = state.docs.get("shareOrders")!;
    orders.set(closedId.toHexString(), {
      _id: closedId,
      corporationId: new ObjectId(),
      placerFundId: new ObjectId(),
      type: "buy",
      shares: 10,
      sharesRemaining: 10,
      pricePerShare: 5,
      escrowAmount: 50,
      escrowAnchor: 50,
      status: "filled",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await cancelFundShareOrder(db as never, closedId);
    const charOrderId = new ObjectId();
    orders.set(charOrderId.toHexString(), {
      _id: charOrderId,
      corporationId: new ObjectId(),
      characterId: new ObjectId(),
      type: "buy",
      shares: 10,
      sharesRemaining: 10,
      pricePerShare: 5,
      escrowAmount: 50,
      status: "open",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await cancelFundShareOrder(db as never, charOrderId);

    expect(state.docs.get("nonAtomicMoneyFlowReceipts")?.size ?? 0).toBe(0);
    expect((state.docs.get("shareOrders")?.get(charOrderId.toHexString()) as Doc).status).toBe(
      "open"
    );
  });
});
