import { describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { withInjectedCrash } from "@/lib/test-utils/faultyDb";
import { resumeSettlement, settleTransition } from "@/lib/banking/settlementJournal";
import { producerCashTransition } from "./cashSettlementRules";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

const corpId = new ObjectId("aaaaaaaaaaaaaaaaaaaaaaaa");
function world() {
  const memory = createInMemoryDb();
  memory.seed("corporations", [
    {
      _id: corpId,
      liquidCapital: 2000,
      bankCharter: { cashReserves: 5000, totalDeposits: 4000, totalLoans: 3000 },
    },
  ]);
  memory.seed("producerEconomyAccounts", [
    { _id: "households:example", worldEpoch: "example", cash: 0 },
  ]);
  const transition = producerCashTransition({
    worldEpoch: "example",
    turn: 1,
    receiptDigest: "a".repeat(64),
    opening: [
      { id: "corp", cash: 1000 },
      { id: "households", cash: 0 },
    ],
    closing: [
      { id: "corp", cash: 900 },
      { id: "households", cash: 100 },
    ],
    bindings: [
      {
        kind: "corporation",
        accountId: "corp",
        corporationId: corpId.toHexString(),
        currency: "USD",
        localPerAnchor: 2,
        openingCashLocal: 2000,
      },
      {
        kind: "economyAccount",
        accountId: "households",
        economyAccountId: "households:example",
        currency: "JPY",
        localPerAnchor: 100,
        openingCashLocal: 0,
      },
    ],
  });
  return { memory, transition };
}

describe("producer cash on the durable settlement journal", () => {
  it("pays once, conserves anchor cash and leaves bank assets and liabilities unchanged", async () => {
    const { memory, transition } = world();
    const db = memory as unknown as Db;
    expect((await settleTransition(db, transition)).status).toBe("applied");
    expect((await settleTransition(db, transition)).status).toBe("replayed");
    const corp = memory.collection("corporations").docs[0];
    const household = memory.collection("producerEconomyAccounts").docs[0];
    expect(corp.liquidCapital).toBe(1800);
    expect(household.cash).toBe(10000);
    expect(Number(corp.liquidCapital) / 2 + Number(household.cash) / 100).toBe(1000);
    expect(corp.bankCharter).toEqual({ cashReserves: 5000, totalDeposits: 4000, totalLoans: 3000 });
  });

  it.each([false, true])(
    "recovers a crash around a debit without duplicating the payment, afterWrite=%s",
    async (afterWrite) => {
      const { memory, transition } = world();
      const faulty = withInjectedCrash(memory, {
        collection: "corporations",
        onCall: 1,
        afterWrite,
      });
      // The money primitive can return a partial result or propagate the injected fault.
      await settleTransition(faulty.db, transition).catch(() => undefined);
      const result = await resumeSettlement(memory as unknown as Db, transition.key);
      expect(["applied", "replayed"]).toContain(result.status);
      expect(memory.collection("corporations").docs[0].liquidCapital).toBe(1800);
      expect(memory.collection("producerEconomyAccounts").docs[0].cash).toBe(10000);
    }
  );

  it("stops on a changed opening balance and cannot draw on a bank reserve to cover it", async () => {
    const { memory, transition } = world();
    memory.collection("corporations").docs[0].liquidCapital = 1900;
    const result = await settleTransition(memory as unknown as Db, transition);
    expect(["partial", "rejected"]).toContain(result.status);
    expect(memory.collection("producerEconomyAccounts").docs[0].cash).toBe(0);
    expect(memory.collection("corporations").docs[0].bankCharter).toMatchObject({
      cashReserves: 5000,
    });
  });
});
