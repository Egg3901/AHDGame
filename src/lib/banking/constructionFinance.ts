import { createHash, randomUUID } from "node:crypto";
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
import { prepareConstructionBuildEffects } from "./constructionBuildEffects";
import type { UnownedPoolBucket } from "@/lib/market/unownedPoolDraw";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { BankingSnapshot, BorrowerSnapshot } from "./rules/boundary";
import type { BankingPolicySnapshot } from "./rules/policy";
import {
  validatePreloadedConstructionFundingContext,
  type PreloadedConstructionFundingContext,
} from "./constructionFundingContext";
import { resolveCorpLiquidCurrencyCode } from "@/lib/currency/corporationCapital";
import { releaseCompletedConstructionFunding } from "./constructionFundingLease";
import {
  acquireConstructionAdmission,
  releaseConstructionAdmission,
} from "./constructionAdmission";
import { unprotectedConstructionPropertyFilter } from "./rules/constructionProperty";

export type {
  ConstructionFundingBankCorporation,
  PreloadedConstructionFundingContext,
} from "./constructionFundingContext";

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
  maximumRatePercent?: number;
  order: SectorBuildOrder;
  /** A selected pair from the NPP turn's batched lender and borrower reads. */
  preloadedFundingContext?: PreloadedConstructionFundingContext;
  buildContext?: {
    destinationCurrency: CurrencyCode | null;
    bucket: UnownedPoolBucket;
    eraUnitScale: number;
  };
}): Promise<ConstructionFinanceResult> {
  if (!input.enabled) return { ok: false, error: "Construction finance is not enabled" };
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(input.requestId))
    return { ok: false, error: "A valid construction request ID is required" };
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
    if (
      !Number.isFinite(input.maximumCostLocal) ||
      input.maximumCostLocal < input.constructionCostLocal
    )
      return { ok: false, error: "Construction quote changed or the queue is full" };
    const previousClaimId = claim?.claimId;
    if (
      previousClaimId &&
      (sector.buildQueue ?? []).some((order) => order.constructionClaimId === previousClaimId)
    )
      return {
        ok: false,
        error: "Finish or cancel the previous financed build before financing another",
      };
    if ((sector.buildQueue?.length ?? 0) >= 20)
      return { ok: false, error: "The construction queue is full" };
    let bankSnapshot: BankingSnapshot;
    let bankCorporation: Pick<Corporation, "_id" | "bankCharter">;
    let borrowerSnapshot: BorrowerSnapshot;
    let fundingPolicy: BankingPolicySnapshot;
    if (input.preloadedFundingContext) {
      const context = input.preloadedFundingContext;
      const error = validatePreloadedConstructionFundingContext(context, {
        bankId: input.bankId,
        borrowerId: corporation._id,
        borrowerCurrency: resolveCorpLiquidCurrencyCode(corporation),
      });
      if (error) return { ok: false, error };
      if (context.turn !== input.order.startTurn)
        return { ok: false, error: "Construction order turn does not match the funding snapshot" };
      bankSnapshot = context.bankSnapshot;
      bankCorporation = context.bankCorporation;
      borrowerSnapshot = context.borrowerSnapshot;
      fundingPolicy = context.policy;
    } else {
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
      bankSnapshot = loaded.snapshot;
      bankCorporation = loaded.corporation;
      borrowerSnapshot = borrower.snapshot;
      fundingPolicy = loaded.snapshot.policy;
    }
    if (
      bankCorporation.bankCharter?.status !== "active" ||
      !fundingPolicy.privateBanking ||
      !fundingPolicy.treasuryCashLedger ||
      !fundingPolicy.constructionFinance
    )
      return { ok: false, error: "Construction funding prerequisites are not enabled" };
    const quote = quoteConstructionFinance({
      enabled: true,
      bank: { ...bankSnapshot, charter: { ...bankSnapshot.charter!, requireApproval: true } },
      borrower: borrowerSnapshot,
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
    if (
      input.maximumRatePercent !== undefined &&
      (!Number.isFinite(input.maximumRatePercent) || input.maximumRatePercent < quote.ratePercent)
    )
      return { ok: false, error: "The lender's rate exceeds the reviewed quote" };
    const prepared = input.buildContext
      ? await prepareConstructionBuildEffects({
          db,
          enabled: true,
          sector,
          claimId,
          borrowerId: String(corporation._id),
          loanId: String(loanId),
          turn: bankSnapshot.turn,
          currency: bankSnapshot.currency,
          feeLocal: input.constructionCostLocal - input.collateralCostLocal,
          destinationCurrency: input.buildContext.destinationCurrency,
          bucket: input.buildContext.bucket,
          units: input.order.unitsOrdered,
          eraUnitScale: input.buildContext.eraUnitScale,
        })
      : null;
    if (prepared && !prepared.ok) return { ok: false, error: prepared.error };
    claim = {
      claimId,
      loanId: loanId.toHexString(),
      bankId: input.bankId.toHexString(),
      charteredTurn: bankSnapshot.charter!.charteredTurn,
      borrowerId: corporation._id.toHexString(),
      currency: bankSnapshot.currency,
      constructionCostLocal: input.constructionCostLocal,
      collateralCostLocal: input.collateralCostLocal,
      borrowerContributionLocal: quote.borrowerContribution,
      principal: quote.principal,
      proceedsLocal: quote.proceeds,
      termTurns: input.termTurns,
      ratePercent: quote.ratePercent,
      order: input.order,
      ...(prepared?.ok ? { effects: prepared.value } : {}),
      approvalRequired: bankCorporation.bankCharter.requireApproval === true,
      requestTransition: quote.transition,
      status: "awaiting_approval",
      escrowLocal: 0,
      admissionToken: randomUUID(),
    };
    if (!isValidConstructionBuildClaim(claim))
      return { ok: false, error: "Construction quote is incomplete" };
    if (
      !(await acquireConstructionAdmission(db, {
        token: claim.admissionToken!,
        loanId: claim.loanId,
        turn: bankSnapshot.turn,
      }))
    )
      return { ok: false, error: "Construction admission is disabled or closing" };
    const reserved = await sectors.updateOne(
      {
        _id: sector._id,
        corporationId: corporation._id,
        stateId: sector.stateId,
        sectorType: sector.sectorType,
        industryModel: sector.industryModel ?? null,
        mediaDiscriminator: sector.mediaDiscriminator ?? null,
        forSale: null,
        ...(sector.strategyId
          ? { strategyId: sector.strategyId }
          : {
              $or: [{ strategyId: { $exists: false } }, { strategyId: { $type: "null" } }],
            }),
        $and: [
          unprotectedConstructionPropertyFilter(),
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
    if (reserved.matchedCount !== 1) {
      await releaseConstructionAdmission(db, claim.admissionToken);
      return { ok: false, error: "The sector changed while reserving construction finance" };
    }
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
  if (claim.approvalRequired && claim.status === "awaiting_approval") {
    await releaseConstructionAdmission(db, claim.admissionToken);
    return { ok: true, pending: true, loanId: claim.loanId, claimId };
  }
  return approveConstructionFinance(
    db,
    new ObjectId(claim.bankId),
    new ObjectId(claim.loanId),
    true,
    input.preloadedFundingContext
  );
}

/** Approval and rejection share an exclusive loan decision before any funding. */
export async function approveConstructionFinance(
  db: Db,
  bankId: ObjectId,
  loanId: ObjectId,
  enabled: boolean,
  preloadedFundingContext?: PreloadedConstructionFundingContext
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
  const loaded = preloadedFundingContext
    ? {
        snapshot: preloadedFundingContext.bankSnapshot,
        corporation: preloadedFundingContext.bankCorporation,
      }
    : await loadBankingSnapshot(db, bankId);
  if (
    !loaded?.corporation.bankCharter ||
    loaded.snapshot.charter?.charteredTurn !== claim.charteredTurn
  )
    return { ok: false, error: "The lender charter changed before construction approval" };
  let borrowerSnapshot: BorrowerSnapshot;
  if (preloadedFundingContext) {
    const error = validatePreloadedConstructionFundingContext(preloadedFundingContext, {
      bankId,
      borrowerId: new ObjectId(claim.borrowerId),
      borrowerCurrency: claim.currency,
    });
    if (error) return { ok: false, error };
    borrowerSnapshot = preloadedFundingContext.borrowerSnapshot;
  } else {
    const borrower = await loadBorrowerSnapshot(
      db,
      loaded.corporation.bankCharter,
      loaded.snapshot.currency,
      { type: "corporation", id: new ObjectId(claim.borrowerId) },
      loaded.snapshot.turn
    );
    if ("error" in borrower) return { ok: false, error: borrower.error };
    borrowerSnapshot = borrower.snapshot;
  }
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
    borrower: borrowerSnapshot,
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
  if (claim.status === "cancelled" && loan.status === "rejected") {
    await releaseConstructionAdmission(db, claim.admissionToken);
    return { ok: true, pending: false, loanId: claim.loanId, claimId: claim.claimId };
  }
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
  if (!settled.error && ["applied", "replayed"].includes(settled.status))
    await releaseConstructionAdmission(db, claim.admissionToken);
  return !settled.error && ["applied", "replayed"].includes(settled.status)
    ? { ok: true, pending: false, loanId: claim.loanId, claimId: claim.claimId }
    : { ok: false, error: settled.error ?? "Construction rejection is pending recovery" };
}

/** Finish approved claims left by earlier turns without approving a new loan. */
export async function recoverConstructionFunding(
  db: Db,
  turn: number
): Promise<Array<{ key: string; error: string }>> {
  const sectors = db.collection<CorporateSector>("corporateSectors");
  const unfinished = await sectors
    .find(
      {
        "constructionFinancing.status": { $in: ["awaiting_approval", "funding", "building"] },
        "constructionFinancing.requestTransition.turn": { $lt: turn },
        "constructionFinancing.fundingCleanupCompleted": { $ne: true },
      },
      { projection: { constructionFinancing: 1 } }
    )
    .limit(200)
    .toArray();
  const failures: Array<{ key: string; error: string }> = [];
  for (const sector of unfinished) {
    const claim = sector.constructionFinancing;
    if (!claim || !ObjectId.isValid(claim.loanId) || !ObjectId.isValid(claim.bankId)) continue;
    const loan = await db
      .collection<BankLoan>("bankLoans")
      .findOne({ _id: new ObjectId(claim.loanId) }, { projection: { constructionDecision: 1 } });
    // A pending lender decision is not authority to disburse.
    if (loan?.constructionDecision !== "approve") continue;
    const result = await approveConstructionFinance(
      db,
      new ObjectId(claim.bankId),
      new ObjectId(claim.loanId),
      true
    );
    if (!result.ok) {
      const current = await sectors.findOne(
        { _id: sector._id },
        {
          projection: { constructionFinancing: 1 },
        }
      );
      if (current?.constructionFinancing?.status !== "cancelled")
        failures.push({ key: `construction:${claim.claimId}:funding`, error: result.error });
    }
  }
  return failures;
}
