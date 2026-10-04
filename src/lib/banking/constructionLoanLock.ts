/** Coordinate construction servicing, cancellation and sales before quoting debt. */
import type { Db } from "mongodb";
import type { BankLoan } from "@/lib/db/types/bank";
import type { CorporateSector } from "@/lib/db/types/corporation";
import { releaseConstructionFundingLease } from "./constructionFundingLease";
import { resumeSettlement } from "./settlementJournal";

export async function releaseConstructionLoanLock(
  db: Db,
  loan: BankLoan,
  key: string
): Promise<void> {
  if (!loan.constructionCollateral) return;
  await db
    .collection<BankLoan>("bankLoans")
    .updateOne(
      { _id: loan._id, constructionSettlementOwner: key },
      { $unset: { constructionSettlementOwner: "" } }
    );
}

/** A different service receipt can be recovered, but an unfinished build stays owned. */
export async function acquireConstructionLoanLock(
  db: Db,
  loan: BankLoan,
  key: string
): Promise<BankLoan | null> {
  if (!loan.constructionCollateral) return loan;
  const loans = db.collection<BankLoan>("bankLoans");
  const acquire = () =>
    loans.findOneAndUpdate(
      {
        _id: loan._id,
        $or: [
          { constructionSettlementOwner: { $exists: false } },
          { constructionSettlementOwner: key },
        ],
      },
      { $set: { constructionSettlementOwner: key } },
      { returnDocument: "after" }
    );
  const owned = await acquire();
  if (owned) return owned;
  const current = await loans.findOne({ _id: loan._id });
  const previous = current?.constructionSettlementOwner;
  if (!current || !previous) return null;
  const collateral = current.constructionCollateral;
  if (collateral && previous === `construction:${collateral.claimId}:funding`) {
    const sector = await db
      .collection<CorporateSector>("corporateSectors")
      .findOne({ _id: collateral.sectorId }, { projection: { constructionFinancing: 1 } });
    const claim = sector?.constructionFinancing;
    if (
      claim?.claimId !== collateral.claimId ||
      claim.loanId !== String(current._id) ||
      claim.bankId !== String(current.bankCorporationId) ||
      claim.charteredTurn !== current.charteredTurn ||
      claim.status !== "building" ||
      !claim.loanFunded ||
      !claim.borrowerContributionPaid ||
      claim.escrowLocal !== 0 ||
      !["current", "arrears"].includes(current.status)
    )
      return null;
    await releaseConstructionFundingLease(db, claim);
    await releaseConstructionLoanLock(db, current, previous);
    return acquire();
  }
  if (!previous.startsWith(`loan-service:${loan._id}:`)) return null;
  const record = await db
    .collection<{ _id: string }>("bankMoneyMoves")
    .findOne({ _id: previous }, { projection: { _id: 1 } });
  if (!record) return null;
  const recovered = await resumeSettlement(db, previous);
  const complete = !recovered.error && ["applied", "replayed"].includes(recovered.status);
  const unfunded =
    recovered.status === "rejected" &&
    recovered.appliedLegs.length === 0 &&
    recovered.appliedProjections.length === 0;
  if (!complete && !unfunded) return null;
  await releaseConstructionLoanLock(db, current, previous);
  return acquire();
}
