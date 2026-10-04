import type { SectorBuildOrder } from "@/lib/db/types/corporation";
import { oid, type BankingTransition } from "./boundary";
import { CAPACITY_BUILD_CANCEL_REFUND } from "@/lib/constants/capacityEconomy";

export interface ConstructionBuildEffects {
  transition: BankingTransition;
  feeLocal: number;
  pool?: {
    id: string;
    bucket: import("@/lib/market/unownedPoolDraw").UnownedPoolBucket;
    eraUnitScale: number;
    /** Market-entry share claimed; absent on older claims where all order units were drawn. */
    units?: number;
  };
  quotedAt: Date;
}

/** A frozen, single-build claim. Only the settlement shell constructs this quote. */
export interface ConstructionBuildClaim {
  claimId: string;
  loanId: string;
  bankId: string;
  charteredTurn: number;
  borrowerId: string;
  currency: string;
  constructionCostLocal: number;
  collateralCostLocal: number;
  borrowerContributionLocal: number;
  principal: number;
  proceedsLocal: number;
  termTurns: number;
  ratePercent: number;
  /** Freeze the lender's approval policy and its noncash request before publication. */
  approvalRequired?: boolean;
  requestTransition?: BankingTransition;
  effects?: ConstructionBuildEffects;
  effectsPaid?: boolean;
  order: SectorBuildOrder;
  status: "awaiting_approval" | "funding" | "building" | "released" | "cancelled";
  escrowLocal: number;
  borrowerContributionPaid?: boolean;
  loanFunded?: boolean;
  admissionToken?: string;
  /** Written after the paid receipt and both funding leases are released. */
  fundingCleanupCompleted?: boolean;
  /** Default keeps the pledge in force until an actual funded recovery. */
  defaultedTurn?: number;
  /** The paid build's contractual refund stays pledged until its principal is settled. */
  cancellation?: import("./constructionRecovery").ConstructionCancellationQuote;
  sale?: import("./constructionSale").ConstructionSaleQuote;
  foreclosure?: { turn: number };
}

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export function isValidConstructionBuildClaim(claim: ConstructionBuildClaim): boolean {
  return (
    [claim.claimId, claim.loanId, claim.bankId, claim.borrowerId, claim.currency].every(
      (id) => typeof id === "string" && id.length > 0
    ) &&
    [
      claim.constructionCostLocal,
      claim.collateralCostLocal,
      claim.borrowerContributionLocal,
      claim.principal,
      claim.proceedsLocal,
      claim.escrowLocal,
    ].every((value) => Number.isFinite(value) && value >= 0) &&
    claim.constructionCostLocal > 0 &&
    claim.collateralCostLocal <= claim.constructionCostLocal &&
    claim.principal > 0 &&
    claim.principal <= claim.collateralCostLocal * CAPACITY_BUILD_CANCEL_REFUND &&
    Number.isSafeInteger(claim.termTurns) &&
    claim.termTurns >= 4 &&
    claim.termTurns <= 120 &&
    Number.isFinite(claim.ratePercent) &&
    claim.ratePercent >= 0 &&
    claim.proceedsLocal <= claim.principal &&
    Math.abs(claim.borrowerContributionLocal + claim.proceedsLocal - claim.constructionCostLocal) <
      1e-6 &&
    Number.isSafeInteger(claim.charteredTurn) &&
    claim.charteredTurn >= 0 &&
    Number.isSafeInteger(claim.order.unitsOrdered) &&
    claim.order.unitsOrdered > 0 &&
    Number.isFinite(claim.order.costPaidAnchor) &&
    claim.order.costPaidAnchor > 0 &&
    Number.isSafeInteger(claim.order.startTurn) &&
    Number.isSafeInteger(claim.order.onlineTurn) &&
    claim.order.onlineTurn > claim.order.startTurn
  );
}

