import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import type { BankCharter } from "@/lib/db/types/bank";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { withInjectedCrash } from "@/lib/test-utils/faultyDb";
import { executeLiquidityAdvance, resumeLiquidityAdvances } from "./liquidityAdvance";
vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/audit/recordAudit", () => ({ recordAudit: vi.fn(), recordAuditBulk: vi.fn() }));
const first = new ObjectId(),
  second = new ObjectId();
const command = {
  operationId: "liquidity-command-one",
  countryId: "US" as const,
  turn: 20,
  amount: 400,
  actorName: "Test Chair",
};
function world() {
  const memory = createInMemoryDb();
  memory.seed("gameConfig", [{ _id: "default", privateBankingEnabled: true }]);
  memory.seed("gameState", [{ _id: "current", turnLengthMinutes: 60 }]);
  memory.seed("exchangeRates", [{ currencyCode: "USD", rate: 2 }]);
  memory.seed("centralBanks", [{ _id: "US", reserveBalance: 100, netMoneyCreatedLifetime: 0 }]);
  memory.seed(
    "corporations",
    [first, second].map((id, index) => ({
      _id: id,
      name: "Test bank",
      liquidCapital: 17,
      bankCharter: {
        status: "active",
        currency: "USD",
        cashReserves: 100,
        cbMarginDebt: 0,
        totalDeposits: index === 0 ? 900 : 300,
      },
    }))
  );
  return memory;
}
function snapshot(memory: ReturnType<typeof world>) {
  return {
    banks: memory
      .collection("corporations")
      .docs.map((row) => ({ ...row, bankCharter: row.bankCharter as BankCharter })),
    central: memory.collection("centralBanks").docs,
    logs: memory.collection("financialTxLog").docs,
  };
}
beforeEach(() => vi.clearAllMocks());
describe("durable liquidity advance commands", () => {
  it("preserves pro-rata allocation, native cash, debt and one receipt on replay", async () => {
    const memory = world(),
      db = memory as unknown as Db;
    const result = await executeLiquidityAdvance(db, command, 6);
    expect(result).toMatchObject({ amount: 400, banksCredited: 2, reserveDelta: 0 });
    const state = snapshot(memory);
    expect(state.banks.map((bank) => bank.bankCharter.cashReserves)).toEqual([400, 200]);
    expect(state.banks.map((bank) => bank.bankCharter.cbMarginDebt)).toEqual([300, 100]);
    expect(state.banks.map((bank) => bank.liquidCapital)).toEqual([17, 17]);
    expect(state.central[0]).toMatchObject({
      reserveBalance: 100,
      netMoneyCreatedLifetime: 400,
      lastMonetaryOperationTurn: 20,
    });
    expect(state.central[0].monetaryOperations).toHaveLength(1);
    expect(state.logs).toHaveLength(2);
    expect(state.logs.map((tx) => tx.anchorAmount)).toEqual([150, 50]);
    const before = JSON.stringify(state);
    expect(await executeLiquidityAdvance(db, { ...command, turn: 21 }, 6)).toEqual(result);
    expect(JSON.stringify(snapshot(memory))).toEqual(before);
  });
  it.each([
    { collection: "corporations", onCall: 1, afterWrite: true },
    { collection: "corporations", onCall: 2, afterWrite: false },
    { collection: "centralBanks", onCall: 2, afterWrite: true },
    { collection: "financialTxLog", onCall: 1, afterWrite: false },
    { collection: "financialTxLog", onCall: 1, afterWrite: true },
  ])(
    "recovers the stored recipient plan after an interruption %j",
    async ({ collection, onCall, afterWrite }) => {
      const memory = world();
      const fault = withInjectedCrash(memory, {
        collection,
        op: "updateOne",
        onCall,
        afterWrite,
      });
      await expect(executeLiquidityAdvance(fault.db, command, 6)).rejects.toThrow();
      fault.disarm();
      await resumeLiquidityAdvances(memory as unknown as Db, 6);
      await resumeLiquidityAdvances(memory as unknown as Db, 6);
      const state = snapshot(memory);
      expect(state.banks.map((bank) => bank.bankCharter.cashReserves)).toEqual([400, 200]);
      expect(state.banks.map((bank) => bank.bankCharter.cbMarginDebt)).toEqual([300, 100]);
      expect(state.central[0].netMoneyCreatedLifetime).toBe(400);
      expect(state.central[0].monetaryOperations).toHaveLength(1);
      expect(state.logs).toHaveLength(2);
    }
  );
  it("preserves native receipts without inventing a missing FX valuation", async () => {
    const memory = world();
    memory.collection("exchangeRates").docs.splice(0);
    await executeLiquidityAdvance(memory as unknown as Db, command, 6);
    expect(snapshot(memory).logs).toHaveLength(2);
    for (const tx of snapshot(memory).logs) {
      expect(tx.anchorAmount).toBeUndefined();
      expect((tx.meta as Record<string, unknown>).anchorValuation).toBe("unavailable");
    }
  });
  it("uses the original command across concurrent same-ID delivery", async () => {
    const memory = world(),
      db = memory as unknown as Db;
    const results = await Promise.all([
      executeLiquidityAdvance(db, command, 6),
      executeLiquidityAdvance(db, command, 6),
    ]);
    expect(results[0]).toEqual(results[1]);
    expect(snapshot(memory).central[0].netMoneyCreatedLifetime).toBe(400);
    await expect(executeLiquidityAdvance(db, { ...command, amount: 800 }, 6)).rejects.toThrow(
      "different liquidity inputs"
    );
  });
  it("preserves explicit repeated admin commands while ordinary fresh commands obey cooldown", async () => {
    const memory = world(),
      db = memory as unknown as Db;
    await executeLiquidityAdvance(db, command, 6);
    await expect(
      executeLiquidityAdvance(db, { ...command, operationId: "fresh-normal" }, 6)
    ).rejects.toThrow("cooldown");
    await executeLiquidityAdvance(
      db,
      { ...command, operationId: "fresh-admin", bypassCooldown: true },
      6
    );
    expect(snapshot(memory).central[0].netMoneyCreatedLifetime).toBe(800);
    expect(snapshot(memory).central[0].monetaryOperations).toHaveLength(2);
  });
  it("counts only eligible recipients from an interrupted frozen plan", async () => {
    const memory = world();
    const fault = withInjectedCrash(memory, {
      collection: "bankLiquidityOperations",
      op: "insertOne",
      onCall: 1,
      afterWrite: true,
    });
    await expect(executeLiquidityAdvance(fault.db, command, 6)).rejects.toThrow();
    snapshot(memory).banks[0].bankCharter.status = "failed";
    fault.disarm();
    const result = await executeLiquidityAdvance(memory as unknown as Db, command, 6);
    expect(result).toMatchObject({ amount: 100, banksCredited: 1 });
    expect(snapshot(memory).central[0].netMoneyCreatedLifetime).toBe(100);
    expect(snapshot(memory).banks.map((bank) => bank.bankCharter.cashReserves)).toEqual([100, 200]);
  });
  it("retains the reserve fallback with private banking disabled", async () => {
    const memory = world();
    memory.collection("gameConfig").docs[0].privateBankingEnabled = false;
    await executeLiquidityAdvance(memory as unknown as Db, command, 6);
    await executeLiquidityAdvance(memory as unknown as Db, command, 6);
    expect(snapshot(memory).central[0]).toMatchObject({
      reserveBalance: 500,
      netMoneyCreatedLifetime: 0,
    });
    expect(snapshot(memory).banks.map((bank) => bank.bankCharter.cashReserves)).toEqual([100, 100]);
  });
});
