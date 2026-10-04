import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { BankingSnapshot, BorrowerSnapshot } from "./rules/boundary";
import { BANKING_POLICY_ALL_ON } from "./rules/policy";
import {
  validatePreloadedConstructionFundingContext,
  type PreloadedConstructionFundingContext,
} from "./constructionFundingContext";

const bankId = new ObjectId();
const borrowerId = new ObjectId();
const charter = {
  type: "retail" as const,
  status: "active" as const,
  currency: "USD" as CurrencyCode,
  charteredTurn: 7,
  postedCapital: 1_000_000,
  cashReserves: 2_000_000,
  npcDeposits: 1_000_000,
  totalDeposits: 1_000_000,
  totalLoans: 0,
  depositOffset: 0,
  lendingOffset: 0,
  requireApproval: false,
};

function context(): PreloadedConstructionFundingContext {
  const bankSnapshot: BankingSnapshot = {
    turn: 19,
    policy: BANKING_POLICY_ALL_ON,
    bankId: bankId.toHexString(),
    currency: "USD",
    charter: { ...charter },
    corporationLiquidCapital: 0,
    reserveRatio: 0.2,
    playerDepositsAreLiabilities: false,
    primeRate: 3,
    centralBankId: "US",
  };
  const borrowerSnapshot: BorrowerSnapshot = {
    type: "corporation",
    id: borrowerId.toHexString(),
    incomePerTurn: 100_000,
    committedPaymentPerTurn: 0,
    blocked: false,
    currencyMatches: true,
  };
  return {
    bankSnapshot,
    bankCorporation: {
      _id: bankId,
      bankCharter: { ...charter },
    },
    borrowerSnapshot,
    turn: 19,
    policy: BANKING_POLICY_ALL_ON,
  };
}

describe("preloaded construction funding context", () => {
  it("accepts a current, same-currency active lending snapshot", () => {
    expect(
      validatePreloadedConstructionFundingContext(context(), {
        bankId,
        borrowerId,
        borrowerCurrency: "USD",
      })
    ).toBeNull();
  });

  it.each([
    ["different lender id", { bankId: new ObjectId() }],
    ["different borrower id", { borrowerId: new ObjectId() }],
    ["different native currency", { borrowerCurrency: "EUR" as CurrencyCode }],
  ])("rejects a context with %s", (_label, expectedOverrides) => {
    expect(
      validatePreloadedConstructionFundingContext(context(), {
        bankId,
        borrowerId,
        borrowerCurrency: "USD",
        ...expectedOverrides,
      })
    ).toBeTruthy();
  });

  it("rejects a context whose turn or charter epoch is stale", () => {
    const staleTurn = context();
    staleTurn.turn = 18;
    expect(
      validatePreloadedConstructionFundingContext(staleTurn, {
        bankId,
        borrowerId,
        borrowerCurrency: "USD",
      })
    ).toBeTruthy();

    const staleCharter = context();
    staleCharter.bankCorporation.bankCharter!.charteredTurn = 8;
    expect(
      validatePreloadedConstructionFundingContext(staleCharter, {
        bankId,
        borrowerId,
        borrowerCurrency: "USD",
      })
    ).toBeTruthy();
  });

  it("fails closed unless all three funding prerequisites are enabled", () => {
    const value = context();
    value.policy = { ...BANKING_POLICY_ALL_ON, treasuryCashLedger: false };
    expect(
      validatePreloadedConstructionFundingContext(value, {
        bankId,
        borrowerId,
        borrowerCurrency: "USD",
      })
    ).toBeTruthy();
  });
});
