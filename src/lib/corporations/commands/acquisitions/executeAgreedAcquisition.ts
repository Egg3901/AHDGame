import type { Db } from "mongodb";
import type { Bond, Corporation, CorporateSector } from "@/lib/db/types";
import type { AcquisitionOffer } from "@/lib/db/types/acquisitionOffer";
import {
  anchorToCorpLiquidCapital,
  corpLiquidCapitalToAnchor,
  getCorpFxRate,
  loadFxRatesByCurrency,
  resolveCorpLiquidCurrencyCode,
} from "@/lib/currency/corporationCapital";
import {
  atomicallyDebitCorpLiquidCapital,
  creditCorpLiquidCapital,
  refundCorpLiquidCapital,
} from "@/lib/financialTxLog/atomicCashGuard";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { emitTx } from "@/lib/financialTxLog/emit";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { cleanupShareMarketActivityForCorporations } from "@/lib/corporations/cleanupShareMarketActivity";
import { stampSubjectDeleted } from "@/lib/financialTxLog/stampDeleted";
import { payShareholders } from "@/lib/nationalization/ownershipTransition";
import { moveSectorToCorp } from "@/lib/corporations/moveSector";
import { recordAudit } from "@/lib/audit/recordAudit";
import { assertMergerClearance } from "@/lib/corporations/mergerReview/gate";
import { attachMergerRemedy } from "@/lib/corporations/mergerReview/lifecycle";

export interface ExecuteAgreedAcquisitionParams {
  db: Db;
  offer: AcquisitionOffer;
  currentTurn: number;
}

export type ExecuteAgreedAcquisitionResult =
  | { ok: false; error: string; status: number }
  | {
      ok: true;
      sectorsMoved: number;
      priceAnchor: number;
      acquirerName: string;
      targetName: string;
    };

/**
 * Execute an accepted agreed acquisition: the acquirer buys the whole target for
 * the agreed price. Reuses the fund-correct `payShareholders` payout and the
 * haircut-free `moveSectorToCorp` transfer.
 *
 * Money flow (conserved): the acquirer pays the agreed price to the target's
 * shareholders (public-float slice → the country treasury, per the shared
 * convention), then the target's own liquid cash relocates to the acquirer and
 * every sector re-parents to the acquirer; the target shell is deleted.
 *
 * v1 scope: the target must have NO outstanding bonds and hold NO equity in other
 * corporations (bond assumption and cross-holding transfer are deferred). Both
 * are blocked with a clear error rather than mishandled.
 */
