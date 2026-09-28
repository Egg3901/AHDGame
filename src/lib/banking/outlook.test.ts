import type { Db } from "mongodb";
import { describe, expect, it } from "vitest";
import type { BankCharter } from "@/lib/db/types/bank";
import { bankBalanceSheet } from "@/lib/banking/rules/balanceSheet";
import { buildBankOutlook } from "./outlook";

const CORP_ID = "corp1";

function stubDb(): Db {
  return {
    collection: (name: string) => {
      if (name === "centralBanks") {
        return {
          findOne: async () => ({
            primeRate: 4,
            inflationHistory: [{ rate: 1 }],
            externalBroadMoney: 100_000_000,
            chairInfamy: 0,
          }),
        };
      }
      if (name === "corporations") {
        return {
          find: () => ({
            toArray: async () => [
              { _id: CORP_ID, bankCharter: { type: "retail", depositOffset: -1 } },
            ],
          }),
        };
      }
      // gameConfig (central-bank pricing phase-in): absent means inactive.
      return { findOne: async () => null };
    },
  } as unknown as Db;
}

function charter(overrides: Partial<BankCharter> = {}): BankCharter {
  return {
    type: "retail",
    status: "active",
    currency: "USD",
    charteredTurn: 1,
    postedCapital: 1_000_000,
    depositOffset: -1,
    lendingOffset: 2,
    totalDeposits: 1_000_000,
    totalLoans: 2_000_000,
    npcDeposits: 1_000_000,
    playerDeposits: 0,
    cashReserves: 500_000,
    requiredReserves: 100_000,
    lendingProfile: "balanced",
    discountWindowDebt: 0,
    cbMarginDebt: 0,
    propBookMarkValue: 0,
    panicTurns: 0,
    warningBand: "green",
    ...overrides,
  } as unknown as BankCharter;
}

describe("buildBankOutlook", () => {
  it("projects deposit inflow when the bank beats the central-bank savings rate", async () => {
    // Funded and capitalised: room under the ceiling and base left to lend.
    const ch = charter({ cashReserves: 2_000_000, totalLoans: 500_000 });
    const sheet = bankBalanceSheet({
      charter: ch,
      reserveRatio: 0.1,
      capacityCeiling: 50_000_000,
    });
    const outlook = await buildBankOutlook(stubDb(), {
      corporationIdHex: CORP_ID,
      charter: ch,
      currency: "USD",
      currentTurn: 100,
      reserveRatio: 0.1,
      rates: { depositRatePercent: 3, lendingRatePercent: 6 },
      sheet,
      loans: [],
      interbankLoans: [],
      weakestTermLever: null,
      currentBand: "green",
      playerDepositsAreLiabilities: false,
    });

    expect(outlook).not.toBeNull();
    // Deposit rate 3 beats the CB savings APY, so households flow in, capped
    // at 2.5% of the target per turn by the same rule the turn enforces.
    expect(outlook!.depositDirection).toBe("in");
    expect(outlook!.depositFlow).toBeGreaterThan(0);
    expect(outlook!.newLoanDemand).toBeGreaterThan(0);
    expect(outlook!.stancePreview).toHaveLength(3);
    expect(outlook!.netInterestMarginPercent).not.toBeNull();
    expect(outlook!.costOfFundsPercent).not.toBeNull();
    expect(outlook!.recommendationKind).toBe("none");
  });

  it("recommends posting capital in plain words when below the 8% minimum", async () => {
    const ch = charter({ cashReserves: 50_000 });
    const sheet = bankBalanceSheet({
      charter: ch,
      reserveRatio: 0.1,
      capacityCeiling: 50_000_000,
    });
    const outlook = await buildBankOutlook(stubDb(), {
      corporationIdHex: CORP_ID,
      charter: ch,
      currency: "USD",
      currentTurn: 100,
      reserveRatio: 0.1,
      rates: { depositRatePercent: 3, lendingRatePercent: 6 },
      sheet,
      loans: [],
      interbankLoans: [],
      weakestTermLever: null,
      currentBand: "green",
      playerDepositsAreLiabilities: false,
    });

    expect(outlook!.recommendationKind).toBe("capital");
    expect(outlook!.recommendation).toMatch(/8% minimum/);
    expect(outlook!.recommendation).toMatch(/12-turn \(about 12-hour\)/);
  });
});
