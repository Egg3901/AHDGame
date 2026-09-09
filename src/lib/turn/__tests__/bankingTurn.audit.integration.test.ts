import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { withInjectedCrash } from "@/lib/test-utils/faultyDb";
import { recoverBankingSettlements } from "@/lib/banking/recovery";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { processBankingTurn } from "../bankingTurn";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/audit/recordAudit", () => ({ recordAudit: vi.fn(), recordAuditBulk: vi.fn() }));
vi.mock("@/lib/financialTxLog/emit", () => ({
  emitTx: vi.fn().mockResolvedValue(undefined),
  emitTxBulk: vi.fn().mockResolvedValue(undefined),
  loadTxThresholds: vi.fn().mockResolvedValue({}),
}));

const TURN = 100;
const BANK = new ObjectId();

async function world() {
  const memory = createInMemoryDb();
  memory.seed("gameConfig", [{ _id: "default", privateBankingEnabled: true }]);
  memory.seed("gameState", [{ _id: "current", currentTurn: TURN, preset: "2019-default" }]);
  memory.seed("centralBanks", [
    {
      _id: "US",
      primeRate: 4,
      bankReserveRequirement: 0.1,
      externalBroadMoney: 0,
      reserveBalance: 0,
    },
  ]);
  memory.seed("corporations", [
    {
      _id: BANK,
      name: "Audit Bank",
      countryId: "US",
      liquidCapital: 0,
      liquidCurrencyCode: "USD",
      bankCharter: {
        type: "retail",
        status: "active",
        currency: "USD",
        charteredTurn: 1,
        postedCapital: 1_000_000,
        cashReserves: 1_000_000,
        npcDeposits: 0,
        totalDeposits: 0,
        totalLoans: 1_000_000,
        depositOffset: 0,
        lendingOffset: 0,
      },
    },
  ]);
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(memory as unknown as Db);
  return memory;
}

describe("banking audit accounting", () => {
  beforeEach(() => vi.clearAllMocks());

  it("services discount-window debt with proprietary trading disabled", async () => {
    const memory = await world();
    memory.collection("gameConfig").docs[0].bankPropTradingEnabled = false;
    const charter = memory.collection("corporations").docs[0].bankCharter as Record<
      string,
      unknown
    >;
    charter.lastBankingTurn = TURN;
    charter.discountWindowDebt = 100_000;
    charter.cbMarginDebt = 50_000;
    await processBankingTurn(memory as unknown as Db, TURN);
    // The window charges prime plus three points; margin activity is frozen.
    const interest = (100_000 * 0.07) / TURNS_PER_YEAR;
    expect(charter.cashReserves).toBeCloseTo(1_000_000 - interest, 8);
    expect(memory.collection("centralBanks").docs[0].reserveBalance).toBeCloseTo(interest, 8);
    expect(charter.lastDiscountWindowTurn).toBe(TURN);
    expect(charter.lastCbMarginTurn).toBeUndefined();
  });

  it.each([
    { collection: "corporations", onCall: 1 },
    { collection: "bankLoans", onCall: 1 },
    { collection: "corporations", onCall: 2 },
  ])(
    "keeps the household book matched to cash after interruption at $collection write $onCall",
    async ({ collection, onCall }) => {
      const memory = await world();
      memory.collection("centralBanks").docs[0].externalBroadMoney = 50_000;
      memory.seed("bankLoans", [
        {
          _id: new ObjectId(),
          bankCorporationId: BANK,
          currency: "USD",
          borrowerType: "npcBulk",
          outstanding: 1_000_000,
          principal: 1_000_000,
          ratePercent: 4,
          originatedTurn: TURN - 10,
          termTurns: 48,
          status: "current",
        },
      ]);
      const fault = withInjectedCrash(memory, {
        collection,
        op: "updateOne",
        onCall,
        afterWrite: true,
      });
      await expect(processBankingTurn(fault.db, TURN)).rejects.toThrow();
      fault.disarm();
      const repaired = await recoverBankingSettlements(memory as unknown as Db, TURN + 1);
      expect(repaired.stillPartial).toEqual([]);
      await processBankingTurn(memory as unknown as Db, TURN);
      const loan = memory.collection("bankLoans").docs[0];
      const charter = memory.collection("corporations").docs[0].bankCharter as Record<
        string,
        unknown
      >;
      // The original 25,000 principal repayment and 812.5 interest consume
      // 25,812.5 of the pool. A retry must not reprice that already-settled move.
      expect(memory.collection("centralBanks").docs[0].externalBroadMoney).toBe(24_187.5);
      expect(charter.cashReserves).toBe(1_025_812.5);
      expect(loan.outstanding).toBe(974_796.875);
      expect(charter.totalLoans).toBe(loan.outstanding);
    }
  );

  it("does not forgive household principal when the repayment pool is empty", async () => {
    const memory = await world();
    memory.seed("bankLoans", [
      {
        _id: new ObjectId(),
        bankCorporationId: BANK,
        currency: "USD",
        borrowerType: "npcBulk",
        outstanding: 1_000_000,
        principal: 1_000_000,
        ratePercent: 4,
        originatedTurn: TURN - 10,
        termTurns: 48,
        status: "current",
      },
    ]);
    const summary = await processBankingTurn(memory as unknown as Db, TURN);
    const loan = memory.collection("bankLoans").docs[0];
    const charter = memory.collection("corporations").docs[0].bankCharter as Record<
      string,
      unknown
    >;
    expect(loan.outstanding).toBeCloseTo(1_000_000 - summary.defaultsWrittenOff, 8);
    expect(charter.totalLoans).toBe(loan.outstanding);
    expect(charter.cashReserves).toBe(1_000_000);
    expect(memory.collection("centralBanks").docs[0].externalBroadMoney).toBe(0);
    expect(summary.unfinishedSettlements).toBe(0);
  });
});
