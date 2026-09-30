import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { applyMoneyMove, closeMoneyMove, resumeMoneyMove, type MoneyMove } from "../moneyMove";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

function fixture() {
  const memory = createInMemoryDb();
  memory.seed("accounts", [
    { _id: "source", balance: 1000, state: "open" },
    { _id: "destination", balance: 100 },
  ]);
  const db = memory as unknown as Db;
  const accounts = memory.collection("accounts");
  const journals = memory.collection("bankMoneyMoves");
  const move: MoneyMove = {
    key: "original",
    kind: "transfer",
    legs: [
      {
        kind: "debit",
        amount: 10,
        collection: "accounts",
        filter: { _id: "source" },
        path: "balance",
        note: "out",
      },
      {
        kind: "credit",
        amount: 10,
        collection: "accounts",
        filter: { _id: "destination" },
        path: "balance",
        note: "in",
      },
    ],
  };
  const balances = () => accounts.docs.map((d) => d.balance);
  const churn = async (side: string) =>
    accounts.updateOne(
      { _id: side },
      { $set: { settledKeys: Array.from({ length: 200 }, (_, i) => `other:${i}`) } }
    );
  return { db, accounts, journals, move, balances, churn };
}

for (const side of ["source", "destination"] as const) {
  describe(`${side} cash recovery`, () => {
    it("retains delivery through receipt history replacement", async () => {
      const f = fixture();
      const write = f.accounts.updateOne.bind(f.accounts);
      let interrupted = false;
      vi.spyOn(f.accounts, "updateOne").mockImplementation(async (filter, update, options) => {
        const result = await write(filter, update, options);
        const marker = !Array.isArray(update)
          ? ((update.$set as Record<string, unknown> | undefined)?.pendingMoneyMoveReceipt as
              { index?: number } | undefined)
          : undefined;
        if (
          !interrupted &&
          marker?.index === (side === "source" ? 0 : 1) &&
          !Array.isArray(update) &&
          (update.$inc as Record<string, unknown>)?.balance
        ) {
          interrupted = true;
          throw new Error("lost cash acknowledgement");
        }
        return result;
      });
      await expect(applyMoneyMove(f.db, f.move)).rejects.toThrow("lost cash acknowledgement");
      await f.churn(side);
      expect((await resumeMoneyMove(f.db, f.move.key)).status).toBe("applied");
      expect(f.balances()).toEqual([990, 110]);
      await resumeMoneyMove(f.db, f.move.key);
      expect(f.balances()).toEqual([990, 110]);
      expect(f.accounts.docs.every((d) => !d.pendingMoneyMoveReceipt)).toBe(true);
    });

    it("does not let a paused cash writer repeat a completed leg", async () => {
      const f = fixture();
      const write = f.accounts.updateOne.bind(f.accounts);
      let release!: () => void;
      const paused = new Promise<void>((resolve) => {
        release = resolve;
      });
      let signal!: () => void;
      const entered = new Promise<void>((resolve) => {
        signal = resolve;
      });
      let held = false;
      vi.spyOn(f.accounts, "updateOne").mockImplementation(async (filter, update, options) => {
        const marker = !Array.isArray(update)
          ? ((update.$set as Record<string, unknown> | undefined)?.pendingMoneyMoveReceipt as
              { index?: number } | undefined)
          : undefined;
        if (
          !held &&
          marker?.index === (side === "source" ? 0 : 1) &&
          !Array.isArray(update) &&
          (update.$inc as Record<string, unknown>)?.balance
        ) {
          held = true;
          signal();
          await paused;
        }
        return write(filter, update, options);
      });
      const first = applyMoneyMove(f.db, f.move);
      await entered;
      expect((await resumeMoneyMove(f.db, f.move.key)).status).toBe("applied");
      await f.churn(side);
      release();
      expect((await first).status).toBe("applied");
      expect(f.balances()).toEqual([990, 110]);
      expect(f.journals.docs[0].status).toBe("applied");
    });

    it("releases a receipt after acknowledgement succeeds but cleanup is interrupted", async () => {
      const f = fixture();
      const write = f.accounts.updateOne.bind(f.accounts);
      let interrupted = false;
      vi.spyOn(f.accounts, "updateOne").mockImplementation(async (filter, update, options) => {
        if (!interrupted && filter._id === side && !Array.isArray(update) && update.$unset) {
          interrupted = true;
          throw new Error("before cleanup");
        }
        return write(filter, update, options);
      });
      await expect(applyMoneyMove(f.db, f.move)).rejects.toThrow("before cleanup");
      await f.churn(side);
      expect((await resumeMoneyMove(f.db, f.move.key)).status).toBe("applied");
      expect(f.balances()).toEqual([990, 110]);
      expect(f.accounts.docs.every((d) => !d.pendingMoneyMoveReceipt)).toBe(true);
    });
  });
}

