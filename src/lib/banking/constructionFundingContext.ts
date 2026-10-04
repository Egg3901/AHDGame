import type { ObjectId } from "mongodb";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { Corporation } from "@/lib/db/types/corporation";
import type { BankingPolicySnapshot } from "@/lib/banking/rules/policy";
import { isNamedLendingCharter } from "@/lib/banking/charterKinds";
import type { BankingSnapshot, BorrowerSnapshot } from "@/lib/banking/rules/boundary";

/** The only bank document fields a construction request needs after batch load. */
export type ConstructionFundingBankCorporation = Pick<Corporation, "_id" | "bankCharter">;

/** One selected lender and borrower pair from the NPP shell's cohort preload. */
export interface PreloadedConstructionFundingContext {
  bankSnapshot: BankingSnapshot;
  bankCorporation: ConstructionFundingBankCorporation;
  borrowerSnapshot: BorrowerSnapshot;
  turn: number;
  policy: BankingPolicySnapshot;
}

export interface ConstructionFundingContextExpectation {
  bankId: ObjectId;
  borrowerId: ObjectId;
  borrowerCurrency: CurrencyCode | null | undefined;
}

/** Validate batch data before quoting; settlement still guards the live bank epoch and cash. */
export function validatePreloadedConstructionFundingContext(
  context: PreloadedConstructionFundingContext,
  expected: ConstructionFundingContextExpectation
): string | null {
  const { bankSnapshot, bankCorporation, borrowerSnapshot, policy, turn } = context;
  const bankId = expected.bankId.toHexString();
  const borrowerId = expected.borrowerId.toHexString();
  const charter = bankCorporation.bankCharter;
  const snapshotCharter = bankSnapshot.charter;

  if (!Number.isSafeInteger(turn) || turn < 0 || bankSnapshot.turn !== turn)
    return "Preloaded construction funding turn is stale";
  if (
    !bankCorporation._id.equals(expected.bankId) ||
    bankSnapshot.bankId !== bankId ||
    borrowerSnapshot.type !== "corporation" ||
    borrowerSnapshot.id !== borrowerId
  )
    return "Preloaded construction funding identities do not match the request";
  if (!charter || !snapshotCharter || !isNamedLendingCharter(charter))
    return "Preloaded lender does not have an active lending charter";
  if (
    charter.status !== "active" ||
    snapshotCharter.status !== "active" ||
    charter.charteredTurn !== snapshotCharter.charteredTurn ||
    snapshotCharter.currency !== charter.currency ||
    bankSnapshot.currency !== charter.currency
  )
    return "Preloaded lender charter snapshot is inconsistent";
  if (
    !expected.borrowerCurrency ||
    bankSnapshot.currency !== expected.borrowerCurrency ||
    borrowerSnapshot.currencyMatches !== true
  )
    return "Preloaded lender currency does not match the borrower treasury";
  if (
    policy.privateBanking !== true ||
    policy.treasuryCashLedger !== true ||
    policy.constructionFinance !== true ||
    bankSnapshot.policy.privateBanking !== true ||
    bankSnapshot.policy.treasuryCashLedger !== true ||
    bankSnapshot.policy.constructionFinance !== true
  )
    return "Construction funding prerequisites are not enabled";

  return null;
}
