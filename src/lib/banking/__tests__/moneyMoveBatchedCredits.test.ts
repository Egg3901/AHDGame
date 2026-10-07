import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { withInjectedCrash, InjectedCrash } from "@/lib/test-utils/faultyDb";
import {
  applyMoneyMove,
  legStamp,
  resumeMoneyMove,
  BATCHED_CREDIT_MIN_LEGS,
  type MoneyMove,
} from "../moneyMove";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

const OUTLETS = 12;

/** One payer fanning out to many payees: the product-advertising shape. */
function fixture(payees = OUTLETS, overrides: Record<string, Record<string, unknown>> = {}) {
  const memory = createInMemoryDb();
  memory.seed("accounts", [
    { _id: "payer", balance: 1000 },
    ...Array.from({ length: payees }, (_, i) => ({
      _id: `outlet-${i}`,
      balance: 0,
      state: "open",
      ...overrides[`outlet-${i}`],
    })),
  ]);
  const move: MoneyMove = {
    key: "ads:1",
    kind: "manufacturing.product.advertising",
    turn: 7,
    legs: [
      {
        kind: "debit",
        amount: payees * 10,
        collection: "accounts",
        filter: { _id: "payer" },
        path: "balance",
        note: "advertising spend",
      },
      ...Array.from({ length: payees }, (_, i) => ({
        kind: "credit" as const,
        amount: 10,
        collection: "accounts",
        filter: { _id: `outlet-${i}`, state: "open" },
        path: "balance",
        note: `outlet ${i}`,
      })),
    ],
  };
  const accounts = memory.collection("accounts");
  const journal = memory.collection("bankMoneyMoves");
  const balance = (id: string) => accounts.docs.find((d) => d._id === id)?.balance as number;
  const total = () => accounts.docs.reduce((sum, d) => sum + (d.balance as number), 0);
  return { memory, db: memory as unknown as Db, move, accounts, journal, balance, total };
}

/** Count calls the code under test makes on a collection, at the Db boundary. */
function countingDb(memory: ReturnType<typeof createInMemoryDb>, watched: string) {
  const counts: Record<string, number> = {};
  const db = new Proxy(memory, {
    get(target, prop, receiver) {
      if (prop !== "collection") return Reflect.get(target, prop, receiver);
      return (name: string) => {
        const inner = target.collection(name);
        if (name !== watched) return inner;
        return new Proxy(inner, {
          get(c, method, r) {
            const value = Reflect.get(c, method, r);
            if (typeof value !== "function") return value;
            return (...args: unknown[]) => {
              counts[String(method)] = (counts[String(method)] ?? 0) + 1;
              return value.apply(c, args);
            };
          },
        });
      };
    },
  }) as unknown as Db;
  return { db, counts };
}

