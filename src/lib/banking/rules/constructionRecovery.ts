import type { BankLoan } from "@/lib/db/types/bank";
import type { SectorBuildOrder } from "@/lib/db/types/corporation";
import { deliveredFraction } from "@/lib/corporations/buildDelivery";
import { CAPACITY_BUILD_CANCEL_REFUND } from "@/lib/constants/capacityEconomy";
import { allocateConstructionCancellation } from "./constructionFinance";
import { oid, type BankingTransition, type TransitionProjection } from "./boundary";
import type { ConstructionBuildClaim } from "./constructionBuild";

export interface ConstructionCancellationQuote {
  key: string;
  turn: number;
  queueBefore: SectorBuildOrder[];
  queueAfter: SectorBuildOrder[];
  refundLocal: number;
  repayPrincipal: number;
  ownerRefund: number;
  previousOutstanding: number;
  nextOutstanding: number;
  nextStatus: BankLoan["status"];
  bookDelta: number;
  destination: "bank" | "insurance";
  completed?: boolean;
  cleanupCompleted?: boolean;
  aborted?: boolean;
}

/** Refund only the undelivered book cost in its original native currency. */
export function quoteConstructionCancellation(input: {
  claim: ConstructionBuildClaim;
  loan: BankLoan;
  queue: readonly SectorBuildOrder[];
  turn: number;
  destination: ConstructionCancellationQuote["destination"];
}): ConstructionCancellationQuote | null {
  const { claim, loan, queue, turn } = input;
  const orderIndex = queue.findIndex(
    (order) =>
      order.constructionClaimId === claim.claimId && order.constructionLoanId === claim.loanId
  );
  if (
    orderIndex < 0 ||
    claim.status !== "building" ||
    claim.escrowLocal !== 0 ||
    !claim.loanFunded ||
    !claim.borrowerContributionPaid ||
    !Number.isSafeInteger(turn) ||
    !Number.isFinite(claim.collateralCostLocal) ||
    claim.collateralCostLocal <= 0 ||
    !Number.isFinite(loan.outstanding) ||
    loan.outstanding < 0 ||
    !["current", "arrears", "defaulted", "repaid"].includes(loan.status)
  )
    return null;
  const refundLocal =
    claim.collateralCostLocal *
    (1 - deliveredFraction(queue[orderIndex], turn)) *
    CAPACITY_BUILD_CANCEL_REFUND;
  if (!Number.isFinite(refundLocal) || refundLocal <= 0) return null;
  const { repayPrincipal, ownerRefund } = allocateConstructionCancellation(
    refundLocal,
    loan.outstanding
  );
  const nextOutstanding = Math.max(0, loan.outstanding - repayPrincipal);
  return {
    key: `construction:${claim.claimId}:cancel:${turn}`,
    turn,
    queueBefore: [...queue],
    queueAfter: queue.filter((_, index) => index !== orderIndex),
    refundLocal,
    repayPrincipal,
    ownerRefund,
    previousOutstanding: loan.outstanding,
    nextOutstanding,
    nextStatus: nextOutstanding === 0 ? "repaid" : loan.status,
    bookDelta: ["current", "arrears"].includes(loan.status) ? -repayPrincipal : 0,
    destination: input.destination,
  };
}

export function cancellationRefundTransition(
  claim: ConstructionBuildClaim,
  quote: ConstructionCancellationQuote,
  sectorId: string
): BankingTransition {
  const identity = { _id: oid(String(sectorId)) };
  return {
    key: `${quote.key}:refund`,
    kind: "construction_contract_refund",
    turn: quote.turn,
    currency: claim.currency,
    legs: [
      {
        kind: "mint",
        amount: quote.refundLocal,
        note: "Reverse the refundable portion of paid undelivered construction capex",
      },
      {
        kind: "credit",
        amount: quote.refundLocal,
        collection: "corporateSectors",
        filter: identity,
        path: "constructionFinancing.escrowLocal",
        note: "Keep the contractual refund pledged until principal settlement",
      },
    ],
    projections: [
      {
        collection: "corporateSectors",
        filter: identity,
        update: {
          $inc: { "constructionFinancing.escrowLocal": quote.refundLocal },
          $set: { buildQueue: quote.queueAfter },
        },
        note: "Remove only the quoted build in the same write as its cash refund",
      },
    ],
    event: { kind: "loan.paid", command: "construction.cancel.refund", subjectId: claim.loanId },
  };
}

export function cancellationPayoutTransition(
  claim: ConstructionBuildClaim,
  quote: ConstructionCancellationQuote,
  sectorId: string,
  loan: BankLoan
): BankingTransition {
  const sectorIdentity = {
    _id: oid(String(sectorId)),
    "constructionFinancing.claimId": claim.claimId,
  };
  const bankIdentity = {
    _id: oid(claim.bankId),
    "bankCharter.charteredTurn": claim.charteredTurn,
    "bankConstructionFunding.kind": "recovery",
    "bankConstructionFunding.service.key": `${quote.key}:payout`,
  };
  const projections: TransitionProjection[] = [
    {
      collection: "bankLoans",
      filter: {
        _id: oid(claim.loanId),
        constructionSettlementOwner: quote.key,
        outstanding: quote.previousOutstanding,
      },
      update: {
        $set: { outstanding: quote.nextOutstanding, status: quote.nextStatus },
        $inc: { collateralRecoveredLocal: quote.repayPrincipal },
      },
      note: "Retire secured principal only after the actual refund reaches its creditor",
    },
  ];
  if (quote.destination === "bank" && quote.bookDelta !== 0)
    projections.push({
      collection: "corporations",
      filter: bankIdentity,
      update: { $inc: { "bankCharter.totalLoans": quote.bookDelta } },
      note: "Reduce the original lender's live loan book by funded principal recovery",
    });
  projections.push({
    collection: "corporateSectors",
    filter: { ...sectorIdentity, "constructionFinancing.escrowLocal": 0 },
    update: {
      $set: {
        "constructionFinancing.cancellation.completed": true,
        ...(quote.nextOutstanding === 0 ? { "constructionFinancing.status": "released" } : {}),
      },
    },
    note: "Release the completed cancellation refund; remaining principal retains the site's pledge",
  });
  return {
    key: `${quote.key}:payout`,
    kind: "construction_principal_first_refund",
    turn: quote.turn,
    currency: loan.currency,
    legs: [
      {
        kind: "debit",
        amount: quote.refundLocal,
        collection: "corporateSectors",
        filter: sectorIdentity,
        path: "constructionFinancing.escrowLocal",
        note: "Distribute only the delivered contractual refund",
      },
      ...(quote.repayPrincipal > 0
        ? [
            {
              kind: "credit" as const,
              amount: quote.repayPrincipal,
              collection: quote.destination === "bank" ? "corporations" : "depositInsuranceFunds",
              filter: quote.destination === "bank" ? bankIdentity : { _id: loan.currency },
              path: quote.destination === "bank" ? "bankCharter.cashReserves" : "balance",
              note: "Principal recovery belongs to the original lender or its subrogated insurer",
            },
          ]
        : []),
      ...(quote.ownerRefund > 0
        ? [
            {
              kind: "credit" as const,
              amount: quote.ownerRefund,
              collection: "corporations",
              filter: { _id: oid(claim.borrowerId) },
              path: "liquidCapital",
              note: "Return only the cash remaining after secured principal",
            },
          ]
        : []),
    ],
    projections,
    event: {
      kind: "loan.paid",
      command: "construction.cancel.payout",
      subjectId: claim.loanId,
      meta: { principalRecovered: quote.repayPrincipal, ownerRefund: quote.ownerRefund },
    },
  };
}
