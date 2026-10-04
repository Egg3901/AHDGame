import { createHash } from "node:crypto";
import { ObjectId, type Db } from "mongodb";
import type { Corporation, CorporateSector, SectorBuildOrder } from "@/lib/db/types/corporation";
import type { BankLoan } from "@/lib/db/types/bank";
import { loadBankingSnapshot } from "./snapshot";
import { loadBorrowerSnapshot } from "./lending";
import { quoteConstructionFinance } from "./rules/constructionFinance";
import {
  isValidConstructionBuildClaim,
  type ConstructionBuildClaim,
} from "./rules/constructionBuild";
import { settleTransition } from "./settlementJournal";
import { oid } from "./rules/boundary";
import { settleReservedConstruction } from "./constructionSettlement";
import { releaseCompletedConstructionFunding } from "./constructionFundingLease";

export type ConstructionFinanceResult =
  { ok: true; pending: boolean; loanId: string; claimId: string } | { ok: false; error: string };

/** Called after the command has authenticated the borrower and priced its build. */
export async function requestConstructionFinance(input: {
  db: Db;
  enabled: boolean;
  sector: CorporateSector;
  corporation: Corporation;
  bankId: ObjectId;
  requestId: string;
  principal: number;
  termTurns: number;
  constructionCostLocal: number;
  collateralCostLocal: number;
  maximumCostLocal: number;
  order: SectorBuildOrder;
}): Promise<ConstructionFinanceResult> {
  if (!input.enabled) return { ok: false, error: "Construction finance is not enabled" };
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(input.requestId))
    return { ok: false, error: "A valid construction request ID is required" };
  if (
    !Number.isFinite(input.maximumCostLocal) ||
    input.maximumCostLocal < input.constructionCostLocal ||
    (input.sector.buildQueue?.length && input.sector.buildQueue.length >= 20)
  )
    return { ok: false, error: "Construction quote changed or the queue is full" };
  const { db, sector, corporation } = input;
  if (!sector.corporationId.equals(corporation._id) || sector.forSale)
    return { ok: false, error: "The borrower does not own an available construction site" };
  const claimId = `${sector._id.toHexString()}:${input.requestId}`;
  const loanId = new ObjectId(
    createHash("sha256")
      .update(`construction:${corporation._id.toHexString()}:${claimId}`)
      .digest("hex")
      .slice(0, 24)
  );
  const sectors = db.collection<CorporateSector>("corporateSectors");
  const existing = await sectors.findOne(
    { _id: sector._id },
    { projection: { constructionFinancing: 1 } }
  );
  let claim: ConstructionBuildClaim | undefined = existing?.constructionFinancing;
  if (claim && claim.claimId !== claimId && !["released", "cancelled"].includes(claim.status))
    return { ok: false, error: "Repay or cancel the sector's existing construction finance first" };
  if (claim?.claimId !== claimId) {
    const loaded = await loadBankingSnapshot(db, input.bankId);
    if (!loaded?.snapshot.charter || !loaded.corporation.bankCharter)
      return { ok: false, error: "An active lending bank is required" };
    const borrower = await loadBorrowerSnapshot(
      db,
      loaded.corporation.bankCharter,
      loaded.snapshot.currency,
      { type: "corporation", id: corporation._id },
      loaded.snapshot.turn
    );
    if ("error" in borrower) return { ok: false, error: borrower.error };
    const quote = quoteConstructionFinance({
      enabled: true,
      bank: { ...loaded.snapshot, charter: { ...loaded.snapshot.charter, requireApproval: true } },
      borrower: borrower.snapshot,
      loanId: loanId.toHexString(),
      claimId,
      sectorId: sector._id.toHexString(),
      principal: input.principal,
      termTurns: input.termTurns,
      constructionCostLocal: input.constructionCostLocal,
      collateralCostLocal: input.collateralCostLocal,
      borrowerCashLocal: corporation.liquidCapital,
    });
    if (!quote.allowed) return { ok: false, error: quote.error };
    claim = {
      claimId,
      loanId: loanId.toHexString(),
      bankId: input.bankId.toHexString(),
      charteredTurn: loaded.snapshot.charter.charteredTurn,
      borrowerId: corporation._id.toHexString(),
      currency: loaded.snapshot.currency,
      constructionCostLocal: input.constructionCostLocal,
      collateralCostLocal: input.collateralCostLocal,
      borrowerContributionLocal: quote.borrowerContribution,
      principal: quote.principal,
      proceedsLocal: quote.proceeds,
      termTurns: input.termTurns,
      ratePercent: quote.ratePercent,
      order: input.order,
      approvalRequired: loaded.snapshot.charter.requireApproval === true,
      requestTransition: quote.transition,
      status: "awaiting_approval",
      escrowLocal: 0,
    };
    if (!isValidConstructionBuildClaim(claim))
      return { ok: false, error: "Construction quote is incomplete" };
    const reserved = await sectors.updateOne(
      {
        _id: sector._id,
        corporationId: corporation._id,
        forSale: null,
        ...(sector.strategyId
          ? { strategyId: sector.strategyId }
          : {
              $or: [{ strategyId: { $exists: false } }, { strategyId: { $type: "null" } }],
            }),
        $and: [
          {
            $or: [
              { buildQueue: sector.buildQueue ?? [] },
              ...(!sector.buildQueue?.length
                ? [{ buildQueue: { $exists: false } }, { buildQueue: { $type: "null" as const } }]
                : []),
            ],
          },
          {
            $or: [
              { constructionFinancing: { $exists: false } },
              {
                "constructionFinancing.status": { $in: ["released", "cancelled"] },
                "constructionFinancing.escrowLocal": 0,
              },
            ],
          },
        ],
      },
      { $set: { constructionFinancing: claim } }
    );
    if (reserved.matchedCount !== 1)
      return { ok: false, error: "The sector changed while reserving construction finance" };
  }
  if (
    !claim?.requestTransition ||
    claim.bankId !== input.bankId.toHexString() ||
    claim.borrowerId !== corporation._id.toHexString()
  )
    return { ok: false, error: "Construction request does not match its original quote" };
  if (["cancelled", "released"].includes(claim.status))
    return { ok: false, error: "This construction request has ended; use a new request ID" };
  if (claim.status === "building") {
    if (!(await releaseCompletedConstructionFunding(db, claim)))
      return { ok: false, error: "Construction funding is incomplete" };
    return { ok: true, pending: false, loanId: claim.loanId, claimId };
  }
  const requested = await settleTransition(db, claim.requestTransition);
  if (requested.error || !["applied", "replayed"].includes(requested.status))
    return { ok: false, error: requested.error ?? "Construction loan request is pending recovery" };
  if (claim.approvalRequired && claim.status === "awaiting_approval")
    return { ok: true, pending: true, loanId: claim.loanId, claimId };
  return approveConstructionFinance(
    db,
    new ObjectId(claim.bankId),
    new ObjectId(claim.loanId),
    true
  );
}

