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
});