describe("batched credit-leg delivery", () => {
  it("pays every payee exactly once and leaves the same receipts as the per-leg path", async () => {
    const f = fixture();
    const result = await applyMoneyMove(f.db, f.move);
    expect(result.status).toBe("applied");
    expect(result.applied).toHaveLength(OUTLETS + 1);
    expect(f.balance("payer")).toBe(1000 - OUTLETS * 10);
    for (let i = 0; i < OUTLETS; i++) {
      const outlet = f.accounts.docs.find((d) => d._id === `outlet-${i}`)!;
      expect(outlet.balance).toBe(10);
      expect(outlet.pendingMoneyMoveReceipt).toBeUndefined();
      expect(outlet.moneyMoveRevision).toBe(1);
      expect(outlet.settledKeys).toContain(legStamp("ads:1", i + 1));
    }
    const record = f.journal.docs[0] as { status: string; legs: { applied: boolean }[] };
    expect(record.status).toBe("applied");
    expect(record.legs.every((leg) => leg.applied)).toBe(true);
    expect(f.total()).toBe(1000);
  });

  it("delivers a wide fan-out in a fixed number of payee round trips", async () => {
    const f = fixture(40);
    const { db, counts } = countingDb(f.memory, "accounts");
    await applyMoneyMove(db, f.move);
    const payeeCalls = Object.values(counts).reduce((sum, n) => sum + n, 0);
    // Per leg this was a read and two writes on the target, for each of 40
    // payees. Batched it is two reads and two bulk writes, plus the debit.
    expect(payeeCalls).toBeLessThan(12);
    expect(f.total()).toBe(1000);
  });

  it("keeps a small move on the per-leg path", async () => {
    const f = fixture(BATCHED_CREDIT_MIN_LEGS - 1);
    const { db, counts } = countingDb(f.memory, "accounts");
    const result = await applyMoneyMove(db, f.move);
    expect(result.status).toBe("applied");
    expect(counts.bulkWrite ?? 0).toBe(0);
  });

  it("leaves a payee whose guard fails to the per-leg path, which records the refusal", async () => {
    const f = fixture(OUTLETS, { "outlet-3": { state: "closed" } });
    const result = await applyMoneyMove(f.db, f.move);
    expect(result.status).toBe("partial");
    expect(result.error).toMatch(/Leg 4 of ads:1/);
    expect(f.balance("outlet-3")).toBe(0);
    for (const i of [0, 1, 2, 4, 5, 11]) expect(f.balance(`outlet-${i}`)).toBe(10);
    // Nothing is created or lost: the refused credit is still owed, on record.
    expect(f.total()).toBe(1000 - 10);
    const record = f.journal.docs[0] as { legs: { applied: boolean; refusal?: string }[] };
    expect(record.legs[4].applied).toBe(false);
    expect(record.legs[4].refusal).toMatch(/did not apply/);
  });

  it("sends a repeated payee through the per-leg path so both credits land", async () => {
    const f = fixture();
    f.move.legs.push({ ...f.move.legs[1], note: "second credit to outlet 0" });
    f.move.legs[0] = { ...f.move.legs[0], amount: f.move.legs[0].amount + 10 };
    const result = await applyMoneyMove(f.db, f.move);
    expect(result.status).toBe("applied");
    expect(f.balance("outlet-0")).toBe(20);
    expect(f.total()).toBe(1000);
  });

  it("finishes from the receipts after a crash between the bulk write and the journal", async () => {
    const f = fixture();
    const faulty = withInjectedCrash(f.memory, {
      collection: "accounts",
      op: "bulkWrite",
      onCall: 1,
      afterWrite: true,
    });
    await expect(applyMoneyMove(faulty.db, f.move)).rejects.toBeInstanceOf(InjectedCrash);
    // The credits landed and carry their receipts; the journal does not know yet.
    expect(f.balance("outlet-0")).toBe(10);
    expect(
      f.accounts.docs.find((d) => d._id === "outlet-0")!.pendingMoneyMoveReceipt
    ).toBeDefined();
    faulty.disarm();
    const resumed = await resumeMoneyMove(f.db, "ads:1");
    expect(resumed.status).toBe("applied");
    for (let i = 0; i < OUTLETS; i++) {
      expect(f.balance(`outlet-${i}`)).toBe(10);
      expect(
        f.accounts.docs.find((d) => d._id === `outlet-${i}`)!.pendingMoneyMoveReceipt
      ).toBeUndefined();
    }
    expect(f.total()).toBe(1000);
    // A further resume moves nothing.
    await resumeMoneyMove(f.db, "ads:1");
    expect(f.total()).toBe(1000);
    expect(f.balance("payer")).toBe(1000 - OUTLETS * 10);
  });

  it("finishes after a crash between the journal acknowledgement and the receipt release", async () => {
    const f = fixture();
    const faulty = withInjectedCrash(f.memory, {
      collection: "accounts",
      op: "bulkWrite",
      onCall: 2,
    });
    await expect(applyMoneyMove(faulty.db, f.move)).rejects.toBeInstanceOf(InjectedCrash);
    faulty.disarm();
    const resumed = await resumeMoneyMove(f.db, "ads:1");
    expect(resumed.status).toBe("applied");
    expect(f.accounts.docs.every((d) => d.pendingMoneyMoveReceipt === undefined)).toBe(true);
    expect(f.total()).toBe(1000);
  });
});
