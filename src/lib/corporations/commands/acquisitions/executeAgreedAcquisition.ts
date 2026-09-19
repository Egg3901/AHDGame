import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import type {
  Bond,
  Character,
  Corporation,
  CorporateSector,
  ImperialCharacter,
} from "@/lib/db/types";
import type { IndexFund } from "@/lib/db/types";
import type { FederalBudget } from "@/lib/db/types/budget";
import type { AcquisitionOffer } from "@/lib/db/types/acquisitionOffer";
import {
  anchorToCorpLiquidCapital,
  corpLiquidCapitalToAnchor,
  getCorpFxRate,
  loadFxRatesByCurrency,
  resolveCorpLiquidCurrencyCode,
} from "@/lib/currency/corporationCapital";
import { getHomeCurrency } from "@/lib/currency/characterFunds";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { cleanupShareMarketActivityForCorporations } from "@/lib/corporations/cleanupShareMarketActivity";
import { stampSubjectDeleted } from "@/lib/financialTxLog/stampDeleted";
import { allocateShareholderPool } from "@/lib/bonds/corporateBondDefault";
import { moveSectorToCorp } from "@/lib/corporations/moveSector";
import { recordAudit } from "@/lib/audit/recordAudit";
import { assertMergerClearance } from "@/lib/corporations/mergerReview/gate";
import { attachMergerRemedy } from "@/lib/corporations/mergerReview/lifecycle";
import type { AcquisitionSettlement } from "@/lib/db/types/acquisitionSettlement";
import type { MergerReview } from "@/lib/db/types/mergerReview";
import { MERGER_REVIEWS } from "@/lib/corporations/mergerReview/gate";
import { bankTransferConflict, transferBankCharterToAcquirer } from "@/lib/banking/transferCharter";
import { withCorpLock } from "@/lib/corporations/corpMoneyLock";
import { buildAcquisitionPayoutPlan } from "./rules/acquisitionPayoutPlan";
import {
  applyAcquisitionLeg,
  claimAcquisitionSettlement,
  compensateAcquisitionSettlement,
  emitAcquisitionLegLedger,
  legIndexByKey,
  loadAcquisitionSettlement,
  markAcquisitionApplied,
  markAcquisitionProgress,
} from "./acquisitionSettlement";

export interface ExecuteAgreedAcquisitionParams {
  db: Db;
  offer: AcquisitionOffer;
  currentTurn: number;
}

export type ExecuteAgreedAcquisitionResult =
  | { ok: false; error: string; status: number; terminal?: boolean }
  | {
      ok: true;
      sectorsMoved: number;
      priceAnchor: number;
      acquirerName: string;
      targetName: string;
      bankCharterTransferred: boolean;
    };

/**
 * Execute an accepted agreed acquisition: the acquirer buys the whole target for
 * the agreed price.
 *
 * Money flow (conserved): the acquirer pays the agreed price to the target's
 * shareholders (public-float slice → the country treasury, per the shared
 * convention), then the target's own liquid cash relocates to the acquirer and
 * every sector re-parents to the acquirer; the target shell is deleted.
 *
 * Crash safety: every amount and recipient is pinned once per offer in an
 * `acquisitionSettlements` record claimed before money moves, and each leg
 * applies as an atomic credit-plus-stamp write. A retry resumes from the
 * record: landed legs are skipped, unlanded legs apply, and a completed
 * settlement returns its recorded result. Only a permanently unpayable leg
 * (recipient gone) ends in terminal compensation — refund of exactly the
 * undelivered remainder, never a full refund over paid holders — and the offer
 * goes to `failed`, never back to `pending`.
 *
 * v1 scope: the target must have NO outstanding bonds and hold NO equity in other
 * corporations (bond assumption and cross-holding transfer are deferred). Both
 * are blocked with a clear error rather than mishandled.
 */
export async function executeAgreedAcquisition(
  params: ExecuteAgreedAcquisitionParams
): Promise<ExecuteAgreedAcquisitionResult> {
  // A completed settlement returns its recorded result without touching the
  // world: this is the crash-after-commit path (teardown done, response lost).
  // A compensated settlement is terminal the other way: withdraw/reject or a
  // terminal failure already refunded the undelivered remainder, so execution
  // must NOT resume and pay holders past the closure.
  const completed = await loadAcquisitionSettlement(params.db, params.offer._id);
  if (completed?.status === "applied" && completed.completedResult) {
    return { ok: true, ...completed.completedResult };
  }
  if (completed?.status === "compensated") {
    return {
      ok: false,
      error: "This acquisition was closed and compensated; open a new offer to try again.",
      status: 409,
      terminal: true,
    };
  }
  // Serialize same-acquirer executions in-process (the hostile path does the
  // same); cross-instance races are still closed by the per-leg stamps.
  return withCorpLock(params.offer.acquirerCorporationId, () => runAgreedAcquisition(params));
}

