/** Settle an already reserved construction claim from actual delivered cash. */
import { ObjectId, type Db } from "mongodb";
import type { CorporateSector } from "@/lib/db/types/corporation";
import type { BankLoan } from "@/lib/db/types/bank";
import type { BankingSnapshot, BorrowerSnapshot } from "./rules/boundary";
import { oid } from "./rules/boundary";
import { decideBankCommand } from "./rules/decide";
import { bindConstructionLoanTransition } from "./rules/constructionFinance";
import {
  constructionContributionTransition,
  constructionPaidBuildTransition,
} from "./rules/constructionBuild";
import { settleAtomicDocumentTransition } from "./atomicDocumentSettlement";
import { acquireConstructionLoanLock, releaseConstructionLoanLock } from "./constructionLoanLock";
import {
  acquireConstructionFundingLease,
  releaseConstructionFundingLease,
  abortUnfundedConstruction,
  releaseCompletedConstructionFunding,
} from "./constructionFundingLease";
import { MONEY_MOVE_COLLECTION } from "./moneyMove";
import { settleTransition, resumeSettlement, type SettlementResult } from "./settlementJournal";

const complete = (result: SettlementResult) =>
  !result.error && (result.status === "applied" || result.status === "replayed");

type Result = { ok: true; pending?: boolean } | { ok: false; error: string };

