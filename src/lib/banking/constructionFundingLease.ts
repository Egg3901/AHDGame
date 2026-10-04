/** A bank cannot replace or resolve the epoch behind an unfinished construction debit. */
import { ObjectId, type Db } from "mongodb";
import type { Corporation } from "@/lib/db/types/corporation";
import type { ConstructionBuildClaim } from "./rules/constructionBuild";
import type { BankLoan } from "@/lib/db/types/bank";
import type { CorporateSector } from "@/lib/db/types/corporation";
import { oid } from "./rules/boundary";
import { releaseConstructionAdmission } from "./constructionAdmission";
import { MONEY_MOVE_COLLECTION } from "./moneyMove";
import { resumeSettlement, settleTransition } from "./settlementJournal";

export async function acquireConstructionFundingLease(
  db: Db,
  claim: ConstructionBuildClaim
): Promise<boolean> {
  const corporations = db.collection<Corporation>("corporations");
  const bankId = new ObjectId(claim.bankId);
  const acquired = await corporations.updateOne(
    {
      _id: bankId,
      "bankCharter.charteredTurn": claim.charteredTurn,
      "bankCharter.status": "active",
      "bankCharter.resolutionClaimedTurn": { $exists: false },
      bankConstructionFunding: { $exists: false },
      bankPrimaryFunding: { $exists: false },
      bankCharterTransfer: { $exists: false },
    },
    {
      $set: {
        bankConstructionFunding: {
          loanId: claim.loanId,
          charteredTurn: claim.charteredTurn,
          kind: "funding",
          disbursed: false,
        },
      },
    }
  );
  if (acquired.matchedCount === 1) return true;
  const current = await corporations.findOne(
    { _id: bankId },
    { projection: { bankConstructionFunding: 1, "bankCharter.charteredTurn": 1 } }
  );
  return (
    current?.bankConstructionFunding?.loanId === claim.loanId &&
    current.bankConstructionFunding.charteredTurn === claim.charteredTurn &&
    current.bankConstructionFunding.kind === "funding" &&
    current.bankCharter?.charteredTurn === claim.charteredTurn
  );
}

/** Abort can win only before the bank's atomic debit marks delivery. */
export async function abortUnfundedConstruction(
  db: Db,
  claim: ConstructionBuildClaim,
  sectorId: ObjectId,
  turn: number
): Promise<boolean> {
  const corporations = db.collection<Corporation>("corporations");
  const identity = {
    _id: new ObjectId(claim.bankId),
    "bankConstructionFunding.loanId": claim.loanId,
    "bankConstructionFunding.charteredTurn": claim.charteredTurn,
    "bankConstructionFunding.disbursed": false,
  };
  const owned = await corporations.updateOne(
    { ...identity, "bankConstructionFunding.kind": "funding" },
    { $set: { "bankConstructionFunding.kind": "aborting" } }
  );
  if (owned.matchedCount !== 1) {
    const previous = await corporations.findOne(
      { ...identity, "bankConstructionFunding.kind": "aborting" },
      { projection: { _id: 1 } }
    );
    if (!previous) return false;
  }
  // A contribution that stopped between debit and escrow credit must finish
  // under its original quote before any refund can be calculated.
  const contributionKey = `construction:${claim.claimId}:contribution`;
  const contribution = await db
    .collection<{ _id: string }>(MONEY_MOVE_COLLECTION)
    .findOne({ _id: contributionKey }, { projection: { _id: 1 } });
  if (contribution) {
    const recovered = await resumeSettlement(db, contributionKey);
    const unfunded =
      recovered.status === "rejected" &&
      recovered.appliedLegs.length === 0 &&
      recovered.appliedProjections.length === 0;
    if (!unfunded && (recovered.error || !["applied", "replayed"].includes(recovered.status)))
      return false;
  }
  const sector = await db
    .collection<CorporateSector>("corporateSectors")
    .findOne({ _id: sectorId }, { projection: { constructionFinancing: 1 } });
  const current = sector?.constructionFinancing;
  if (!current || current.claimId !== claim.claimId || current.loanFunded) return false;
  if (!Number.isFinite(current.escrowLocal) || current.escrowLocal < 0) return false;
  const refund = current.escrowLocal;
  if (refund > claim.borrowerContributionLocal) return false;
  const result = await settleTransition(db, {
    key: `construction:${claim.claimId}:abort`,
    kind: "construction_funding_aborted",
    turn,
    currency: claim.currency,
    legs:
      refund > 0
        ? [
            {
              kind: "debit",
              amount: refund,
              collection: "corporateSectors",
              filter: {
                _id: oid(String(sectorId)),
                "constructionFinancing.claimId": claim.claimId,
              },
              path: "constructionFinancing.escrowLocal",
              note: "Return only delivered borrower contribution",
            },
            {
              kind: "credit",
              amount: refund,
              collection: "corporations",
              filter: { _id: oid(claim.borrowerId) },
              path: "liquidCapital",
              note: "Release the borrower contribution after unfunded construction abort",
            },
          ]
        : [],
    projections: [
      {
        collection: "bankLoans",
        filter: { _id: oid(claim.loanId), status: "pending" },
        update: {
          $set: {
            status: "rejected",
            rejectedReason: "Construction funding aborted",
            decisionTurn: turn,
          },
        },
        note: "Reject the construction loan that delivered no bank cash",
      },
      {
        collection: "corporateSectors",
        filter: {
          _id: oid(String(sectorId)),
          "constructionFinancing.claimId": claim.claimId,
          "constructionFinancing.escrowLocal": 0,
        },
        update: { $set: { "constructionFinancing.status": "cancelled" } },
        note: "Release construction only after the funded contribution is returned",
      },
    ],
    event: { kind: "loan.rejected", command: "construction.abort", subjectId: claim.loanId },
  });
  if (result.error || !["applied", "replayed"].includes(result.status)) return false;
  await corporations.updateOne(
    { ...identity, "bankConstructionFunding.kind": "aborting" },
    { $unset: { bankConstructionFunding: "" } }
  );
  await db.collection<BankLoan>("bankLoans").updateOne(
    {
      _id: new ObjectId(claim.loanId),
      constructionSettlementOwner: `construction:${claim.claimId}:funding`,
    },
    { $unset: { constructionSettlementOwner: "" } }
  );
  await releaseConstructionAdmission(db, claim.admissionToken);
  return true;
}

