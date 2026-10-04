import type { Db } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { withInjectedCrash } from "@/lib/test-utils/faultyDb";
import { applyCountryTreasuryDelta } from "./applyEffects";

function hideFirstReceiptLookup(db: Db, receiptKey: string): Db {
  let hidden = false;
  return new Proxy(db, {
    get(target, property, receiver) {
      if (property === "collection") {
        return (name: string) => {
          const collection = target.collection(name);
          if (name !== "bankMoneyMoves") return collection;
          return new Proxy(collection, {
            get(collectionTarget, collectionProperty, collectionReceiver) {
              if (collectionProperty === "findOne") {
                return (filter: Record<string, unknown>, ...args: unknown[]) => {
                  if (!hidden && filter._id === receiptKey) {
                    hidden = true;
                    return Promise.resolve(null);
                  }
                  const findOne = Reflect.get(
                    collectionTarget,
                    collectionProperty,
                    collectionReceiver
                  ) as (...params: unknown[]) => unknown;
                  return findOne.apply(collectionTarget, [filter, ...args]);
                };
              }
              const value = Reflect.get(collectionTarget, collectionProperty, collectionReceiver);
              return typeof value === "function" ? value.bind(collectionTarget) : value;
            },
          });
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

vi.mock("@/lib/financialTxLog/emit", () => ({
  emitTx: vi.fn().mockResolvedValue("applied"),
}));

describe("funded national event Treasury cash", () => {
  beforeEach(() => vi.clearAllMocks());

  function setup() {
    const db = createInMemoryDb();
    db.seed("gameConfig", [{ _id: "default", treasuryCashLedgerEnabled: true }]);
    db.seed("gameState", [{ _id: "current", currentTurn: 4, preset: "2019-default" }]);
    db.seed("exchangeRates", [{ currencyCode: "USD", rate: 1 }]);
    db.seed("federalBudget", [
      {
        _id: "US",
        countryId: "US",
        currencyCode: "USD",
        treasuryCashLocal: 10,
        treasuryBalance: -20,
      },
    ]);
    return db;
  }

  it("replays a funded event cost with its original currency quote after a crash", async () => {
    const db = setup();
    const fault = withInjectedCrash(db, {
      collection: "federalBudget",
      op: "updateOne",
      afterWrite: true,
      onCall: 1,
      matches: (args) => {
        const update = args[1] as { $inc?: Record<string, number> };
        return update.$inc?.treasuryCashLocal === -5;
      },
    });

    await expect(
      applyCountryTreasuryDelta(
        fault.db as unknown as Db,
        "US",
        4,
        -5,
        { source: "fixture" },
        "2019-default",
        true,
        "world-event-treasury:fixture:0"
      )
    ).rejects.toThrow("crash after");
    fault.disarm();
    await db.collection("exchangeRates").updateOne({ currencyCode: "USD" }, { $set: { rate: 8 } });

    await applyCountryTreasuryDelta(
      fault.db as unknown as Db,
      "US",
      5,
      -900,
      { source: "replayed fixture" },
      "2019-default",
      true,
      "world-event-treasury:fixture:0"
    );

    expect(db.collection("federalBudget").docs[0]).toMatchObject({
      treasuryCashLocal: 5,
      treasuryBalance: -25,
    });
    expect(db.collection("bankMoneyMoves").docs).toHaveLength(1);
    expect(db.collection("bankMoneyMoves").docs[0]).toMatchObject({ status: "applied" });
  });

  it("keeps unbacked positive event awards analytical and outside Treasury cash", async () => {
    const db = setup();
    const { emitTx } = await import("@/lib/financialTxLog/emit");

    await applyCountryTreasuryDelta(
      db as unknown as Db,
      "US",
      4,
      5,
      { source: "sports victory" },
      "2019-default",
      true,
      "world-event-treasury:positive-fixture:0"
    );

    expect(db.collection("federalBudget").docs[0]).toMatchObject({
      treasuryCashLocal: 10,
      treasuryBalance: -15,
    });
    expect(emitTx).not.toHaveBeenCalled();
    expect(db.collection("bankMoneyMoves").docs).toHaveLength(1);
    expect(db.collection("bankMoneyMoves").docs[0]).toMatchObject({ status: "applied" });
  });

  it("does not log a concurrent replay while its funded Treasury debit is incomplete", async () => {
    const db = setup();
    const receiptKey = "world-event-treasury:inflight-fixture:0";
    const fault = withInjectedCrash(db, {
      collection: "bankMoneyMoves",
      op: "insertOne",
      afterWrite: true,
      onCall: 1,
      matches: (args) => {
        return (args[0] as { _id?: string })._id === receiptKey;
      },
    });

    await expect(
      applyCountryTreasuryDelta(
        fault.db,
        "US",
        4,
        -5,
        { source: "first caller" },
        "2019-default",
        true,
        receiptKey
      )
    ).rejects.toThrow("crash after");
    fault.disarm();
    expect(db.collection("bankMoneyMoves").docs[0]?.status).toBe("partial");
    const { emitTx } = await import("@/lib/financialTxLog/emit");
    vi.clearAllMocks();
    const recoveryFault = withInjectedCrash(db, {
      collection: "federalBudget",
      op: "updateOne",
      onCall: 1,
      matches: (args) => {
        const update = args[1] as { $inc?: Record<string, number> };
        return update.$inc?.treasuryCashLocal === -5;
      },
    });

    await expect(
      applyCountryTreasuryDelta(
        hideFirstReceiptLookup(recoveryFault.db, receiptKey),
        "US",
        5,
        -5,
        { source: "concurrent caller" },
        "2019-default",
        true,
        receiptKey
      )
    ).rejects.toThrow("crash before federalBudget.updateOne");

    expect(emitTx).not.toHaveBeenCalled();
    expect(db.collection("federalBudget").docs[0]).toMatchObject({
      treasuryCashLocal: 10,
      treasuryBalance: -20,
    });
    expect(db.collection("bankMoneyMoves").docs[0]?.status).toBe("partial");
  });
});
