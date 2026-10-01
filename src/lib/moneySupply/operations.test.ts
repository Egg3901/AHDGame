import { describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import type { BankCharter } from "@/lib/db/types/bank";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { executeMonetaryOperation } from "./operations";
vi.mock("@/lib/banking/featureFlag", () => ({
  isPrivateBankingEnabled: vi.fn().mockResolvedValue(true),
}));
describe("liquidity operation wrapper", () => {
  it.each([
    { deposits: [900, 300], enabled: true, expected: [300, 100], reserve: 0 },
    { deposits: [0, 0], enabled: true, expected: [200, 200], reserve: 0 },
    { deposits: [], enabled: true, expected: [], reserve: 400 },
  ])(
    "routes a liquidity command through funded settlement: %j",
    async ({ deposits, expected, reserve }) => {
      const memory = createInMemoryDb();
      memory.seed("centralBanks", [{ _id: "US", reserveBalance: 100, netMoneyCreatedLifetime: 0 }]);
      memory.seed("gameConfig", [{ _id: "default", privateBankingEnabled: true }]);
      memory.seed(
        "corporations",
        deposits.map((totalDeposits) => ({
          _id: new ObjectId(),
          bankCharter: {
            status: "active",
            currency: "USD",
            cashReserves: 0,
            cbMarginDebt: 0,
            totalDeposits,
          },
        }))
      );
      const result = await executeMonetaryOperation(memory as unknown as Db, {
        countryId: "US",
        type: "liquidity_injection",
        turn: 12,
        actorName: "Chair",
        amount: 400,
        operationId: "wrapper-liquidity",
      });
      expect(
        memory
          .collection("corporations")
          .docs.map((bank) => (bank.bankCharter as BankCharter).cashReserves)
      ).toEqual(expected);
      expect(result.reserveDelta).toBe(reserve);
      expect(result.banksCredited).toBe(expected.length);
      expect(memory.collection("centralBanks").docs[0].reserveBalance).toBe(100 + reserve);
    }
  );
  it.each(["treasury_advance", "liquidity_injection"] as const)(
    "preserves a persisted euro denomination through the journaled%s wrapper",
    async (type) => {
      const memory = createInMemoryDb();
      memory.seed("centralBanks", [
        { _id: "UK", countryId: "UK", reserveBalance: 100, netMoneyCreatedLifetime: 0 },
      ]);
      memory.seed("gameConfig", [
        { _id: "default", privateBankingEnabled: true, ledgerShadow: true },
      ]);
      memory.seed("gameState", [{ _id: "current", preset: "1991-default" }]);
      memory.seed("exchangeRates", [{ _id: "UK", currencyCode: "EUR", rate: 1 }]);
      memory.seed("federalBudget", [
        { _id: "UK", countryId: "UK", currencyCode: "EUR", treasuryBalance: 100 },
      ]);
      memory.seed("corporations", [
        {
          _id: new ObjectId(),
          name: "Euro bank",
          bankCharter: {
            status: "active",
            currency: "EUR",
            cashReserves: 0,
            cbMarginDebt: 0,
            totalDeposits: 100,
          },
        },
      ]);
      const command = {
        countryId: "UK",
        type,
        turn: 12,
        actorName: "Chair",
        amount: 25,
        operationId: `euro-${type}`,
      } as const;
      await executeMonetaryOperation(memory as unknown as Db, command);
      if (type === "treasury_advance") {
        expect(memory.collection("federalBudget").docs[0].treasuryBalance).toBe(125);
        const entries = memory.collection("ledgerEntries").docs;
        expect(entries).not.toHaveLength(0);
        for (const entry of entries)
          expect(
            (entry.legs as Array<{ currencyCode: string }>).map((leg) => leg.currencyCode)
          ).toEqual(["EUR", "EUR"]);
      } else {
        expect(
          (memory.collection("corporations").docs[0].bankCharter as BankCharter).cashReserves
        ).toBe(25);
        expect(memory.collection("bankLiquidityOperations").docs[0].currency).toBe("EUR");
      }
      const before = JSON.stringify(
        memory.collection(type === "treasury_advance" ? "federalBudget" : "corporations").docs
      );
      await executeMonetaryOperation(memory as unknown as Db, command);
      expect(
        JSON.stringify(
          memory.collection(type === "treasury_advance" ? "federalBudget" : "corporations").docs
        )
      ).toBe(before);
    }
  );
});