async function runAgreedAcquisition(
  params: ExecuteAgreedAcquisitionParams
): Promise<ExecuteAgreedAcquisitionResult> {
  const { db, offer, currentTurn } = params;
  const corps = db.collection<Corporation>("corporations");

  const [acquirer, target] = await Promise.all([
    corps.findOne({ _id: offer.acquirerCorporationId }),
    corps.findOne({ _id: offer.targetCorporationId }),
  ]);
  if (!acquirer || !target) {
    return handleMissingParty(db, offer, currentTurn, acquirer, target);
  }
  if (acquirer._id.equals(target._id))
    return { ok: false, error: "A corporation cannot acquire itself", status: 400 };
  if (target.countryOwnerId || target.ownershipState === "stateOwned")
    return { ok: false, error: "State-owned corporations cannot be acquired", status: 400 };

  // v1 scope guards — defer bond assumption + cross-holding transfer.
  const openBonds = await db
    .collection<Bond>("bonds")
    .countDocuments({ corporationId: target._id, matured: false });
  if (openBonds > 0)
    return {
      ok: false,
      error:
        "The target has outstanding bonds; acquiring an indebted corporation is not yet supported (have it repay or refinance first).",
      status: 400,
    };
  const targetOwnsEquity = await corps.countDocuments({ "shareholders.corporationId": target._id });
  if (targetOwnsEquity > 0)
    return {
      ok: false,
      error:
        "The target holds equity in other corporations; acquiring a corporate parent is not yet supported.",
      status: 400,
    };

  // Banked target (ticket-1267): the charter is a sub-document on the target,
  // so deleting the shell would delete its bank with it. Blocked up front,
  // before any money moves. Exception: a retry whose earlier attempt claimed
  // the slot and then crashed before releasing the target (dual-charter
  // state). That window belongs to the transfer recovery protocol in #2016;
  // this pre-check must not veto its resume, so it stands aside exactly when
  // the slot charter is this target's own charter by identity and a live
  // settlement for this offer owns the run. (Identity compare mirrors
  // #2016's; the protocol itself is not duplicated here.)
  const bankConflict = bankTransferConflict(target, acquirer);
  if (bankConflict && !(await isOwnInterruptedCharterClaim(db, offer, target, acquirer))) {
    return { ok: false, error: bankConflict, status: 400 };
  }

  // Merger review (C3). Runs BEFORE any money moves: a referral must leave the
  // two corporations exactly as it found them. A cleared review returns here
  // with the (possibly conditional) clearance attached. Durable per pair, so a
  // retry after a referral sails straight through.
  const clearance = await assertMergerClearance(
    db,
    acquirer,
    target,
    "agreedAcquisition",
    currentTurn
  );
  if (!clearance.ok) return { ok: false, error: clearance.error, status: clearance.status };

  // Only one live settlement may own a target: a second concurrently accepted
  // offer for the same corporation stops here instead of paying holders twice.
  const targetClaim = await corps.updateOne(
    {
      _id: target._id,
      $or: [
        { acquisitionSettlementId: { $exists: false } },
        { acquisitionSettlementId: offer._id },
      ],
    },
    { $set: { acquisitionSettlementId: offer._id, updatedAt: new Date() } }
  );
  if (targetClaim.matchedCount !== 1) {
    const holder = await corps.findOne(
      { _id: target._id },
      { projection: { acquisitionSettlementId: 1 } }
    );
    if (holder?.acquisitionSettlementId && !holder.acquisitionSettlementId.equals(offer._id)) {
      return {
        ok: false,
        error: `Another acquisition of ${target.name} is already in progress.`,
        status: 409,
      };
    }
    return { ok: false, error: "Target corporation no longer exists", status: 404 };
  }

  const now = new Date();
  const [targetSectors, fxByCurrency, acquirerFxRate, targetFxRate] = await Promise.all([
    db
      .collection<CorporateSector>("corporateSectors")
      .find({ corporationId: target._id })
      .toArray(),
    loadFxRatesByCurrency(db),
    getCorpFxRate(db, acquirer),
    getCorpFxRate(db, target),
  ]);
  const acquirerCurrency = resolveCorpLiquidCurrencyCode(acquirer);
  const targetCurrency = resolveCorpLiquidCurrencyCode(target);

  // 1. Pin the payout plan: allocate the pool, resolve every recipient's
  // currency, and freeze every amount. A retry replays these legs verbatim.
  const allocation =
    offer.priceAnchor > 0 ? allocateShareholderPool(target, offer.priceAnchor, new Map()) : null;
  const charIds = (allocation?.characterRows ?? [])
    .filter((r) => !r.isImperial && r.payout > 0)
    .map((r) => new ObjectId(r.characterId));
  const imperialIds = (allocation?.characterRows ?? [])
    .filter((r) => r.isImperial && r.payout > 0)
    .map((r) => new ObjectId(r.characterId));
  const creditorIds = (allocation?.corporationRows ?? [])
    .filter((r) => r.payout > 0)
    .map((r) => new ObjectId(r.corporationId));
  const fundIds = (allocation?.fundRows ?? [])
    .filter((r) => r.payout > 0)
    .map((r) => new ObjectId(r.fundId));
  const [chars, imperials, creditors, funds, treasury] = await Promise.all([
    charIds.length > 0
      ? db
          .collection<Character>("characters")
          .find({ _id: { $in: charIds } })
          .toArray()
      : [],
    imperialIds.length > 0
      ? db
          .collection<ImperialCharacter>("imperialCharacters")
          .find({ _id: { $in: imperialIds } })
          .toArray()
      : [],
    creditorIds.length > 0
      ? db
          .collection<Corporation>("corporations")
          .find({ _id: { $in: creditorIds } })
          .toArray()
      : [],
    fundIds.length > 0
      ? db
          .collection<IndexFund>("indexFunds")
          .find({ _id: { $in: fundIds } })
          .toArray()
      : [],
    allocation?.publicFloatRow && allocation.publicFloatRow.payout > 0
      ? db
          .collection<FederalBudget>("federalBudget")
          .findOne({ countryId: target.countryId }, { projection: { _id: 1 } })
      : null,
  ]);
  const currencyByHolderHex: Record<string, string> = {};
  for (const c of [...chars, ...imperials])
    currencyByHolderHex[c._id.toString()] = getHomeCurrency(c);
  const creditorByHolderHex: Record<
    string,
    { liquidCurrencyCode?: string | null; countryId?: string | null }
  > = {};
  for (const c of creditors) {
    creditorByHolderHex[c._id.toString()] = {
      liquidCurrencyCode: c.liquidCurrencyCode ?? null,
      countryId: (c.countryId as string | null) ?? null,
    };
  }
  const fxRecord: Record<string, number> = Object.fromEntries(fxByCurrency.entries());
  const forexEnabled = await isForexEnabled();

  const priceInAcquirerCapital = Math.round(
    anchorToCorpLiquidCapital(offer.priceAnchor, acquirer, acquirerFxRate)
  );
  const targetCashAnchor = corpLiquidCapitalToAnchor(
    target.liquidCapital ?? 0,
    target,
    targetFxRate
  );
  const shellCashInAcquirerCapital =
    targetCashAnchor > 0
      ? Math.round(anchorToCorpLiquidCapital(targetCashAnchor, acquirer, acquirerFxRate))
      : 0;
  const plan = buildAcquisitionPayoutPlan({
    offerHex: offer._id.toString(),
    priceAnchor: offer.priceAnchor,
    priceInAcquirerCapital,
    acquirerHex: acquirer._id.toString(),
    acquirerName: acquirer.name,
    acquirerCurrency: acquirerCurrency ?? "USD",
    acquirerForCost: {
      liquidCurrencyCode: acquirer.liquidCurrencyCode ?? null,
      countryId: (acquirer.countryId as string | null) ?? null,
    },
    acquirerFxRate,
    targetHex: target._id.toString(),
    targetName: target.name,
    targetCountryId: target.countryId as string,
    targetLiquidCurrencyCode: target.liquidCurrencyCode ?? null,
    allocation: allocation ?? {
      characterRows: [],
      corporationRows: [],
      fundRows: [],
      publicFloatRow: null,
    },
    currencyByHolderHex,
    creditorByHolderHex,
    fundsPresentHex: funds.map((f) => f._id.toString()),
    treasuryPresent: treasury != null,
    fxByCurrency: fxRecord,
    forexEnabled,
    shellCashAnchor: targetCashAnchor,
    shellCashInAcquirerCapital,
    shellCashTargetLocal: Math.round(target.liquidCapital ?? 0),
    targetCurrency: targetCurrency ?? "USD",
  });

  const { settlement, fresh } = await claimAcquisitionSettlement(db, {
    offerId: offer._id,
    acquirerHex: acquirer._id.toString(),
    targetHex: target._id.toString(),
    acquirerName: acquirer.name,
    targetName: target.name,
    priceAnchor: offer.priceAnchor,
    priceInAcquirerCapital,
    acquirerCurrency: acquirerCurrency ?? "USD",
    shellCashTargetLocal: Math.round(target.liquidCapital ?? 0),
    targetCurrency: targetCurrency ?? "USD",
    // First-attempt sector count: this read precedes every move, so on the
    // claiming attempt it is the true total. On retry it is only the
    // remainder and the claim discards it in favor of the pinned value.
    sectorTotal: targetSectors.length,
    remedyReviewId: clearance.review?._id.toString(),
    plan,
  });

  // A pinned plan from an earlier attempt rules: on replay the recorded legs
  // are the only amounts ever applied, never the recomputed plan above. A
  // compensated record (withdraw/reject raced the retry) closes the run here.
  if (!fresh && settlement.status === "compensated") {
    return {
      ok: false,
      error: "This acquisition was closed and compensated; open a new offer to try again.",
      status: 409,
      terminal: true,
    };
  }
  if (fresh && plan.unpayable.length > 0) {
    const first = plan.unpayable[0];
    const reason = `holder ${first.key} is gone (${first.reason})`;
    await compensateAcquisitionSettlement(db, settlement, {
      targetHex: target._id.toString(),
      turn: currentTurn,
      now: new Date(),
      reason,
    });
    await releaseAcquisitionTarget(db, target._id, offer._id);
    return {
      ok: false,
      error:
        `Acquisition cannot complete: ${reason}. No money moved. ` +
        `This offer is closed; open a new offer to try again.`,
      status: 500,
      terminal: true,
    };
  }

  const applyStep = async (key: string): Promise<void> => {
    const index = legIndexByKey(settlement, key);
    if (index < 0) return;
    const outcome = await applyAcquisitionLeg(db, settlement, index, now);
    if (outcome === "guard_failed") {
      throw new InsufficientAcquisitionFunds(settlement.priceInAcquirerCapital);
    }
    if (outcome === "unpayable") {
      throw new UnpayableAcquisitionLeg(settlement.legs[index].key, settlement.legs[index].note);
    }
    await emitAcquisitionLegLedger(db, settlement, index, currentTurn, now);
  };

  try {
    // 2. Debit the acquirer the agreed price. Atomic, balance-gated, stamped:
    // a replay finds the stamp and moves nothing.
    try {
      await applyStep("debit");
    } catch (err) {
      if (err instanceof InsufficientAcquisitionFunds) {
        return {
          ok: false,
          error: `Insufficient corporate funds. Need ${settlement.priceInAcquirerCapital.toLocaleString()} ${
            acquirerCurrency ?? "USD"
          } to complete the acquisition.`,
          status: 400,
        };
      }
      throw err;
    }

    // 3. Move the bank charter BEFORE any payout: a conflict still unwinds
    // cleanly (nothing paid yet). A retry that already completed the transfer
    // (persisted flag) skips the call outright, so the recorded result keeps
    // reporting the transfer and no second move is ever attempted. Crash
    // windows INSIDE the transfer (claim/release, satellite re-keys) belong
    // to its own recovery protocol in #2016; this caller only depends on it.
    const bankTransfer = settlement.bankCharterTransferred
      ? { ok: true as const, transferred: true }
      : await transferBankCharterToAcquirer(db, target._id, acquirer._id, now);
    if (!bankTransfer.ok) return { ok: false, error: bankTransfer.error, status: 500 };
    await markAcquisitionProgress(db, offer._id, {
      bankCharterTransferred: bankTransfer.transferred,
    });
    settlement.bankCharterTransferred = bankTransfer.transferred;

    // 4. Pay the target's shareholders from the pinned legs. Each leg is
    // replay-safe on its own; a permanently missing recipient compensates.
    if (offer.priceAnchor > 0) {
      for (const leg of settlement.legs) {
        if (leg.kind !== "holder_credit") continue;
        await applyStep(leg.key);
      }
    }

    // 5. Fold the target's liquid cash into the acquirer (it now owns the
    // company, cash included). Stamped like any other leg.
    await applyStep("shell-cash");

    // 6. Move every sector into the acquirer (haircut-free, currency
    // re-denominated). Resumable by re-read: moved sectors no longer belong
    // to the target, so a retry only sees what is left. The recorded total
    // derives from the pinned claim-time count minus the sectors still on
    // the target, so moves landed by an attempt that crashed before marking
    // are still counted: ground truth, not an accumulation.
    for (const sector of targetSectors) {
      await moveSectorToCorp(
        db,
        sector,
        acquirer._id,
        targetCurrency,
        targetFxRate,
        acquirerCurrency,
        acquirerFxRate,
        now
      );
    }
    const sectorsRemain = await db
      .collection<CorporateSector>("corporateSectors")
      .countDocuments({ corporationId: target._id });
    const sectorsMovedTotal = settlement.sectorTotal - sectorsRemain;
    await markAcquisitionProgress(db, offer._id, { sectorsMoved: sectorsMovedTotal });
    settlement.sectorsMoved = sectorsMovedTotal;

    // 7. Tear down the target shell.
    const forexEnabledNow = await isForexEnabled();
    await cleanupShareMarketActivityForCorporations(db, [target._id], now, forexEnabledNow);
    await stampSubjectDeleted(db, target._id, {
      sequentialId: target.sequentialId,
      deletedAt: now,
    });
    await corps.deleteOne({ _id: target._id });
    await markAcquisitionProgress(db, offer._id, { shellDeleted: true });
    settlement.shellDeleted = true;

    // A conditional clearance becomes a live divestiture order only now that the
    // merger has actually committed.
    if (clearance.review) await attachMergerRemedy(db, clearance.review, acquirer._id, currentTurn);

    const result = {
      sectorsMoved: settlement.sectorsMoved,
      priceAnchor: offer.priceAnchor,
      acquirerName: acquirer.name,
      targetName: target.name,
      bankCharterTransferred: bankTransfer.transferred,
    };
    await markAcquisitionApplied(db, settlement, result);

    recordAudit({
      source: "api",
      action: "acquisition.execute",
      category: "corp",
      turn: currentTurn,
      ts: now,
      subject: { type: "corporation", id: acquirer._id, name: acquirer.name },
      refs: { corporationId: acquirer._id },
      outcome: "ok",
      meta: {
        offerId: offer._id,
        targetCorporationId: target._id,
        targetName: target.name,
        priceAnchor: offer.priceAnchor,
        sectorsMoved: settlement.sectorsMoved,
      },
    });

    return { ok: true, ...result };
  } catch (err) {
    if (err instanceof UnpayableAcquisitionLeg) {
      const reason = `holder ${err.legKey} is gone (${err.note})`;
      await compensateAcquisitionSettlement(db, settlement, {
        targetHex: target._id.toString(),
        turn: currentTurn,
        now: new Date(),
        reason,
      });
      await releaseAcquisitionTarget(db, target._id, offer._id);
      return {
        ok: false,
        error:
          `Acquisition cannot complete: ${reason}. Delivered payouts stand and cannot be clawed back; ` +
          `the acquirer was refunded the undelivered remainder. This offer is closed; open a new offer to try again.`,
        status: 500,
        terminal: true,
      };
    }
    throw err;
  }
}

