/** Queued payouts retain forward pricing, pro rata cash and their original settlement plan. */
import { randomUUID } from "node:crypto";
import { type Db, type ObjectId, type Document } from "mongodb";
import type { IndexFund, IndexFundRedemptionQueueEntry } from "@/lib/db/types";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import {
  getFundById,
  listPendingRedemptions,
  FUND_REDEMPTION_QUEUE_COLLECTION,
} from "./fundQueries";
import { loadCharacterFxRate } from "@/lib/currency/characterFunds";
import { loadTxThresholds } from "@/lib/financialTxLog/emit";
import { sellFundHoldingsForRedemptionCash } from "./fundRedemptionLiquidity";
import { sellFundBondHoldingsForCash } from "@/lib/bonds/sellFundBondUnits";
import { proRataRedemptionCashShare, quoteCashOnlyRedemption } from "./unitAccounting";
import { remainingRedemptionUnits } from "./fundRedemptionQueue";
import {
  loadQueuedPayoutAuditContext,
  recoverQueuedPayouts,
  settleQueuedPayout,
} from "./queuedPayoutSettlement";

export async function processQueuedRedemptions(
  db: Db,
  fund: IndexFund,
  forexEnabled: boolean,
  currentTurn: number,
  recoveryAlreadyRun = false
): Promise<number> {
  const recovery = recoveryAlreadyRun
    ? { changed: false, recovered: 0 }
    : await recoverQueuedPayouts(db, fund._id, currentTurn);
  if (recovery.changed) {
    fund = (await getFundById(db, fund._id)) ?? fund;
  }
  const pending = await listPendingRedemptions(db, fund._id);
  if (pending.length === 0) return recovery.recovered;

  // #992 tranche 6: one batched NPP lookup for the pass so each NPP
  // redemption below can be denominated in the NPP home currency (the
  // npp:<id>:<homeCurrency> snapshot key) without a per-entry read.
  const holders = new Map<string, Document>();
  const nppCurrencyById = new Map<string, CurrencyCode>();
  const queuedNppObjectIds = pending.flatMap((e) => (e.nppId ? [e.nppId] : []));
  if (queuedNppObjectIds.length > 0) {
    const nppDocs = await db
      .collection<{ _id: ObjectId; countryId?: string }>("npps")
      .find({ _id: { $in: queuedNppObjectIds } })
      .project({ countryId: 1, name: 1 })
      .toArray();
    for (const doc of nppDocs) {
      const cur = COUNTRY_CURRENCY_MAP[doc.countryId as keyof typeof COUNTRY_CURRENCY_MAP] ?? "USD";
      nppCurrencyById.set(doc._id.toString(), cur);
      holders.set(`npps:${doc._id}`, doc);
    }
  }

  for (const [collection, field] of [
    ["characters", "characterId"],
    ["imperialCharacters", "imperialCharacterId"],
  ] as const) {
    const ids = pending.flatMap((entry) => (entry[field] ? [entry[field]!] : []));
    if (!ids.length) continue;
    const rows = await db
      .collection(collection)
      .find({ _id: { $in: ids } })
      .project({ name: 1 })
      .toArray();
    for (const row of rows) holders.set(`${collection}:${row._id}`, row);
  }

  // Wallet credits are in the fund's native currency; the ₳ → native multiplier
  // is stamped on each queue entry at request time (entry.redeemFxRate, ticket
  // #857 grandfather) — 1 for pre-fix legacy units, the fund rate for post-fix
  // units. Fund `cashAnchor` and NPP investment cash stay in ₳. We still gate on
  // rate availability so a momentary outage defers rather than risks a bad payout.
  if (forexEnabled) {
    const fxResult = await loadCharacterFxRate(db, fund.anchorCurrencyCode);
    if (!fxResult.ok) {
      // Rate unavailable — defer payouts to a later cycle.
      console.warn(
        `[indexfund-cron] deferring ${pending.length} queued redemption(s) for ${fund.slug}: FX rate for ${fund.anchorCurrencyCode} unavailable`
      );
      return 0;
    }
  }

  const audit = await loadQueuedPayoutAuditContext(db);
  let paid = recovery.recovered;
  let fundState = fund;
  let availableCash = fund.cashAnchor;
  // #992 tranche 6: thresholds for the bond-sale ledger rows below, loaded
  // at most once per redemption pass and only when a bond sale actually runs.
  let bondSaleThresholds: Awaited<ReturnType<typeof loadTxThresholds>> | undefined;

  // Units still unserved in this pass. Decremented as each entry is handled so
  // the share is measured against who is still waiting, not the original queue.
  let unservedUnits = pending.reduce((sum, e) => sum + Math.max(0, e.units ?? 0), 0);

  for (const pendingEntry of pending) {
    // Fence this claim before liquidation or payout. Its frozen journal, not
    // current prices or an acknowledgement, determines every recovery.
    const claimId = randomUUID();
    const entry = await db
      .collection<IndexFundRedemptionQueueEntry>(FUND_REDEMPTION_QUEUE_COLLECTION)
      .findOneAndUpdate(
        {
          _id: pendingEntry._id,
          status: pendingEntry.status,
          units: pendingEntry.units,
          paidAmountAnchor: pendingEntry.paidAmountAnchor,
          pendingSettlementProjection: { $exists: false },
        },
        {
          $set: {
            status: "processing",
            settlementClaimId: claimId,
            processingTurn: currentTurn,
            processingStartedAt: new Date(),
            updatedAt: new Date(),
          },
          $unset: { payoutPlan: "" },
        },
        { returnDocument: "before" }
      );
    if (!entry) continue;
    const restoreQueueClaim = async () => {
      await db
        .collection<IndexFundRedemptionQueueEntry>(FUND_REDEMPTION_QUEUE_COLLECTION)
        .updateOne(
          { _id: entry._id, status: "processing", settlementClaimId: claimId },
          {
            $set: { status: entry.status, updatedAt: new Date() },
            $unset: { processingStartedAt: "", settlementClaimId: "", processingTurn: "" },
          }
        );
    };

    const unitsRemaining = remainingRedemptionUnits(entry);
    if (unitsRemaining <= 0) {
      await db
        .collection<IndexFundRedemptionQueueEntry>(FUND_REDEMPTION_QUEUE_COLLECTION)
        .updateOne(
          { _id: entry._id, status: "processing", settlementClaimId: claimId },
          {
            $set: { status: "paid", updatedAt: new Date() },
            $unset: { processingStartedAt: "", settlementClaimId: "", processingTurn: "" },
          }
        );
      continue;
    }

    // Forward pricing. The payout is struck at the fund's CURRENT NAV, never at
    // `requestedNavAnchor` (kept only as the record of what was quoted at
    // request). Honouring a locked price across many turns is what let one
    // GLB50 holder draw 2.46B out of a fund whose assets were falling under
    // them, because their claim stayed fixed in cash terms while everyone
    // else's shrank. A real open-end fund forward-prices for exactly this
    // reason: a redemption spanning several valuation points gets each point's
    // NAV, so the redeemer carries the market like every other holder.
    const redemptionNav = fundState.quotedNav;
    if (!Number.isFinite(redemptionNav) || redemptionNav <= 0) {
      await restoreQueueClaim();
      break;
    }

    const entryObligation = unitsRemaining * redemptionNav;
    if (availableCash < entryObligation && fundState.holdings.length > 0) {
      await sellFundHoldingsForRedemptionCash(db, fundState, entryObligation - availableCash, {
        note: "Queued redemption liquidity",
      });
      fundState = (await getFundById(db, fund._id)) ?? fundState;
      availableCash = fundState.cashAnchor;
    }
    // Bonds are the next line of liquidity: sold to the market pool at its
    // bid, as far as the pool can pay. The only line for a bond fund.
    if (availableCash < entryObligation) {
      bondSaleThresholds ??= await loadTxThresholds(db);
      const bondSale = await sellFundBondHoldingsForCash(
        db,
        fundState,
        entryObligation - availableCash,
        new Date(),
        { turn: currentTurn, thresholds: bondSaleThresholds }
      );
      if (bondSale.proceedsAnchor > 0) {
        fundState = (await getFundById(db, fund._id)) ?? fundState;
        availableCash = fundState.cashAnchor;
      }
    }

    if (availableCash <= 0) {
      await restoreQueueClaim();
      break;
    }

    // Pro-rata gate: never let one entry consume the book while others wait.
    // Measured against cash available now, after any liquidation above.
    const cashForThisEntry = proRataRedemptionCashShare({
      entryUnits: unitsRemaining,
      unservedUnits,
      availableCashAnchor: availableCash,
    });
    unservedUnits = Math.max(0, unservedUnits - unitsRemaining);

    const quote = quoteCashOnlyRedemption({
      quotedNav: redemptionNav,
      requestedUnits: unitsRemaining,
      cashAnchor: cashForThisEntry,
    });

    if (quote.redeemableUnits <= 0) {
      // This entry's pro-rata slice will not buy a whole unit. That says
      // nothing about the next entry, and the genuinely-out-of-cash case
      // already broke out above, so move on rather than starving the queue.
      await restoreQueueClaim();
      continue;
    }

    const paidAmount = quote.paidAmountAnchor;
    // Native-currency equivalent for personal wallet credits (₳ × blended rate).
    // Absent redeemFxRate = pre-fix queue row → credit rate-free (× 1), matching
    // what the holder was owed under the old symmetric-scale code (no windfall).
    const redeemFxRate = entry.redeemFxRate ?? 1;
    const paidNative = forexEnabled ? paidAmount * redeemFxRate : paidAmount;

    const settled = await settleQueuedPayout(db, {
      fund: fundState,
      entry,
      claimId,
      paidAmount,
      paidNative,
      units: quote.redeemableUnits,
      remainingUnits: quote.queuedUnits,
      nav: redemptionNav,
      turn: currentTurn,
      forexEnabled,
      nppCurrency: nppCurrencyById.get(entry.nppId?.toString() ?? "") ?? "USD",
      audit,
      holder: holders.get(
        entry.characterId
          ? `characters:${entry.characterId}`
          : entry.imperialCharacterId
            ? `imperialCharacters:${entry.imperialCharacterId}`
            : `npps:${entry.nppId}`
      ),
    });
    if (!settled) {
      await restoreQueueClaim();
      continue;
    }
    availableCash -= paidAmount;
    if (entry.unitsBurnedAtRequest !== true)
      fundState = { ...fundState, unitSupply: fundState.unitSupply - quote.redeemableUnits };

    paid++;
  }

  return paid;
}
