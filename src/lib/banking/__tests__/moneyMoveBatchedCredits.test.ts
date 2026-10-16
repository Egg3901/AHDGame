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

/** Synthetic coupon fan-out; no world flags or settlement stamps are seeded. */
function mixedFixture(npps = 226, funds = 27, characters = 0) {
  const memory = createInMemoryDb();
  const groups = [
    ["npps", npps, 10, 1],
    ["indexFunds", funds, 5, 0.5],
    ["characters", characters, 10, 1],
  ] as const;
  const credits: MoneyMove["legs"] = [];
  for (const [collection, count, amount, rate] of groups) {
    memory.seed(
      collection,
      Array.from({ length: count }, (_, i) => ({
        _id: `payee-${i}`,
        balance: 0,
        state: "open",
      }))
    );
    for (let i = 0; i < count; i++)
      credits.push({
        kind: "credit",
        collection,
        filter: { _id: `payee-${i}` },
        path: "balance",
        amount,
        valuation: {
          currencyCode: collection === "indexFunds" ? "GBP" : "USD",
          localPerAnchor: rate,
        },
        note: "coupon",
      });
  }
  const amount = (npps + funds + characters) * 10;
  memory.seed("federalBudget", [{ _id: "US", balance: amount }]);
  const move: MoneyMove = {
    key: "mixed-coupon",
    kind: "sovereign_coupon_funded_batch_payout",
    legs: [
      {
        kind: "debit",
        collection: "federalBudget",
        filter: { _id: "US" },
        path: "balance",
        amount,
        valuation: { currencyCode: "USD", localPerAnchor: 1 },
        note: "funded cash",
      },
      ...credits,
    ],
  };
  const db = memory as unknown as Db;
  const checkPaid = (revision = 1) => {
    expect(memory.collection("federalBudget").docs[0].balance).toBe(0);
    let total = 0;
    for (const [collection, count, amount, rate] of groups) {
      expect(memory.collection(collection).docs).toHaveLength(count);
      for (const row of memory.collection(collection).docs) {
        expect(row.balance).toBe(amount);
        expect(row.pendingMoneyMoveReceipt).toBeUndefined();
        expect(row.moneyMoveRevision).toBe(revision);
        total += (row.balance as number) / rate;
      }
    }
    expect(total).toBe(move.legs[0].amount);
    const saved = memory.collection("bankMoneyMoves").docs[0] as unknown as {
      legs: MoneyMove["legs"];
    };
    expect(saved.legs.map(({ amount, valuation }) => ({ amount, valuation }))).toEqual(
      move.legs.map(({ amount, valuation }) => ({ amount, valuation }))
    );
  };
  return { memory, db, move, checkPaid };
}