/** The shell is gated before it queries any construction document. */
export async function settleReservedConstruction(input: {
  db: Db;
  enabled: boolean;
  sectorId: ObjectId;
  bank: BankingSnapshot;
  borrower: BorrowerSnapshot;
}): Promise<Result> {
  if (!input.enabled) return { ok: false, error: "Construction finance is not enabled" };
  const { db, sectorId } = input;
  const sectors = db.collection<CorporateSector>("corporateSectors");
  let sector = await sectors.findOne(
    { _id: sectorId },
    { projection: { corporationId: 1, constructionFinancing: 1, buildQueue: 1, forSale: 1 } }
  );
  const claim = sector?.constructionFinancing;
  if (!sector || !claim || !["funding", "building"].includes(claim.status))
    return { ok: false, error: "No approved construction claim is available" };
  if (
    sector.corporationId.toHexString() !== claim.borrowerId ||
    input.borrower.type !== "corporation" ||
    input.borrower.id !== claim.borrowerId ||
    input.bank.bankId !== claim.bankId ||
    input.bank.currency !== claim.currency ||
    !ObjectId.isValid(claim.loanId)
  )
    return { ok: false, error: "Construction claim ownership or currency changed" };
  if (claim.status === "building") {
    return (await releaseCompletedConstructionFunding(db, claim))
      ? { ok: true }
      : { ok: false, error: "The paid construction receipt is pending acknowledgement" };
  }

  const loanId = new ObjectId(claim.loanId);
  const loans = db.collection<BankLoan>("bankLoans");
  const loan = await loans.findOne({ _id: loanId });
  if (
    !loan?.constructionCollateral ||
    loan.constructionCollateral.claimId !== claim.claimId ||
    !loan.constructionCollateral.sectorId.equals(sectorId) ||
    loan.bankCorporationId.toHexString() !== claim.bankId ||
    loan.borrowerId?.toHexString() !== claim.borrowerId ||
    loan.charteredTurn !== claim.charteredTurn
  )
    return { ok: false, error: "The construction loan does not match its frozen claim" };

  const lockKey = `construction:${claim.claimId}:funding`;
  const owned = await acquireConstructionLoanLock(db, loan, lockKey);
  if (!owned) return { ok: false, error: "Another settlement owns construction funding" };
  if (!(await acquireConstructionFundingLease(db, claim))) {
    if (await abortUnfundedConstruction(db, claim, sectorId, input.bank.turn))
      return {
        ok: false,
        error: "Unfunded construction was cancelled and its contribution returned",
      };
    await releaseConstructionLoanLock(db, loan, lockKey);
    return { ok: false, error: "The lender is settling another operation or its charter changed" };
  }
  const fundingKey = `named_loan_disbursement:${claim.bankId}:${claim.loanId}`;
  // An original partial journal owns its quote even if today's bank is no
  // longer eligible. Finish that delivery before evaluating a new command.
  const existing = await db
    .collection<{ _id: string }>(MONEY_MOVE_COLLECTION)
    .findOne({ _id: fundingKey }, { projection: { _id: 1 } });
  if (existing) {
    const resumed = await resumeSettlement(db, fundingKey);
    if (!complete(resumed)) {
      await abortUnfundedConstruction(db, claim, sectorId, input.bank.turn);
      return { ok: false, error: resumed.error ?? "Loan funding is pending" };
    }
  } else if (claim.loanFunded !== true) {
    if (loan.status !== "pending" || loan.constructionDecision !== "approve")
      return { ok: false, error: "Construction is awaiting the lender's decision" };
    if (input.bank.charter?.charteredTurn !== claim.charteredTurn) {
      await abortUnfundedConstruction(db, claim, sectorId, input.bank.turn);
      return { ok: false, error: "The lender charter changed before construction funding" };
    }
    const decision = decideBankCommand(
      input.bank,
      {
        type: "disburse_pending_loan",
        loanId: claim.loanId,
        borrower: input.borrower,
        principal: loan.outstanding,
        originationFee: loan.originationFee ?? 0,
        ratePercent: loan.ratePercent,
        termTurns: loan.termTurns,
      },
      { commandId: claim.loanId }
    );
    if (!decision.allowed) {
      await abortUnfundedConstruction(db, claim, sectorId, input.bank.turn);
      return { ok: false, error: decision.message };
    }
    const contribution = constructionContributionTransition({
      enabled: true,
      sectorId: sectorId.toHexString(),
      turn: input.bank.turn,
      claim,
    });
    if (!contribution.ok) return { ok: false, error: contribution.error };
    let contributed = await settleTransition(db, contribution.value);
    if (
      contributed.status === "partial" ||
      (contributed.status === "replayed" && contributed.error)
    )
      contributed = await resumeSettlement(db, contribution.value.key);
    if (!complete(contributed)) {
      await abortUnfundedConstruction(db, claim, sectorId, input.bank.turn);
      return { ok: false, error: contributed.error ?? "Construction contribution is pending" };
    }

    const funding = bindConstructionLoanTransition({
      transition: decision.transition,
      charteredTurn: claim.charteredTurn,
      claimId: claim.claimId,
      sectorId: sectorId.toHexString(),
      collateralCostLocal: claim.collateralCostLocal,
      constructionCostLocal: claim.constructionCostLocal,
      fundingLeaseLoanId: claim.loanId,
      reserveRatio: input.bank.reserveRatio,
      playerDepositsAreLiabilities: input.bank.playerDepositsAreLiabilities,
    });
    const funded = await settleTransition(db, funding);
    if (!complete(funded)) {
      await abortUnfundedConstruction(db, claim, sectorId, input.bank.turn);
      return { ok: false, error: funded.error ?? "Loan funding is pending" };
    }
  }

  sector = await sectors.findOne(
    { _id: sectorId },
    { projection: { corporationId: 1, constructionFinancing: 1, buildQueue: 1, forSale: 1 } }
  );
  const paidClaim = sector?.constructionFinancing;
  if (!sector || !paidClaim || paidClaim.claimId !== claim.claimId)
    return { ok: false, error: "The reserved construction claim changed" };
  if (paidClaim.status === "building") {
    return (await releaseCompletedConstructionFunding(db, paidClaim))
      ? { ok: true }
      : { ok: false, error: "The paid construction receipt is pending acknowledgement" };
  }
  if (paidClaim.effects && !paidClaim.effectsPaid) {
    let effects = await settleTransition(db, paidClaim.effects.transition);
    if (effects.status === "partial" || (effects.status === "replayed" && effects.error))
      effects = await resumeSettlement(db, paidClaim.effects.transition.key);
    if (!complete(effects))
      return { ok: false, error: effects.error ?? "Construction effects are pending" };
    const delivered = await sectors.findOne(
      { _id: sectorId },
      { projection: { constructionFinancing: 1 } }
    );
    if (
      !delivered?.constructionFinancing ||
      delivered.constructionFinancing.claimId !== claim.claimId
    )
      return { ok: false, error: "Construction effects changed ownership" };
    Object.assign(paidClaim, delivered.constructionFinancing);
  }
  const paid = constructionPaidBuildTransition({
    enabled: true,
    sectorId: sectorId.toHexString(),
    turn: input.bank.turn,
    claim: paidClaim,
    queue: sector.buildQueue ?? [],
  });
  if (!paid.ok) return { ok: false, error: paid.error };
  const appended = await settleAtomicDocumentTransition(db, paid.value.transition, {
    identity: { _id: oid(sectorId.toHexString()) },
    guard: paid.value.guard,
  });
  if (complete(appended)) {
    await releaseConstructionLoanLock(db, loan, lockKey);
    await releaseConstructionFundingLease(db, claim);
  }
  return complete(appended)
    ? { ok: true }
    : { ok: false, error: appended.error ?? "The funded build is awaiting queue settlement" };
}
