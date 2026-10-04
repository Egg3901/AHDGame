/**
 * Construction loans fund a specific paid build, with the new capacity pledged
 * to its lender. quoteConstructionFinance keeps the existing loan affordability
 * rules and limits principal to the build's refundable construction basis.
 */
import { CAPACITY_BUILD_CANCEL_REFUND } from "@/lib/constants/capacityEconomy";
import { decideBankCommand } from "./decide";
import { quoteLoanOrigination } from "./loanFees";
import {
  oid,
  type BankingSnapshot,
  type BankingTransition,
  type BorrowerSnapshot,
} from "./boundary";

export interface ConstructionFinanceQuoteInput {
  enabled: boolean;
  bank: BankingSnapshot;
  borrower: BorrowerSnapshot;
  loanId: string;
  claimId: string;
  sectorId: string;
  constructionCostLocal: number;
  /** Quoted book cost of the new capacity, excluding FX and transaction fees. */
  collateralCostLocal: number;
  borrowerCashLocal: number;
  principal: number;
  termTurns: number;
}

export type ConstructionFinanceQuote =
  | { allowed: false; error: string }
  | {
      allowed: true;
      pending: boolean;
      principal: number;
      proceeds: number;
      originationFee: number;
      borrowerContribution: number;
      collateralLimit: number;
      ratePercent: number;
      transition: BankingTransition;
    };

/** Reuse the existing underwriting rules; loan proceeds never enter free borrower cash. */
export function quoteConstructionFinance(
  input: ConstructionFinanceQuoteInput
): ConstructionFinanceQuote {
  if (!input.enabled) return { allowed: false, error: "Construction finance is not enabled" };
  const positive = (value: number) => Number.isFinite(value) && value > 0;
  if (input.borrower.type !== "corporation")
    return { allowed: false, error: "Construction finance requires a corporate borrower" };
  if (
    !positive(input.constructionCostLocal) ||
    !positive(input.collateralCostLocal) ||
    input.collateralCostLocal > input.constructionCostLocal ||
    !positive(input.principal) ||
    !Number.isFinite(input.borrowerCashLocal) ||
    input.borrowerCashLocal < 0
  )
    return { allowed: false, error: "Construction quote is unavailable" };
  const collateralLimit = input.collateralCostLocal * CAPACITY_BUILD_CANCEL_REFUND;
  if (input.principal > collateralLimit)
    return { allowed: false, error: "Principal exceeds the construction collateral limit" };
  const quote = quoteLoanOrigination(input.principal, input.bank.currency);
  const borrowerContribution = input.constructionCostLocal - quote.proceeds;
  if (borrowerContribution > input.borrowerCashLocal)
    return { allowed: false, error: "Borrower cash does not cover its construction contribution" };
  const decision = decideBankCommand(
    input.bank,
    {
      type: "originate_named_loan",
      loanId: input.loanId,
      borrower: input.borrower,
      principal: input.principal,
      termTurns: input.termTurns,
    },
    { commandId: input.loanId }
  );
  if (!decision.allowed) return { allowed: false, error: decision.message };
  const pending = decision.derived?.pending === true;
  const ratePercent = decision.derived?.ratePercent;
  if (typeof ratePercent !== "number" || !Number.isFinite(ratePercent))
    return { allowed: false, error: "Loan quote is unavailable" };
  const transition: BankingTransition = {
    ...decision.transition,
    legs: decision.transition.legs.map((leg) =>
      leg.kind === "credit" && leg.collection === "corporations" && leg.path === "liquidCapital"
        ? {
            ...leg,
            collection: "corporateSectors",
            filter: { _id: oid(input.sectorId), "constructionFinancing.claimId": input.claimId },
            path: "constructionFinancing.escrowLocal",
            note: "Fund the quoted construction escrow, not borrower spending cash",
          }
        : leg
    ),
    projections: decision.transition.projections.map((projection) =>
      projection.collection === "bankLoans" && projection.insert
        ? {
            ...projection,
            insert: {
              ...projection.insert,
              constructionCollateral: {
                claimId: input.claimId,
                sectorId: oid(input.sectorId),
                quotedCostLocal: input.collateralCostLocal,
                constructionCostLocal: input.constructionCostLocal,
              },
            },
          }
        : projection
    ),
  };
  return {
    allowed: true,
    pending,
    principal: quote.principal,
    proceeds: quote.proceeds,
    originationFee: quote.originationFee,
    borrowerContribution,
    collateralLimit,
    ratePercent,
    transition,
  };
}

/** Refunds first retire principal; only the remainder becomes unencumbered owner cash. */
export function allocateConstructionCancellation(
  refundLocal: number,
  outstandingPrincipal: number
): {
  repayPrincipal: number;
  ownerRefund: number;
} {
  const finite = (amount: number) => (Number.isFinite(amount) ? Math.max(0, amount) : 0);
  const refund = finite(refundLocal);
  const repayPrincipal = Math.min(refund, finite(outstandingPrincipal));
  return { repayPrincipal, ownerRefund: refund - repayPrincipal };
}