class InsufficientAcquisitionFunds extends Error {
  constructor(readonly needed: number) {
    super("Insufficient corporate funds");
    this.name = "InsufficientAcquisitionFunds";
  }
}

class UnpayableAcquisitionLeg extends Error {
  constructor(
    readonly legKey: string,
    readonly note: string
  ) {
    super(`unpayable leg ${legKey}`);
    this.name = "UnpayableAcquisitionLeg";
  }
}

/**
 * True when the bank conflict above is our own interrupted charter move: the
 * slot holds the target's charter by identity and a live settlement for this
 * offer owns the run. Anything else (genuinely different bank, no settlement)
 * stays blocked.
 */
async function isOwnInterruptedCharterClaim(
  db: Db,
  offer: AcquisitionOffer,
  target: Corporation,
  acquirer: Corporation
): Promise<boolean> {
  const targetCharter = target.bankCharter;
  const slotCharter = acquirer.bankCharter;
  if (!targetCharter || !slotCharter) return false;
  const sameIdentity =
    slotCharter.currency === targetCharter.currency &&
    slotCharter.charteredTurn === targetCharter.charteredTurn &&
    slotCharter.type === targetCharter.type &&
    slotCharter.status === targetCharter.status;
  if (!sameIdentity) return false;
  const settlement = await loadAcquisitionSettlement(db, offer._id);
  return (
    settlement != null &&
    settlement.status === "in_progress" &&
    !settlement.bankCharterTransferred &&
    settlement.targetCorporationId.equals(target._id) &&
    settlement.acquirerCorporationId.equals(acquirer._id)
  );
}

