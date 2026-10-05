import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { settleTransition, resumeSettlement } from "../settlementJournal";
import type { BankingTransition } from "../rules/boundary";

function fixture(retryCreditLegOnGuardFailure = true, cash = 100) {
  const memory = createInMemoryDb();
  memory.seed("accounts", [
    { _id: "payer", cash, denomination: "USD" },
    { _id: "seller", cash: 0, denomination: "EUR" },
  ]);
  const transition: BankingTransition = {
    key: "original-quote",
    kind: "funded.product.advertising",
    turn: 1,
    currency: "USD",
    retryCreditLegOnGuardFailure,
    legs: [
      {
        kind: "debit",
        amount: 10,
        collection: "accounts",
        filter: { _id: "payer", denomination: "USD" },
        path: "cash",
        note: "Original buyer debit",
      },
      {
        kind: "credit",
        amount: 10,
        collection: "accounts",
        filter: { _id: "seller", denomination: "USD" },
        path: "cash",
        note: "Original seller credit",
      },
    ],
    projections: [
      {
        collection: "accounts",
        filter: { _id: "payer" },
        update: { $set: { delivered: true } },
        note: "Publish only funded delivery",
      },
    ],
    event: { kind: "loan.originated", command: "funded.delivery" },
  };
  return {
    memory,
    db: memory as unknown as Db,
    transition,
    balances: () => memory.collection("accounts").docs.map((account) => account.cash),
    restore: () =>
      memory.collection("accounts").updateOne({ _id: "seller" }, { $set: { denomination: "USD" } }),
  };
}

describe("original funded credit retry", () => {
  it("retries only the refused credit after its guard is restored, including concurrent workers", async () => {
    const f = fixture();
    const stopped = await settleTransition(f.db, f.transition);
    expect(stopped.status).toBe("partial");
    expect(f.balances()).toEqual([90, 0]);
    expect(f.memory.collection("accounts").docs[0].delivered).toBeUndefined();
    await f.restore();
    await Promise.all([
      resumeSettlement(f.db, f.transition.key),
      resumeSettlement(f.db, f.transition.key),
    ]);
    await resumeSettlement(f.db, f.transition.key);
    expect(f.balances()).toEqual([90, 10]);
    expect(f.memory.collection("accounts").docs[0].delivered).toBe(true);
    expect(f.memory.collection("bankMoneyMoves").docs).toHaveLength(1);
  });

  it("keeps a refused credit terminal unless the original claim opted in", async () => {
    const f = fixture(false);
    await settleTransition(f.db, f.transition);
    await f.restore();
    await settleTransition(f.db, { ...f.transition, retryCreditLegOnGuardFailure: true });
    await resumeSettlement(f.db, f.transition.key);
    expect(f.balances()).toEqual([90, 0]);
    expect(f.memory.collection("accounts").docs[0].delivered).toBeUndefined();
  });

  it("does not retry a refused debit after the payer gains cash", async () => {
    const f = fixture(true, 0);
    await f.restore();
    await settleTransition(f.db, f.transition);
    await f.memory.collection("accounts").updateOne({ _id: "payer" }, { $set: { cash: 100 } });
    await resumeSettlement(f.db, f.transition.key);
    expect(f.balances()).toEqual([100, 0]);
  });

  it("never reopens a refunded original transfer", async () => {
    const f = fixture();
    await settleTransition(f.db, f.transition);
    await f.memory
      .collection("bankMoneyMoves")
      .updateOne({ _id: f.transition.key }, { $set: { status: "refunded" } });
    await f.restore();
    await resumeSettlement(f.db, f.transition.key);
    expect(f.balances()).toEqual([90, 0]);
  });
});