/** Move the borrower's contribution before asking the lender to fund the remainder. */
export function constructionContributionTransition(input: {
  enabled: boolean;
  sectorId: string;
  turn: number;
  claim: ConstructionBuildClaim;
}): Result<BankingTransition> {
  const { claim, sectorId, turn } = input;
  if (!input.enabled || !isValidConstructionBuildClaim(claim) || claim.status !== "funding")
    return { ok: false, error: "Construction funding is unavailable" };
  const amount = claim.borrowerContributionLocal;
  if (amount <= 0) return { ok: false, error: "Construction contribution must be positive" };
  const identity = { _id: oid(sectorId) };
  return {
    ok: true,
    value: {
      key: `construction:${claim.claimId}:contribution`,
      kind: "construction_contribution",
      turn,
      currency: claim.currency,
      legs: [
        {
          kind: "debit",
          collection: "corporations",
          filter: { _id: oid(claim.borrowerId), liquidCapital: { $gte: amount } },
          path: "liquidCapital",
          amount,
          note: "Fund the borrower's frozen construction contribution",
        },
        {
          kind: "credit",
          collection: "corporateSectors",
          filter: {
            ...identity,
            corporationId: oid(claim.borrowerId),
            "constructionFinancing.claimId": claim.claimId,
            "constructionFinancing.status": "funding",
          },
          path: "constructionFinancing.escrowLocal",
          amount,
          note: "Hold contributed cash for this build only",
        },
      ],
      projections: [
        {
          collection: "corporateSectors",
          filter: { ...identity, "constructionFinancing.claimId": claim.claimId },
          update: { $set: { "constructionFinancing.borrowerContributionPaid": true } },
          note: "Publish the delivered contribution",
        },
      ],
      event: {
        kind: "loan.disbursed",
        command: "construction.contribute",
        subjectId: claim.loanId,
      },
    },
  };
}

/** Cash consumption and the paid queue append belong to one sector document write. */
export function constructionPaidBuildTransition(input: {
  enabled: boolean;
  sectorId: string;
  turn: number;
  claim: ConstructionBuildClaim;
  queue: readonly SectorBuildOrder[];
}): Result<{ transition: BankingTransition; guard: Record<string, unknown> }> {
  const { claim, sectorId, turn } = input;
  const capex = claim.effects ? claim.collateralCostLocal : claim.constructionCostLocal;
  if (
    !input.enabled ||
    !isValidConstructionBuildClaim(claim) ||
    claim.status !== "funding" ||
    claim.borrowerContributionPaid !== true ||
    claim.loanFunded !== true ||
    (claim.effects &&
      (claim.effectsPaid !== true ||
        !Number.isFinite(claim.effects.feeLocal) ||
        claim.effects.feeLocal < 0 ||
        Math.abs(claim.effects.feeLocal + claim.collateralCostLocal - claim.constructionCostLocal) >
          1e-6)) ||
    claim.escrowLocal < capex ||
    input.queue.length >= 20
  )
    return { ok: false, error: "Construction is not fully funded or the queue is full" };
  const identity = { _id: oid(sectorId) };
  // Funding can complete after CEO approval. Start the delivery window at the
  // actual paid queue append, keeping the quoted construction duration.
  const order: SectorBuildOrder = {
    ...claim.order,
    startTurn: turn,
    onlineTurn: turn + claim.order.onlineTurn - claim.order.startTurn,
    constructionLoanId: claim.loanId,
    constructionClaimId: claim.claimId,
  };
  return {
    ok: true,
    value: {
      guard: {
        corporationId: oid(claim.borrowerId),
        forSale: null,
        "constructionFinancing.claimId": claim.claimId,
        "constructionFinancing.status": "funding",
        "constructionFinancing.borrowerContributionPaid": true,
        "constructionFinancing.loanFunded": true,
        "constructionFinancing.escrowLocal": { $gte: capex },
        ...(claim.effects ? { "constructionFinancing.effectsPaid": true } : {}),
        $or: [
          { buildQueue: [...input.queue] },
          ...(input.queue.length ? [] : [{ buildQueue: null }]),
        ],
      },
      transition: {
        key: `construction:${claim.claimId}:paid:${turn}`,
        kind: "construction_paid_build",
        turn,
        currency: claim.currency,
        legs: [
          {
            kind: "debit",
            collection: "corporateSectors",
            filter: identity,
            path: "constructionFinancing.escrowLocal",
            amount: capex,
            note: "Spend only delivered construction cash",
          },
          { kind: "burn", amount: capex, note: "Paid construction capex" },
        ],
        projections: [
          {
            collection: "corporateSectors",
            filter: identity,
            update: {
              $inc: { "constructionFinancing.escrowLocal": -capex },
              $set: {
                buildQueue: [...input.queue, order],
                "constructionFinancing.status": "building",
                "constructionFinancing.order": order,
              },
            },
            note: "Publish the paid order in the same write as its escrow debit",
          },
        ],
        event: { kind: "loan.disbursed", command: "construction.build", subjectId: claim.loanId },
      },
    },
  };
}