async function releaseAcquisitionTarget(
  db: Db,
  targetId: ObjectId,
  offerId: ObjectId
): Promise<void> {
  await db
    .collection<Corporation>("corporations")
    .updateOne(
      { _id: targetId, acquisitionSettlementId: offerId },
      { $unset: { acquisitionSettlementId: "" }, $set: { updatedAt: new Date() } }
    );
}

/**
 * One party vanished. With no settlement this is the legacy 404; with a live
 * one the money decides: a crash between shell delete and commit mark finishes
 * the tail, anything earlier compensates what landed and closes the offer.
 */
async function handleMissingParty(
  db: Db,
  offer: AcquisitionOffer,
  currentTurn: number,
  acquirer: Corporation | null,
  target: Corporation | null
): Promise<ExecuteAgreedAcquisitionResult> {
  const settlement = await loadAcquisitionSettlement(db, offer._id);
  if (settlement?.status === "applied" && settlement.completedResult) {
    return { ok: true, ...settlement.completedResult };
  }
  // Closed by compensation (withdraw/reject/terminal failure): report the
  // closure instead of compensating twice or resuming past it.
  if (settlement?.status === "compensated") {
    return {
      ok: false,
      error: "This acquisition was closed and compensated; open a new offer to try again.",
      status: 409,
      terminal: true,
    };
  }
  if (settlement && settlement.status === "in_progress") {
    if (settlement.shellDeleted) {
      return finishCommitTail(db, settlement, currentTurn);
    }
    const moneyLegs = settlement.legs.filter(
      (leg) =>
        leg.kind === "acquirer_debit" ||
        leg.kind === "holder_credit" ||
        leg.kind === "shell_cash_credit"
    );
    const moneyDone = moneyLegs.every((leg) => leg.applied);
    const sectorsRemain = target
      ? await db
          .collection<CorporateSector>("corporateSectors")
          .countDocuments({ corporationId: target._id })
      : 0;
    // Target gone, money fully delivered, nothing left to move: the crash
    // landed between the shell delete and its flag. Finish the tail.
    if (!target && moneyDone && sectorsRemain === 0) {
      await markAcquisitionProgress(db, offer._id, { shellDeleted: true });
      settlement.shellDeleted = true;
      return finishCommitTail(db, settlement, currentTurn);
    }
    const reason = !target
      ? "the target corporation was removed mid-execution"
      : "the acquiring corporation was removed mid-execution";
    await compensateAcquisitionSettlement(db, settlement, {
      targetHex: target?._id.toString() ?? null,
      turn: currentTurn,
      now: new Date(),
      reason,
    });
    if (target) await releaseAcquisitionTarget(db, target._id, offer._id);
    return {
      ok: false,
      error: !acquirer
        ? "Acquiring corporation no longer exists"
        : "Target corporation no longer exists",
      status: 404,
      terminal: true,
    };
  }
  if (!acquirer) return { ok: false, error: "Acquiring corporation no longer exists", status: 404 };
  return { ok: false, error: "Target corporation no longer exists", status: 404 };
}

/** Post-teardown tail: remedy (re-runnable), commit mark, recorded result. */
async function finishCommitTail(
  db: Db,
  settlement: AcquisitionSettlement,
  currentTurn: number
): Promise<ExecuteAgreedAcquisitionResult> {
  if (settlement.remedyReviewId) {
    const review = await db
      .collection<MergerReview>(MERGER_REVIEWS)
      .findOne({ _id: new ObjectId(settlement.remedyReviewId) });
    if (review) {
      await attachMergerRemedy(db, review, settlement.acquirerCorporationId, currentTurn);
    }
  }
  const result = {
    sectorsMoved: settlement.sectorsMoved,
    priceAnchor: settlement.priceAnchor,
    acquirerName: settlement.acquirerName,
    targetName: settlement.targetName,
    bankCharterTransferred: settlement.bankCharterTransferred,
  };
  await markAcquisitionApplied(db, settlement, result);
  return { ok: true, ...result };
}