describe("durable leg outcomes", () => {
  it("keeps an acknowledged refusal terminal after eligibility improves", async () => {
    const f = fixture();
    f.accounts.docs[0].balance = 5;
    const write = f.accounts.updateOne.bind(f.accounts);
    let interrupted = false;
    vi.spyOn(f.accounts, "updateOne").mockImplementation(async (filter, update, options) => {
      const result = await write(filter, update, options);
      const marker = !Array.isArray(update)
        ? ((update.$set as Record<string, unknown> | undefined)?.pendingMoneyMoveReceipt as
            { outcome?: string } | undefined)
        : undefined;
      if (!interrupted && marker?.outcome === "rejected") {
        interrupted = true;
        throw new Error("lost refusal acknowledgement");
      }
      return result;
    });
    await expect(applyMoneyMove(f.db, f.move)).rejects.toThrow("lost refusal acknowledgement");
    f.accounts.docs[0].balance = 1000;
    await f.churn("source");
    expect((await resumeMoneyMove(f.db, f.move.key)).status).toBe("rejected");
    expect((await resumeMoneyMove(f.db, f.move.key)).status).toBe("rejected");
    expect(f.balances()).toEqual([1000, 100]);
    expect((await applyMoneyMove(f.db, { ...f.move, key: "new" })).status).toBe("applied");
    expect(f.balances()).toEqual([990, 110]);
  });

  it("acknowledges another pending owner before using that target", async () => {
    const f = fixture();
    const write = f.journals.updateOne.bind(f.journals);
    let interrupted = false;
    vi.spyOn(f.journals, "updateOne").mockImplementation(async (filter, update, options) => {
      if (
        !interrupted &&
        !Array.isArray(update) &&
        (update.$set as Record<string, unknown>)?.["legs.0.applied"]
      ) {
        interrupted = true;
        throw new Error("before journal acknowledgement");
      }
      return write(filter, update, options);
    });
    await expect(applyMoneyMove(f.db, f.move)).rejects.toThrow("before journal acknowledgement");
    expect((await applyMoneyMove(f.db, { ...f.move, key: "second" })).status).toBe("applied");
    expect((await resumeMoneyMove(f.db, f.move.key)).status).toBe("applied");
    expect(f.balances()).toEqual([980, 120]);
  });

  it("finds delivery by stable id after the same cash write changes a selector field", async () => {
    const f = fixture();
    f.move.legs[0].filter = { _id: "source", state: "open" };
    f.move.legs[0].set = { state: "closed" };
    const write = f.journals.updateOne.bind(f.journals);
    let interrupted = false;
    vi.spyOn(f.journals, "updateOne").mockImplementation(async (filter, update, options) => {
      if (
        !interrupted &&
        !Array.isArray(update) &&
        (update.$set as Record<string, unknown>)?.["legs.0.applied"]
      ) {
        interrupted = true;
        throw new Error("before acknowledgement");
      }
      return write(filter, update, options);
    });
    await expect(applyMoneyMove(f.db, f.move)).rejects.toThrow("before acknowledgement");
    await f.churn("source");
    expect((await resumeMoneyMove(f.db, f.move.key)).status).toBe("applied");
    expect(f.balances()).toEqual([990, 110]);
  });

  it("does not acknowledge a receipt pointing at another target", async () => {
    const f = fixture();
    await f.journals.insertOne({
      _id: "foreign",
      status: "partial",
      kind: "transfer",
      legs: f.move.legs.map((leg) => ({ ...leg, applied: false })),
    });
    f.accounts.docs[0].pendingMoneyMoveReceipt = {
      key: "foreign",
      index: 1,
      generation: 1,
      outcome: "applied",
    };
    await expect(applyMoneyMove(f.db, f.move)).rejects.toThrow("requires journal reconciliation");
    expect(f.journals.docs[0].legs).toEqual(f.move.legs.map((leg) => ({ ...leg, applied: false })));
    expect(f.balances()).toEqual([1000, 100]);
  });

  it("preserves an operator-reconciled terminal disposition", async () => {
    const f = fixture();
    await f.journals.insertOne({
      _id: f.move.key,
      status: "partial",
      kind: "transfer",
      legs: f.move.legs.map((leg) => ({ ...leg, applied: false })),
    });
    expect(await closeMoneyMove(f.db, f.move.key, "reconciled externally")).toBe(true);
    expect((await resumeMoneyMove(f.db, f.move.key)).status).toBe("applied");
    expect(f.balances()).toEqual([1000, 100]);
    expect(f.journals.docs[0].status).toBe("applied");
  });

  it("binds selector targets once and replays after those selector fields change", async () => {
    const f = fixture();
    f.move.legs[0].filter = { state: "open" };
    f.move.legs[0].set = { state: "closed" };
    expect((await applyMoneyMove(f.db, f.move)).status).toBe("applied");
    expect((await applyMoneyMove(f.db, f.move)).status).toBe("replayed");
    expect((await resumeMoneyMove(f.db, f.move.key)).status).toBe("applied");
    expect(f.balances()).toEqual([990, 110]);
    expect(f.journals.docs[0].legs).toMatchObject([
      { filter: { _id: "source", state: "open" } },
      {},
    ]);
  });

  it("refuses missing selector targets before any other leg delivers cash", async () => {
    const f = fixture();
    f.move.legs[1].filter = { state: "not-yet-created" };
    expect((await applyMoneyMove(f.db, f.move)).status).toBe("rejected");
    expect(f.balances()).toEqual([1000, 100]);
    f.accounts.docs[1].state = "not-yet-created";
    expect((await applyMoneyMove(f.db, f.move)).status).toBe("replayed");
    expect((await resumeMoneyMove(f.db, f.move.key)).status).toBe("rejected");
    expect(f.balances()).toEqual([1000, 100]);
  });

  it("leaves ambiguous legacy delivery for reconciliation", async () => {
    const f = fixture();
    await f.journals.insertOne({
      _id: f.move.key,
      status: "partial",
      kind: "transfer",
      legs: f.move.legs.map((leg) => ({ ...leg, applied: false })),
    });
    f.accounts.docs[0].balance = 990;
    await f.churn("source");
    expect(await resumeMoneyMove(f.db, f.move.key)).toMatchObject({
      status: "partial",
      error: expect.stringContaining("no surviving delivery proof"),
    });
    expect(f.balances()).toEqual([990, 100]);
  });
});

it("retains a missing-selector refusal when its claim acknowledgement is lost", async () => {
  const f = fixture();
  f.move.legs[1].filter = { state: "missing" };
  const insert = f.journals.insertOne.bind(f.journals);
  vi.spyOn(f.journals, "insertOne").mockImplementationOnce(async (record) => {
    await insert(record);
    throw new Error("lost rejected claim acknowledgement");
  });
  await expect(applyMoneyMove(f.db, f.move)).rejects.toThrow("lost rejected claim");
  await f.accounts.updateOne({ _id: "destination" }, { $set: { state: "missing" } });
  expect((await resumeMoneyMove(f.db, f.move.key)).status).toBe("rejected");
  expect(f.balances()).toEqual([1000, 100]);
});
