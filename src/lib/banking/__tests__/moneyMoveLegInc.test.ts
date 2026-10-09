/**
 * A leg's extra counters (`inc`) land in the same write as its balance, under
 * the same exactly-once receipt: a crash or replay never applies them twice,
 * and they never land without the money.
 */
import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { withInjectedCrash, InjectedCrash } from "@/lib/test-utils/faultyDb";
import { applyMoneyMove, resumeMoneyMove, type MoneyMove } from "../moneyMove";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

function fixture(payees = 1) {
  const memory = createInMemoryDb();
  memory.seed("accounts", [
    { _id: "payer", balance: 1000 },
    ...Array.from({ length: payees }, (_, i) => ({ _id: `t-${i}`, cash: 0, fiscal: 0 })),
  ]);
  const move: MoneyMove = {
    key: "tax:1",
    kind: "corporate_tax_withholding",
    turn: 7,
    legs: [
      {
        kind: "debit",
        amount: payees * 10,
        collection: "accounts",
        filter: { _id: "payer" },
        path: "balance",
        note: "withhold",
      },
      ...Array.from({ length: payees }, (_, i) => ({
        kind: "credit" as const,
        amount: 10,
        collection: "accounts",
        filter: { _id: `t-${i}` },
        path: "cash",
        inc: { fiscal: 10 },
        note: `treasury ${i}`,
      })),
    ],
  };
  const doc = (id: string) => memory.collection("accounts").docs.find((d) => d._id === id)!;
  return { memory, db: memory as unknown as Db, move, doc };
}

describe("money-move leg inc", () => {
  it("increments the counter with the balance, once", async () => {
    const f = fixture();
    expect((await applyMoneyMove(f.db, f.move)).status).toBe("applied");
    expect(f.doc("t-0")).toMatchObject({ cash: 10, fiscal: 10 });
    // A replay of the same key changes nothing.
    expect((await applyMoneyMove(f.db, f.move)).status).toBe("replayed");
    expect(f.doc("t-0")).toMatchObject({ cash: 10, fiscal: 10 });
  });

  it("applies the counter through batched credit delivery too", async () => {
    const f = fixture(8);
    expect((await applyMoneyMove(f.db, f.move)).status).toBe("applied");
    for (let i = 0; i < 8; i++) expect(f.doc(`t-${i}`)).toMatchObject({ cash: 10, fiscal: 10 });
    expect(f.doc("payer")).toMatchObject({ balance: 920 });
  });

  it("never doubles the counter when a crash interrupts the leg and the move resumes", async () => {
    const f = fixture();
    // Crash right after the treasury credit lands (the third accounts write: debit, its acknowledgement, then the credit),
    // before the journal records it.
    const faulty = withInjectedCrash(f.memory, {
      collection: "accounts",
      op: "updateOne",
      onCall: 3,
      afterWrite: true,
    });
    await expect(applyMoneyMove(faulty.db, f.move)).rejects.toBeInstanceOf(InjectedCrash);
    expect(f.doc("t-0")).toMatchObject({ cash: 10, fiscal: 10 });
    faulty.disarm();
    await resumeMoneyMove(f.db, f.move.key);
    await resumeMoneyMove(f.db, f.move.key);
    expect(f.doc("t-0")).toMatchObject({ cash: 10, fiscal: 10 });
    expect(f.doc("payer")).toMatchObject({ balance: 990 });
  });

  it.each([
    ["a reserved path", { moneyMoveRevision: 1 }],
    ["the balance itself", { cash: 1 }],
    ["a non-finite amount", { fiscal: Number.NaN }],
    ["no counters", {}],
  ])("rejects a leg whose counters name %s", async (_label, inc) => {
    const f = fixture();
    const move = {
      ...f.move,
      legs: f.move.legs.map((leg) =>
        leg.kind === "credit" ? { ...leg, inc: inc as Record<string, number> } : leg
      ),
    };
    const result = await applyMoneyMove(f.db, move);
    expect(result.status).toBe("rejected");
    expect(f.doc("t-0")).toMatchObject({ cash: 0, fiscal: 0 });
    expect(f.doc("payer")).toMatchObject({ balance: 1000 });
  });

  it("rejects counters on a mint or burn leg", async () => {
    const f = fixture();
    const move: MoneyMove = {
      ...f.move,
      key: "mint:1",
      legs: [{ kind: "mint", amount: 5, inc: { fiscal: 5 }, note: "mint" }],
    };
    expect((await applyMoneyMove(f.db, move)).status).toBe("rejected");
  });
});
