import type { BankLoan } from "@/lib/db/types/bank";
import type { ConstructionBuildClaim } from "./constructionBuild";
import { oid, type BankingTransition, type TransitionLeg } from "./boundary";

export interface ConstructionSaleQuote {
  key: string;
  turn: number;
  buyerId: string;
  priceAnchor: number;
  buyerCurrency: string;
  buyerCostLocal: number;
  saleLocal: number;
  principalRepaid: number;
  ownerProceeds: number;
  destination: "bank" | "insurance";
  fundingTransition: BankingTransition;
  transition: BankingTransition;
  completed?: boolean;
  cleanupCompleted?: boolean;
  aborted?: boolean;
}

/** A sale distributes actual buyer cash before title or loan security changes. */
export function quoteConstructionSale(input: {
  claim: ConstructionBuildClaim;
  loan: BankLoan;
  sectorId: string;
  buyerId: string;
  buyerCurrency: string;
  buyerRate: number;
  creditorRate: number;
  priceAnchor: number;
  feeLocal: number;
  feeLegs: readonly TransitionLeg[];
  turn: number;
  destination: "bank" | "insurance";
}): ConstructionSaleQuote | null {
  const { claim, loan, turn, priceAnchor, buyerRate, creditorRate, feeLocal } = input;
  if (
    !["building", "released"].includes(claim.status) ||
    !claim.loanFunded ||
    !claim.borrowerContributionPaid ||
    claim.escrowLocal !== 0 ||
    (claim.cancellation && !claim.cancellation.cleanupCompleted) ||
    !["current", "arrears", "defaulted", "repaid"].includes(loan.status) ||
    !Number.isFinite(loan.outstanding) ||
    loan.outstanding < 0 ||
    (claim.status === "released" && (loan.status !== "repaid" || loan.outstanding !== 0)) ||
    ![priceAnchor, buyerRate, creditorRate].every((value) => Number.isFinite(value) && value > 0) ||
    !Number.isFinite(feeLocal) ||
    feeLocal < 0 ||
    !Number.isSafeInteger(turn) ||
    turn < 0 ||
    input.buyerId === claim.borrowerId
  )
    return null;
  const saleLocal = priceAnchor * creditorRate;
  const principalRepaid = Math.min(saleLocal, loan.outstanding);
  const ownerProceeds = saleLocal - principalRepaid;
  const nextOutstanding = loan.outstanding - principalRepaid;
  const key = `construction:${claim.claimId}:sale:${turn}:${input.buyerId}`;
  const sectorIdentity = {
    _id: oid(input.sectorId),
    "constructionFinancing.claimId": claim.claimId,
    "constructionFinancing.sale.key": key,
  };
  const bankIdentity = {
    _id: oid(claim.bankId),
    "bankCharter.charteredTurn": claim.charteredTurn,
    "bankConstructionFunding.kind": "recovery",
    "bankConstructionFunding.service.key": `${key}:payout`,
  };
  const valuation = { currencyCode: claim.currency, localPerAnchor: creditorRate };
  const buyerValuation = { currencyCode: input.buyerCurrency, localPerAnchor: buyerRate };
  const buyerCostLocal = priceAnchor * buyerRate + feeLocal;
  if (![saleLocal, buyerCostLocal].every((value) => Number.isFinite(value) && value > 0))
    return null;
  const transition: BankingTransition = {
    key: `${key}:payout`,
    kind: "construction_secured_sale",
    turn,
    currency: claim.currency,
    projections: [],
    event: {
      kind: "loan.paid",
      command: "construction.property.sale.funding",
      subjectId: claim.loanId,
    },
    legs: [
      {
        kind: "debit",
        amount: buyerCostLocal,
        valuation: buyerValuation,
        collection: "corporations",
        filter: { _id: oid(input.buyerId), liquidCapital: { $gte: buyerCostLocal } },
        path: "liquidCapital",
        note: "Fund the pledged property purchase from actual buyer cash",
      },
      {
        kind: "credit",
        amount: saleLocal,
        valuation,
        collection: "corporateSectors",
        filter: sectorIdentity,
        path: "constructionFinancing.escrowLocal",
        note: "Hold buyer proceeds for the original secured creditor",
      },
      ...input.feeLegs,
    ],
  };
  const fundingTransition = transition;
  const payoutTransition: BankingTransition = {
    key: `${key}:payout`,
    kind: "construction_secured_sale",
    turn,
    currency: claim.currency,
    legs: [
      {
        kind: "debit",
        amount: saleLocal,
        valuation,
        collection: "corporateSectors",
        filter: sectorIdentity,
        path: "constructionFinancing.escrowLocal",
        note: "Distribute only delivered buyer proceeds",
      },
      ...(principalRepaid > 0
        ? [
            {
              kind: "credit" as const,
              amount: principalRepaid,
              valuation,
              collection: input.destination === "bank" ? "corporations" : "depositInsuranceFunds",
              filter: input.destination === "bank" ? bankIdentity : { _id: claim.currency },
              path: input.destination === "bank" ? "bankCharter.cashReserves" : "balance",
              note: "Secured principal reaches the original lender or subrogated insurer first",
            },
          ]
        : []),
      ...(ownerProceeds > 0
        ? [
            {
              kind: "credit" as const,
              amount: ownerProceeds,
              valuation,
              collection: "corporations",
              filter: { _id: oid(claim.borrowerId) },
              path: "liquidCapital",
              note: "Release the seller proceeds remaining after secured principal",
            },
          ]
        : []),
    ],
    projections: [
      {
        collection: "bankLoans",
        filter: {
          _id: oid(claim.loanId),
          constructionSettlementOwner: key,
          outstanding: loan.outstanding,
        },
        update: {
          $set: {
            outstanding: nextOutstanding,
            status: nextOutstanding === 0 ? "repaid" : loan.status,
          },
          $inc: { collateralRecoveredLocal: principalRepaid },
        },
        note: "Release the sold security after funded recovery; any residual debt stays with the seller",
      },
      ...(input.destination === "bank" && ["current", "arrears"].includes(loan.status)
        ? [
            {
              collection: "corporations",
              filter: bankIdentity,
              update: { $inc: { "bankCharter.totalLoans": -principalRepaid } },
              note: "Reduce only the original epoch's principal still carried in its loan book",
            },
          ]
        : []),
      {
        collection: "corporateSectors",
        filter: {
          ...sectorIdentity,
          corporationId: oid(claim.borrowerId),
          "constructionPropertyTransition.key": key,
          "constructionFinancing.escrowLocal": 0,
        },
        update: {
          $set: {
            corporationId: oid(input.buyerId),
            "constructionFinancing.status": "released",
            "constructionFinancing.sale.completed": true,
          },
          $unset: { forSale: "" },
        },
        note: "Deliver property title after funded creditor and owner proceeds",
      },
      {
        collection: "corporateSectors",
        filter: { ...sectorIdentity, corporationId: oid(input.buyerId) },
        pipelineUpdate: [
          {
            $set: {
              buildQueue: {
                $map: {
                  input: { $ifNull: ["$buildQueue", []] },
                  as: "order",
                  in: {
                    $cond: [
                      {
                        $and: [
                          { $eq: ["$$order.constructionClaimId", { $literal: claim.claimId }] },
                          { $eq: ["$$order.constructionLoanId", { $literal: claim.loanId }] },
                        ],
                      },
                      {
                        $unsetField: {
                          field: "constructionClaimId",
                          input: {
                            $unsetField: { field: "constructionLoanId", input: "$$order" },
                          },
                        },
                      },
                      "$$order",
                    ],
                  },
                },
              },
            },
          },
        ],
        note: "The buyer receives paid construction without the seller's released loan claim",
      },
      {
        collection: "bankLoans",
        filter: { _id: oid(claim.loanId), constructionSettlementOwner: key },
        update: { $unset: { constructionCollateral: "" } },
        note: "Release the security only after the funded buyer has property title",
      },
    ],
    event: {
      kind: "loan.paid",
      command: "construction.property.sale",
      subjectId: claim.loanId,
      meta: { buyerId: input.buyerId, priceAnchor, principalRepaid, ownerProceeds },
    },
  };
  return {
    key,
    turn,
    buyerId: input.buyerId,
    priceAnchor,
    buyerCurrency: input.buyerCurrency,
    buyerCostLocal,
    saleLocal,
    principalRepaid,
    ownerProceeds,
    destination: input.destination,
    fundingTransition: {
      ...fundingTransition,
      key: `${key}:funding`,
      kind: "construction_secured_sale_funding",
    },
    transition: payoutTransition,
  };
}
