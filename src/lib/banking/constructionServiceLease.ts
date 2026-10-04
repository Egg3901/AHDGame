/** Hold the lender's epoch while a construction instalment is in flight. */
import { ObjectId, type Db } from "mongodb";
import type { BankLoan } from "@/lib/db/types/bank";
import type { Corporation, CorporateSector } from "@/lib/db/types/corporation";
import { MONEY_MOVE_COLLECTION } from "./moneyMove";
import { resumeSettlement } from "./settlementJournal";

export async function acquireConstructionServiceLease(
  db: Db,
  loan: BankLoan,
  key: string,
  turn: number,
  kind: "servicing" | "recovery" = "servicing"
): Promise<boolean> {
  if (!loan.constructionCollateral || loan.charteredTurn === undefined) return false;
  const corporations = db.collection<Corporation>("corporations");
  const identity = {
    _id: loan.bankCorporationId,
    "bankCharter.charteredTurn": loan.charteredTurn,
  };
  const acquired = await corporations.updateOne(
    {
      ...identity,
      "bankCharter.status": { $in: ["active", "failed"] },
      "bankCharter.resolutionClaimedTurn": { $exists: false },
      "bankCharter.depositorsResolvedTurn": { $exists: false },
      bankConstructionFunding: { $exists: false },
      bankPrimaryFunding: { $exists: false },
      bankCharterTransfer: { $exists: false },
    },
    {
      $set: {
        bankConstructionFunding: {
          kind,
          loanId: String(loan._id),
          charteredTurn: loan.charteredTurn,
          disbursed: true,
          service: {
            key,
            turn,
            ...(kind === "recovery"
              ? { sectorId: String(loan.constructionCollateral.sectorId) }
              : {}),
          },
        },
      },
    }
  );
  if (acquired.matchedCount === 1) return true;
  return (
    (await corporations.findOne(
      {
        ...identity,
        "bankConstructionFunding.kind": kind,
        "bankConstructionFunding.loanId": String(loan._id),
        "bankConstructionFunding.service.key": key,
      },
      { projection: { _id: 1 } }
    )) !== null
  );
}

export async function releaseConstructionServiceLease(
  db: Db,
  bankId: ObjectId,
  loanId: ObjectId,
  key: string,
  kind: "servicing" | "recovery" = "servicing"
): Promise<void> {
  await db.collection<Corporation>("corporations").updateOne(
    {
      _id: bankId,
      "bankConstructionFunding.kind": kind,
      "bankConstructionFunding.loanId": String(loanId),
      "bankConstructionFunding.service.key": key,
    },
    { $unset: { bankConstructionFunding: "" } }
  );
  await db
    .collection<BankLoan>("bankLoans")
    .updateOne(
      { _id: loanId, constructionSettlementOwner: key },
      { $unset: { constructionSettlementOwner: "" } }
    );
}

/** Includes a crash after application but before admission cleanup. */
export async function recoverConstructionServiceLeases(
  db: Db,
  turn: number
): Promise<Array<{ key: string; error: string }>> {
  const banks = await db
    .collection<Corporation>("corporations")
    .find(
      {
        "bankConstructionFunding.kind": { $in: ["servicing", "recovery"] },
        "bankConstructionFunding.service.turn": { $lt: turn },
      },
      { projection: { bankConstructionFunding: 1 } }
    )
    .limit(200)
    .toArray();
  const unfinished: Array<{ key: string; error: string }> = [];
  for (const bank of banks) {
    const lease = bank.bankConstructionFunding;
    if (!lease?.service || !ObjectId.isValid(lease.loanId)) continue;
    const key = lease.service.key;
    if (lease.kind === "recovery") {
      if (!lease.service.sectorId || !ObjectId.isValid(lease.service.sectorId)) {
        unfinished.push({
          key,
          error: "The construction recovery lease has no valid property identity",
        });
        continue;
      }
      const sector = await db
        .collection<CorporateSector>("corporateSectors")
        .findOne(
          { _id: new ObjectId(lease.service.sectorId) },
          { projection: { constructionFinancing: 1 } }
        );
      const quote = sector?.constructionFinancing?.cancellation;
      if (quote && `${quote.key}:payout` === key && !quote.aborted) {
        // The property quote owns refund recovery, including a crash before
        // it claimed either cash receipt. Never turn it into an ordinary
        // instalment merely because its first journal is still absent.
        continue;
      }
      const sale = sector?.constructionFinancing?.sale;
      if (sale?.transition.key === key && !sale.aborted) continue;
      await releaseConstructionServiceLease(
        db,
        bank._id,
        new ObjectId(lease.loanId),
        key,
        "recovery"
      );
      await db.collection<BankLoan>("bankLoans").updateOne(
        {
          _id: new ObjectId(lease.loanId),
          constructionSettlementOwner: key.slice(0, -":payout".length),
        },
        { $unset: { constructionSettlementOwner: "" } }
      );
      continue;
    }
    const record = await db
      .collection<{ _id: string }>(MONEY_MOVE_COLLECTION)
      .findOne({ _id: key }, { projection: { _id: 1 } });
    if (record) {
      const result = await resumeSettlement(db, key);
      const complete = !result.error && ["applied", "replayed"].includes(result.status);
      const unfunded =
        result.status === "rejected" &&
        result.appliedLegs.length === 0 &&
        result.appliedProjections.length === 0;
      if (!complete && !unfunded) {
        unfinished.push({ key, error: result.error ?? `settlement ${result.status}` });
        continue;
      }
    }
    // An earlier-turn admission with no journal never took borrower cash.
    await releaseConstructionServiceLease(db, bank._id, new ObjectId(lease.loanId), key);
  }
  return unfinished;
}