describe("mixed coupon collections", () => {
  it.each([
    [226, 27, 0],
    [264, 27, 3],
  ])(
    "batches %i NPP, %i fund and %i character credits with bounded collection calls",
    async (npps, funds, characters) => {
      const f = mixedFixture(npps, funds, characters);
      const tracked = countingDb(f.memory, "indexFunds");
      const nppTracked = countingDb(
        tracked.db as unknown as ReturnType<typeof createInMemoryDb>,
        "npps"
      );
      expect((await applyMoneyMove(nppTracked.db, f.move)).status).toBe("applied");
      expect(Object.values(tracked.counts).reduce((a, b) => a + b, 0)).toBe(4);
      expect(Object.values(nppTracked.counts).reduce((a, b) => a + b, 0)).toBe(4);
      expect(f.move.legs).toHaveLength(npps + funds + characters + 1);
      f.checkPaid();
      expect((await applyMoneyMove(f.db, f.move)).status).toBe("replayed");
      expect((await resumeMoneyMove(f.db, f.move.key)).status).toBe("applied");
      f.checkPaid();
    }
  );

  it.each(["missing", "guard", "repeated-guard"])(
    "stops before later collections after an earlier %s target fails",
    async (failure) => {
      const f = mixedFixture(4, 6);
      if (failure === "missing") f.memory.collection("npps").docs.splice(1, 1);
      else if (failure === "guard") f.move.legs[2].filter!.state = "closed";
      else {
        f.move.legs.splice(5, 0, {
          ...f.move.legs[1],
          filter: { _id: "payee-0", state: "closed" },
        });
        f.move.legs[0].amount += 10;
        f.memory.collection("federalBudget").docs[0].balance = f.move.legs[0].amount;
      }
      expect((await applyMoneyMove(f.db, f.move)).status).toBe("partial");
      expect(f.memory.collection("indexFunds").docs.every((row) => row.balance === 0)).toBe(true);
    }
  );

  it("preserves existing target generations and stamps across collections", async () => {
    const f = mixedFixture(6, 5);
    for (const collection of ["npps", "indexFunds"]) {
      for (const row of f.memory.collection(collection).docs) {
        row.moneyMoveRevision = 17;
        row.settledKeys = ["older-delivery"];
      }
    }
    expect((await applyMoneyMove(f.db, f.move)).status).toBe("applied");
    f.checkPaid(18);
    for (const collection of ["npps", "indexFunds"]) {
      for (const row of f.memory.collection(collection).docs)
        expect(row.settledKeys).toContain("older-delivery");
    }
  });

  it("does not pay a later collection after a guard fails in the second batch", async () => {
    const f = mixedFixture(4, 4, 6);
    f.move.legs[5].filter!.state = "closed";
    expect((await applyMoneyMove(f.db, f.move)).status).toBe("partial");
    expect(f.memory.collection("npps").docs.every((row) => row.balance === 10)).toBe(true);
    expect(f.memory.collection("characters").docs.every((row) => row.balance === 0)).toBe(true);
  });

  it("keeps a failed small first collection ahead of a larger later batch", async () => {
    const f = mixedFixture(1, 6);
    f.memory.collection("npps").docs.splice(0, 1);
    expect((await applyMoneyMove(f.db, f.move)).status).toBe("partial");
    expect(f.memory.collection("indexFunds").docs.every((row) => row.balance === 0)).toBe(true);
  });

  it("keeps interleaved collection runs and repeated targets in caller order", async () => {
    const f = mixedFixture(5, 4);
    const lastNpp = f.move.legs.splice(5, 1)[0];
    f.move.legs.push(lastNpp, { ...f.move.legs[1], note: "second NPP coupon" });
    f.move.legs[0].amount += 10;
    f.memory.collection("federalBudget").docs[0].balance = f.move.legs[0].amount;
    expect((await applyMoneyMove(f.db, f.move)).status).toBe("applied");
    expect(f.memory.collection("npps").docs.map((row) => row.balance)).toEqual([
      20, 10, 10, 10, 10,
    ]);
    expect(f.memory.collection("indexFunds").docs.every((row) => row.balance === 5)).toBe(true);
    await resumeMoneyMove(f.db, f.move.key);
    expect(f.memory.collection("npps").docs[0].balance).toBe(20);
  });

  it("resumes after only part of the second collection bulk delivery lands", async () => {
    const f = mixedFixture(6, 5);
    const targets = f.memory.collection("indexFunds");
    const bulkWrite = targets.bulkWrite.bind(targets);
    vi.spyOn(targets, "bulkWrite").mockImplementationOnce(async (writes) => {
      await bulkWrite(writes.slice(0, 2));
      throw new InjectedCrash("partial fund bulk delivery");
    });
    await expect(applyMoneyMove(f.db, f.move)).rejects.toBeInstanceOf(InjectedCrash);
    expect(targets.docs.map((row) => row.balance)).toEqual([5, 5, 0, 0, 0]);
    expect((await resumeMoneyMove(f.db, f.move.key)).status).toBe("applied");
    f.checkPaid();
    await resumeMoneyMove(f.db, f.move.key);
    f.checkPaid();
  });

  for (const collection of ["npps", "indexFunds"]) {
    for (const [stage, op, onCall, afterWrite] of [
      ["delivery", "bulkWrite", 1, true],
      ["acknowledgement", "updateOne", 1, true],
      ["release", "bulkWrite", 2, true],
    ] as const) {
      it(`resumes exactly once after ${collection} ${stage}`, async () => {
        const f = mixedFixture(6, 5);
        const faulty = withInjectedCrash(
          f.memory,
          stage === "acknowledgement"
            ? {
                collection: "bankMoneyMoves",
                op,
                onCall,
                afterWrite,
                matches: (args) =>
                  Object.keys((args[1] as { $set?: object }).$set ?? {}).length ===
                  (collection === "npps" ? 6 : 5),
              }
            : { collection, op, onCall, afterWrite }
        );
        await expect(applyMoneyMove(faulty.db, f.move)).rejects.toBeInstanceOf(InjectedCrash);
        faulty.disarm();
        expect((await resumeMoneyMove(f.db, f.move.key)).status).toBe("applied");
        f.checkPaid();
        await resumeMoneyMove(f.db, f.move.key);
        f.checkPaid();
      });
    }
  }
});
