import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import type { BankCharter } from "@/lib/db/types/bank";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { withInjectedCrash } from "@/lib/test-utils/faultyDb";
import { processBankingTurn } from "../bankingTurn";
vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/audit/recordAudit", () => ({ recordAudit: vi.fn(), recordAuditBulk: vi.fn() }));
const turn = 300,
  borrower = new ObjectId(),
  lender = new ObjectId(),
  loan = new ObjectId();
async function world(cash: number) {
  const memory = createInMemoryDb();
  memory.seed("gameConfig", [
    { _id: "default", privateBankingEnabled: true, bankPropTradingEnabled: true },
  ]);
  memory.seed("gameState", [{ _id: "current", currentTurn: turn, preset: "2019-default" }]);
  memory.seed("centralBanks", [{ _id: "US", primeRate: 4, externalBroadMoney: 0 }]);
  memory.seed(
    "corporations",
    [borrower, lender].map((_id, index) => ({
      _id,
      bankCharter: {
        type: "investment",
        status: "active",
        currency: "USD",
        cashReserves: index === 0 ? cash : 0,
        lastBankingTurn: turn,
        interbankDebt: index === 0 ? 48000 : 0,
        lastBankingIncome: 0,
        lastBankingInterbankInterestPaid: 0,
        lastBankingInterbankInterestReceived: 0,
      },
    }))
  );
  memory.seed("interbankLoans", [
    {
      _id: loan,
      lenderCorporationId: lender,
      borrowerCorporationId: borrower,
      currency: "USD",
      outstanding: 48000,
      ratePercent: 10,
      status: "current",
      arrearsTurns: 0,
    },
  ]);
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(memory as unknown as Db);
  return memory;
}
beforeEach(() => vi.clearAllMocks());
describe("interbank realized income follows journal cash", () => {
  it.each([
    { cash: 200, collection: "interbankLoans", field: "lastProcessedTurn", afterWrite: true },
    { cash: 50, collection: "interbankLoans", field: "lastProcessedTurn", afterWrite: true },
    {
      cash: 200,
      collection: "corporations",
      field: "bankCharter.lastBankingInterbankInterestPaid",
      afterWrite: false,
    },
    {
      cash: 200,
      collection: "corporations",
      field: "bankCharter.lastBankingInterbankInterestPaid",
      afterWrite: true,
    },
    {
      cash: 200,
      collection: "corporations",
      field: "bankCharter.lastBankingInterbankInterestReceived",
      afterWrite: false,
    },
    {
      cash: 200,
      collection: "corporations",
      field: "bankCharter.lastBankingInterbankInterestReceived",
      afterWrite: true,
    },
  ])(
    "recovers original paid interest and both income projections: %j",
    async ({ cash, collection, field, afterWrite }) => {
      const memory = await world(cash);
      const fault = withInjectedCrash(memory, {
        collection,
        op: "updateOne",
        onCall: 1,
        afterWrite,
        matches: (args) => {
          const update = args[1] as {
            $inc?: Record<string, unknown>;
            $set?: Record<string, unknown>;
          };
          return update.$inc?.[field] !== undefined || update.$set?.[field] !== undefined;
        },
      });
      await expect(processBankingTurn(fault.db, turn)).rejects.toThrow();
      fault.disarm();
      await processBankingTurn(memory as unknown as Db, turn);
      await processBankingTurn(memory as unknown as Db, turn);
      const [b, l] = memory
        .collection("corporations")
        .docs.map((row) => row.bankCharter as BankCharter);
      const paid = Math.min(100, cash);
      expect(b.cashReserves).toBe(cash - paid);
      expect(l.cashReserves).toBe(paid);
      expect(b.lastBankingIncome).toBe(-paid);
      expect(l.lastBankingIncome).toBe(paid);
      expect(b.lastBankingInterbankInterestPaid).toBe(paid);
      expect(l.lastBankingInterbankInterestReceived).toBe(paid);
      expect(memory.collection("interbankLoans").docs[0].lastProcessedTurn).toBe(turn);
      expect(
        memory.collection("bankMoneyMoves").docs.every((row) => row.status === "applied")
      ).toBe(true);
    }
  );
});