/** Approval and rejection share an exclusive loan decision before any funding. */
export async function approveConstructionFinance(
  db: Db,
  bankId: ObjectId,
  loanId: ObjectId,
  enabled: boolean
): Promise<ConstructionFinanceResult> {
  if (!enabled) return { ok: false, error: "Construction finance is not enabled" };
  const loans = db.collection<BankLoan>("bankLoans");
  const loan = await loans.findOne({ _id: loanId, bankCorporationId: bankId });
  const collateral = loan?.constructionCollateral;
  if (!loan || !collateral || loan.constructionDecision === "reject")
    return { ok: false, error: "This construction loan is unavailable" };
  const sector = await db
    .collection<CorporateSector>("corporateSectors")
    .findOne({ _id: collateral.sectorId }, { projection: { constructionFinancing: 1 } });
  const claim = sector?.constructionFinancing;
  if (
    !sector ||
    !claim ||
    claim.claimId !== collateral.claimId ||
    claim.bankId !== bankId.toHexString()
  )
    return { ok: false, error: "The construction site no longer has this claim" };
  if (claim.status === "building") {
    if (!(await releaseCompletedConstructionFunding(db, claim)))
      return { ok: false, error: "Construction funding is incomplete" };
    return { ok: true, pending: false, loanId: claim.loanId, claimId: claim.claimId };
  }
  const loaded = await loadBankingSnapshot(db, bankId);
  if (
    !loaded?.corporation.bankCharter ||
    loaded.snapshot.charter?.charteredTurn !== claim.charteredTurn
  )
    return { ok: false, error: "The lender charter changed before construction approval" };
  const borrower = await loadBorrowerSnapshot(
    db,
    loaded.corporation.bankCharter,
    loaded.snapshot.currency,
    { type: "corporation", id: new ObjectId(claim.borrowerId) },
    loaded.snapshot.turn
  );
  if ("error" in borrower) return { ok: false, error: borrower.error };
  if (!loan.constructionDecision) {
    const claimed = await loans.updateOne(
      { _id: loanId, status: "pending", constructionDecision: { $exists: false } },
      { $set: { constructionDecision: "approve" } }
    );
    if (claimed.matchedCount !== 1)
      return { ok: false, error: "Another construction loan decision already owns this request" };
  }
  await db.collection<CorporateSector>("corporateSectors").updateOne(
    {
      _id: sector._id,
      "constructionFinancing.claimId": claim.claimId,
      "constructionFinancing.status": "awaiting_approval",
    },
    { $set: { "constructionFinancing.status": "funding" } }
  );
  const result = await settleReservedConstruction({
    db,
    enabled: true,
    sectorId: sector._id,
    bank: loaded.snapshot,
    borrower: borrower.snapshot,
  });
  return result.ok
    ? { ok: true, pending: false, loanId: claim.loanId, claimId: claim.claimId }
    : result;
}