export async function executeAgreedAcquisition(
  params: ExecuteAgreedAcquisitionParams
): Promise<ExecuteAgreedAcquisitionResult> {
  const { db, offer, currentTurn } = params;
  const corps = db.collection<Corporation>("corporations");

  const [acquirer, target] = await Promise.all([
    corps.findOne({ _id: offer.acquirerCorporationId }),
    corps.findOne({ _id: offer.targetCorporationId }),
  ]);
  if (!acquirer) return { ok: false, error: "Acquiring corporation no longer exists", status: 404 };
  if (!target) return { ok: false, error: "Target corporation no longer exists", status: 404 };
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

  // Merger review (C3). Runs BEFORE any money moves: a referral must leave the
  // two corporations exactly as it found them. A cleared review returns here
  // with the (possibly conditional) clearance attached.
  const clearance = await assertMergerClearance(db, acquirer, target, "agreedAcquisition", currentTurn);
  if (!clearance.ok)
    return { ok: false, error: clearance.error, status: clearance.status };

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

  // 1. Debit the acquirer the agreed price (₳ → acquirer capital). Atomic, balance-gated.
  const priceInAcquirerCapital = Math.round(
    anchorToCorpLiquidCapital(offer.priceAnchor, acquirer, acquirerFxRate)
  );
  if (priceInAcquirerCapital > 0) {
    const debit = await atomicallyDebitCorpLiquidCapital(db, acquirer._id, priceInAcquirerCapital);
    if (!debit.ok)
      return {
        ok: false,
        error: `Insufficient corporate funds. Need ${priceInAcquirerCapital.toLocaleString()} ${
          acquirerCurrency ?? "USD"
        } to complete the acquisition.`,
        status: 400,
      };
  }

  // 2. Pay the target's shareholders the agreed pool (fund-correct allocation).
  //    Refund the acquirer if the payout throws before we mutate any assets.
  try {
    if (offer.priceAnchor > 0) {
      await payShareholders(db, target, offer.priceAnchor, fxByCurrency, now, {
        turn: currentTurn,
        kind: "agreed_acquisition",
      });
    }
  } catch (err) {
    if (priceInAcquirerCapital > 0)
      await refundCorpLiquidCapital(db, acquirer._id, priceInAcquirerCapital);
    throw err;
  }

  // 3. Fold the target's liquid cash into the acquirer (it now owns the company,
  //    cash included). Conserves money: the price went to shareholders; the
  //    target's own cash simply relocates to its new owner.
  const targetCashAnchor = corpLiquidCapitalToAnchor(
    target.liquidCapital ?? 0,
    target,
    targetFxRate
  );
  if (targetCashAnchor > 0) {
    await creditCorpLiquidCapital(
      db,
      acquirer._id,
      Math.round(anchorToCorpLiquidCapital(targetCashAnchor, acquirer, acquirerFxRate))
    );
  }

  // 4. Move every sector into the acquirer (haircut-free, currency re-denominated).
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

  // 4b. Ledger the two corporate-side legs. The holder credits were emitted by
  //     `payShareholders`; these are the acquirer's outflow and the shell's cash
  //     moving to its new owner. Emitted here, after every asset mutation has
  //     succeeded, so a failure earlier (which refunds) logs nothing.
  const targetCashInAcquirerCapital =
    targetCashAnchor > 0
      ? Math.round(anchorToCorpLiquidCapital(targetCashAnchor, acquirer, acquirerFxRate))
      : 0;
  await Promise.all([
    priceInAcquirerCapital > 0
      ? emitTx(db, {
          type: "share_buyout_outflow",
          turn: currentTurn,
          createdAt: now,
          subjectType: "corporation",
          subjectId: acquirer._id,
          subjectName: acquirer.name,
          amount: -priceInAcquirerCapital,
          currencyCode: (acquirerCurrency ?? "USD") as CurrencyCode,
          counterpartyType: "corporation",
          counterpartyId: target._id,
          counterpartyName: target.name,
          meta: { kind: "agreed_acquisition", offerId: offer._id.toString() },
        })
      : Promise.resolve(),
    targetCashInAcquirerCapital > 0
      ? emitTx(db, {
          type: "corp_dissolution_distribution",
          turn: currentTurn,
          createdAt: now,
          subjectType: "corporation",
          subjectId: acquirer._id,
          subjectName: acquirer.name,
          amount: targetCashInAcquirerCapital,
          currencyCode: (acquirerCurrency ?? "USD") as CurrencyCode,
          counterpartyType: "corporation",
          counterpartyId: target._id,
          counterpartyName: target.name,
          meta: { kind: "agreed_acquisition", side: "shell_cash_absorbed" },
        })
      : Promise.resolve(),
    target.liquidCapital && target.liquidCapital > 0
      ? emitTx(db, {
          type: "corp_dissolution_distribution",
          turn: currentTurn,
          createdAt: now,
          subjectType: "corporation",
          subjectId: target._id,
          subjectName: target.name,
          amount: -Math.round(target.liquidCapital),
          currencyCode: (targetCurrency ?? "USD") as CurrencyCode,
          counterpartyType: "corporation",
          counterpartyId: acquirer._id,
          counterpartyName: acquirer.name,
          meta: { kind: "agreed_acquisition", side: "shell_cash_released" },
        })
      : Promise.resolve(),
  ]);

  // 5. Tear down the target shell.
  const forexEnabled = await isForexEnabled();
  await cleanupShareMarketActivityForCorporations(db, [target._id], now, forexEnabled);
  await stampSubjectDeleted(db, target._id, { sequentialId: target.sequentialId, deletedAt: now });
  await corps.deleteOne({ _id: target._id });

  // A conditional clearance becomes a live divestiture order only now that the
  // merger has actually committed.
  if (clearance.review) await attachMergerRemedy(db, clearance.review, acquirer._id, currentTurn);

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
      sectorsMoved: targetSectors.length,
    },
  });

  return {
    ok: true,
    sectorsMoved: targetSectors.length,
    priceAnchor: offer.priceAnchor,
    acquirerName: acquirer.name,
    targetName: target.name,
  };
}
