/** A contractual cancellation refund pays secured principal before owner cash. */
import { ObjectId, type Db } from "mongodb";
import type { BankLoan } from "@/lib/db/types/bank";
import type { Corporation, CorporateSector } from "@/lib/db/types/corporation";
import { ensureFund } from "./insurance";
import { acquireConstructionLoanLock, releaseConstructionLoanLock } from "./constructionLoanLock";
import {
  acquireConstructionServiceLease,
  releaseConstructionServiceLease,
} from "./constructionServiceLease";
import { settleAtomicDocumentTransition } from "./atomicDocumentSettlement";
import { settleTransition, resumeSettlement, type SettlementResult } from "./settlementJournal";
import { oid } from "./rules/boundary";
import {
  quoteConstructionCancellation,
  cancellationRefundTransition,
  cancellationPayoutTransition,
  type ConstructionCancellationQuote,
} from "./rules/constructionRecovery";

const complete = (result: SettlementResult) =>
  !result.error && ["applied", "replayed"].includes(result.status);
type Result =
  | { ok: true; refunded: number; principalRepaid: number; ownerRefund: number }
  | { ok: false; error: string };

/** Existing receipts keep their quote across turn, exchange-rate and charter changes. */
export async function cancelFinancedConstruction(input: {
  db: Db;
  enabled: boolean;
  sectorId: ObjectId;
  borrowerId: ObjectId;
  turn: number;
}): Promise<Result> {
  if (!input.enabled) return { ok: false, error: "Construction finance is not enabled" };
  const { db, sectorId, borrowerId, turn } = input;
  const sectors = db.collection<CorporateSector>("corporateSectors");
  const sector = await sectors.findOne({ _id: sectorId, corporationId: borrowerId });
  let claim = sector?.constructionFinancing;
  if (
    !sector ||
    !claim ||
    sector.forSale != null ||
    !ObjectId.isValid(claim.loanId) ||
    claim.borrowerId !== String(borrowerId)
  )
    return { ok: false, error: "No matching financed build exists" };
  if (claim.cancellation?.aborted) {
    if (claim.cancellation.turn >= turn)
      return {
        ok: false,
        error: "The queue changed during cancellation; retry after the next turn",
      };
    const cleared = await sectors.updateOne(
      {
        _id: sectorId,
        "constructionFinancing.cancellation.key": claim.cancellation.key,
        "constructionFinancing.cancellation.aborted": true,
      },
      { $unset: { "constructionFinancing.cancellation": "" } }
    );
    if (cleared.matchedCount !== 1) return { ok: false, error: "Cancellation recovery changed" };
    claim = { ...claim, cancellation: undefined };
  }
  const loan = await db
    .collection<BankLoan>("bankLoans")
    .findOne({ _id: new ObjectId(claim.loanId) });
  if (
    !loan?.constructionCollateral ||
    loan.constructionCollateral.claimId !== claim.claimId ||
    !loan.constructionCollateral.sectorId.equals(sectorId) ||
    String(loan.bankCorporationId) !== claim.bankId ||
    String(loan.borrowerId) !== claim.borrowerId ||
    loan.charteredTurn !== claim.charteredTurn ||
    loan.currency !== claim.currency
  )
    return { ok: false, error: "The pledged build and loan identities disagree" };
  const key = claim.cancellation?.key ?? `construction:${claim.claimId}:cancel:${turn}`;
  const cleanup = async () => {
    if (claim.cancellation?.destination === "bank")
      await releaseConstructionServiceLease(
        db,
        loan.bankCorporationId,
        loan._id,
        `${key}:payout`,
        "recovery"
      );
    await releaseConstructionLoanLock(db, loan, key);
    await sectors.updateOne(
      {
        _id: sectorId,
        "constructionFinancing.cancellation.key": key,
        "constructionFinancing.cancellation.completed": true,
      },
      { $set: { "constructionFinancing.cancellation.cleanupCompleted": true } }
    );
  };
  if (claim.cancellation?.completed) {
    await cleanup();
    return successful(claim.cancellation);
  }
  const owned = await acquireConstructionLoanLock(db, loan, key);
  if (!owned) return { ok: false, error: "Another receipt owns the construction loan" };
  let quote = claim.cancellation;
  if (!quote) {
    const bank = await db
      .collection<Corporation>("corporations")
      .findOne({ _id: loan.bankCorporationId }, { projection: { bankCharter: 1 } });
    const charter = bank?.bankCharter;
    const liveEpoch =
      charter?.charteredTurn === claim.charteredTurn &&
      ["active", "failed"].includes(charter.status) &&
      charter.depositorsResolvedTurn == null;
    const candidate = quoteConstructionCancellation({
      claim,
      loan: owned,
      queue: sector.buildQueue ?? [],
      turn,
      destination: liveEpoch ? "bank" : "insurance",
      now: new Date(),
    });
    if (!candidate) {
      await releaseConstructionLoanLock(db, loan, key);
      return { ok: false, error: "The financed build has no refundable undelivered capacity" };
    }
    if (
      liveEpoch &&
      !(await acquireConstructionServiceLease(db, loan, `${key}:payout`, turn, "recovery"))
    ) {
      await releaseConstructionLoanLock(db, loan, key);
      return { ok: false, error: "The lender's original epoch is settling another operation" };
    }
    const frozen = await sectors.updateOne(
      {
        _id: sectorId,
        corporationId: borrowerId,
        "constructionFinancing.claimId": claim.claimId,
        "constructionFinancing.cancellation": { $exists: false },
        buildQueue: candidate.queueBefore,
      },
      { $set: { "constructionFinancing.cancellation": candidate } }
    );
    if (frozen.matchedCount !== 1) {
      if (liveEpoch)
        await releaseConstructionServiceLease(
          db,
          loan.bankCorporationId,
          loan._id,
          `${key}:payout`,
          "recovery"
        );
      await releaseConstructionLoanLock(db, loan, key);
      return { ok: false, error: "The build queue changed before cancellation was reserved" };
    }
    quote = candidate;
  } else if (
    quote.destination === "bank" &&
    !(await acquireConstructionServiceLease(db, loan, `${key}:payout`, quote.turn, "recovery"))
  ) {
    return { ok: false, error: "The original lender recovery remains owned" };
  }
  if (quote.destination === "insurance") await ensureFund(db, loan.currency);
  const refund = cancellationRefundTransition(claim, quote, String(sectorId));
  const minted = await settleAtomicDocumentTransition(db, refund, {
    identity: { _id: oid(String(sectorId)) },
    guard: {
      corporationId: borrowerId,
      buildQueue: quote.queueBefore,
      "constructionFinancing.claimId": claim.claimId,
      "constructionFinancing.escrowLocal": 0,
      "constructionFinancing.cancellation.key": key,
    },
  });
  if (!complete(minted)) {
    // A refused queue CAS delivered no refund. Release admission without
    // repricing or reopening that rejected receipt; a later attempt gets its
    // own turn key and a fresh, smaller undelivered-capacity quote.
    if (
      minted.status === "rejected" &&
      minted.appliedLegs.length === 0 &&
      minted.appliedProjections.length === 0
    ) {
      await sectors.updateOne(
        { _id: sectorId, "constructionFinancing.cancellation.key": key },
        {
          $set: {
            "constructionFinancing.cancellation.aborted": true,
            "constructionFinancing.cancellation.cleanupCompleted": true,
          },
        }
      );
      if (quote.destination === "bank")
        await releaseConstructionServiceLease(
          db,
          loan.bankCorporationId,
          loan._id,
          `${key}:payout`,
          "recovery"
        );
      await releaseConstructionLoanLock(db, loan, key);
    }
    return { ok: false, error: minted.error ?? "Cancellation refund is pending" };
  }
  const payout = cancellationPayoutTransition(claim, quote, String(sectorId), owned);
  let paid = await settleTransition(db, payout);
  if (paid.status === "partial" || (paid.status === "replayed" && paid.error))
    paid = await resumeSettlement(db, payout.key);
  if (!complete(paid))
    return { ok: false, error: paid.error ?? "Principal-first refund delivery is pending" };
  if (quote.destination === "bank")
    await releaseConstructionServiceLease(
      db,
      loan.bankCorporationId,
      loan._id,
      payout.key,
      "recovery"
    );
  await releaseConstructionLoanLock(db, loan, key);
  await sectors.updateOne(
    {
      _id: sectorId,
      "constructionFinancing.cancellation.key": key,
      "constructionFinancing.cancellation.completed": true,
    },
    { $set: { "constructionFinancing.cancellation.cleanupCompleted": true } }
  );
  return successful(quote);
}

const successful = (quote: ConstructionCancellationQuote): Result => ({
  ok: true,
  refunded: quote.refundLocal,
  principalRepaid: quote.repayPrincipal,
  ownerRefund: quote.ownerRefund,
});

/** Recover frozen cancellation quotes, including a crash before their first receipt. */
export async function recoverConstructionCancellations(
  db: Db,
  turn: number
): Promise<Array<{ key: string; error: string }>> {
  const sectors = await db
    .collection<CorporateSector>("corporateSectors")
    .find(
      {
        "constructionFinancing.cancellation.turn": { $lt: turn },
        "constructionFinancing.cancellation.cleanupCompleted": { $ne: true },
      },
      { projection: { corporationId: 1, constructionFinancing: 1 } }
    )
    .limit(200)
    .toArray();
  const unfinished: Array<{ key: string; error: string }> = [];
  for (const sector of sectors) {
    const result = await cancelFinancedConstruction({
      db,
      enabled: true,
      sectorId: sector._id,
      borrowerId: sector.corporationId,
      turn,
    });
    if (!result.ok)
      unfinished.push({
        key: sector.constructionFinancing!.cancellation!.key,
        error: result.error,
      });
  }
  return unfinished;
}