/** A rejection can release only an unfunded claim, after owning the loan decision. */
export async function rejectConstructionFinance(
  db: Db,
  bankId: ObjectId,
  loanId: ObjectId,
  enabled: boolean,
  reason?: string
): Promise<ConstructionFinanceResult> {
  if (!enabled) return { ok: false, error: "Construction finance is not enabled" };
  const loans = db.collection<BankLoan>("bankLoans");
  const loan = await loans.findOne({ _id: loanId, bankCorporationId: bankId });
  const collateral = loan?.constructionCollateral;
  if (!loan || !collateral || loan.constructionDecision === "approve")
    return { ok: false, error: "Construction approval already owns this request" };
  if (!loan.constructionDecision) {
    const owned = await loans.updateOne(
      {
        _id: loanId,
        bankCorporationId: bankId,
        status: "pending",
        constructionDecision: { $exists: false },
      },
      { $set: { constructionDecision: "reject" } }
    );
    if (owned.matchedCount !== 1)
      return { ok: false, error: "Another construction decision owns this request" };
  }
  const sector = await db
    .collection<CorporateSector>("corporateSectors")
    .findOne({ _id: collateral.sectorId }, { projection: { constructionFinancing: 1 } });
  const claim = sector?.constructionFinancing;
  if (!claim || claim.claimId !== collateral.claimId || claim.bankId !== bankId.toHexString())
    return { ok: false, error: "The construction site no longer has this claim" };
  if (claim.status === "cancelled" && loan.status === "rejected")
    return { ok: true, pending: false, loanId: claim.loanId, claimId: claim.claimId };
  if (
    claim.status !== "awaiting_approval" ||
    claim.escrowLocal !== 0 ||
    claim.loanFunded ||
    claim.borrowerContributionPaid
  )
    return { ok: false, error: "Funded construction cannot be rejected" };
  const settled = await settleTransition(db, {
    key: `construction:${claim.claimId}:reject`,
    kind: "construction_rejected",
    turn: claim.order.startTurn,
    currency: claim.currency,
    legs: [],
    projections: [
      {
        collection: "bankLoans",
        filter: {
          _id: oid(loanId.toHexString()),
          status: "pending",
          constructionDecision: "reject",
        },
        update: {
          $set: {
            status: "rejected",
            decisionTurn: claim.order.startTurn,
            rejectedReason: (reason ?? "").trim().slice(0, 280),
          },
        },
        note: "Reject the unfunded construction loan",
      },
      {
        collection: "corporateSectors",
        filter: {
          _id: oid(collateral.sectorId.toHexString()),
          "constructionFinancing.claimId": claim.claimId,
          "constructionFinancing.status": "awaiting_approval",
          "constructionFinancing.escrowLocal": 0,
        },
        update: { $set: { "constructionFinancing.status": "cancelled" } },
        note: "Release the unfunded construction site",
      },
    ],
    event: { kind: "loan.rejected", command: "construction.reject", subjectId: claim.loanId },
  });
  return !settled.error && ["applied", "replayed"].includes(settled.status)
    ? { ok: true, pending: false, loanId: claim.loanId, claimId: claim.claimId }
    : { ok: false, error: settled.error ?? "Construction rejection is pending recovery" };
}