export async function releaseConstructionFundingLease(
  db: Db,
  claim: ConstructionBuildClaim
): Promise<void> {
  await db.collection<Corporation>("corporations").updateOne(
    {
      _id: new ObjectId(claim.bankId),
      "bankConstructionFunding.loanId": claim.loanId,
      "bankConstructionFunding.charteredTurn": claim.charteredTurn,
      "bankConstructionFunding.kind": "funding",
    },
    { $unset: { bankConstructionFunding: "" } }
  );
}

/** A committed paid queue can finish admission cleanup after any crash. */
export async function releaseCompletedConstructionFunding(
  db: Db,
  claim: ConstructionBuildClaim
): Promise<boolean> {
  if (
    claim.status !== "building" ||
    !claim.loanFunded ||
    !claim.borrowerContributionPaid ||
    claim.escrowLocal !== 0 ||
    !claim.order ||
    !Number.isSafeInteger(claim.order.startTurn)
  )
    return false;
  // Paid queue publication can precede acknowledgement of its atomic receipt.
  // Finish that original receipt before another recovery may change the queue.
  const paidKey = `construction:${claim.claimId}:paid:${claim.order.startTurn}`;
  const paidJournal = await db
    .collection<{ _id: string }>(MONEY_MOVE_COLLECTION)
    .findOne({ _id: paidKey }, { projection: { _id: 1 } });
  if (paidJournal) {
    const paid = await resumeSettlement(db, paidKey);
    if (paid.error || !["applied", "replayed"].includes(paid.status)) return false;
  }
  if (claim.effects && !claim.effectsPaid) return false;
  await releaseConstructionFundingLease(db, claim);
  await db.collection<BankLoan>("bankLoans").updateOne(
    {
      _id: new ObjectId(claim.loanId),
      constructionSettlementOwner: `construction:${claim.claimId}:funding`,
    },
    { $unset: { constructionSettlementOwner: "" } }
  );
  await db.collection<CorporateSector>("corporateSectors").updateOne(
    {
      "constructionFinancing.claimId": claim.claimId,
      "constructionFinancing.loanId": claim.loanId,
      "constructionFinancing.status": "building",
      "constructionFinancing.escrowLocal": 0,
    },
    { $set: { "constructionFinancing.fundingCleanupCompleted": true } }
  );
  await releaseConstructionAdmission(db, claim.admissionToken);
  return true;
}
