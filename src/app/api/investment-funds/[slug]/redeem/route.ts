import { tradeCorporationFund } from "@/lib/indexFunds/corporationTrade";
import { resumeFundCommandAudit } from "@/lib/indexFunds/playerCommandAudit";
import {
  claimFundCommand,
  recordFundCommandQuote,
  completeFundCommand,
  pendingFundCommandResponse,
} from "@/lib/indexFunds/playerCommand";
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { getAuthUserWithCharacter } from "@/lib/auth";
import { badRequest, handleRouteError, notFound, errorResponse } from "@/lib/api/errors";
import { runTransactionWithSessionRetry } from "@/lib/db/transactionWithRetry";
import { parseJsonBody } from "@/lib/api/validate";
import {
  isIndexFundsFullMode,
  INDEX_FUNDS_PARTIAL_MESSAGE,
  INDEX_FUNDS_DISABLED_MESSAGE,
  isIndexFundsEnabled,
} from "@/lib/indexFunds/featureFlag";
import {
  resolveFundBySlugOrId,
  debitFundPosition,
  insertFundTransaction,
  enqueueRedemption,
  getPosition,
} from "@/lib/indexFunds/fundQueries";
import {
  quoteCashOnlyRedemption,
  blendedRedeemFxRate as computeBlendedRedeemFxRate,
} from "@/lib/indexFunds/unitAccounting";
import { sellFundHoldingsForRedemptionCash } from "@/lib/indexFunds/fundRedemptionLiquidity";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { buildPersonalBalanceInc, loadCharacterFxRate } from "@/lib/currency/characterFunds";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { logIndexFundRedeemActivity } from "@/lib/indexFunds/fundTxLog";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { getQueuedRedemptionLiabilityAnchor } from "@/lib/indexFunds/fundValuation";
import { recordAudit } from "@/lib/audit/recordAudit";
import { rejectDuringTurn } from "@/lib/api/rejectDuringTurn";
import { claimFundRedemptionLock } from "@/lib/indexFunds/redemptionLock";

const redeemSchema = z.object({
  corporationId: z
    .string()
    .regex(/^[a-fA-F0-9]{24}$/)
    .optional(),
  operationId: z.string().uuid(),
  units: z.number().int().min(1),
});

// POST /api/investment-funds/[slug]/redeem — Redeem (sell) fund units
// Auth: logged-in user with a character
// Requires "full" mode — partial mode blocks player transactions.
// Pays from fund cash, sells underlying shares to public float when needed,
// then queues any remainder for the hourly fund cycle.
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  let claimedOperationId: string | undefined;
  try {
    const auth = await getAuthUserWithCharacter();
    if (!auth) return errorResponse(401, "Authentication required");

    const rateLimit = checkRateLimit(auth.userId, 10, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const characterId = auth.character?._id;
    if (!characterId) {
      return errorResponse(400, "No active character");
    }

    const db = await getDb();
    const { slug } = await params;
    const fund = await resolveFundBySlugOrId(db, slug);
    if (!fund) throw notFound("Fund not found");

    const parsed = await parseJsonBody(request, redeemSchema);
    if (!parsed.success) {
      return errorResponse(parsed.status, parsed.error);
    }
    const { units, operationId } = parsed.data;
    if (parsed.data.corporationId)
      return tradeCorporationFund(
        db,
        auth.userId,
        characterId,
        fund,
        { ...parsed.data, corporationId: parsed.data.corporationId },
        "redeem"
      );
    claimedOperationId = operationId;
    const command = await claimFundCommand(db, characterId, operationId, {
      fundId: fund._id.toHexString(),
      kind: "redeem",
      units,
    });
    if (command.response) return command.response;
    const execute = async () => {
      if (!(await isIndexFundsEnabled())) {
        return errorResponse(403, INDEX_FUNDS_DISABLED_MESSAGE);
      }
      if (!(await isIndexFundsFullMode())) {
        return errorResponse(403, INDEX_FUNDS_PARTIAL_MESSAGE);
      }

      const turnGuard = await rejectDuringTurn(db);
      if (turnGuard) return turnGuard;
      if (fund.status === "delisted") {
        return errorResponse(400, "Fund is delisted");
      }

      const position = await getPosition(db, fund._id, "character", { characterId });
      if (!position || position.units < units) {
        return errorResponse(400, `Insufficient units. You hold ${position?.units ?? 0} units.`);
      }

      const character = auth.character!;
      const auditTurn = await getCurrentTurn(db);
      const holderContext = {
        holderKind: "character" as const,
        holderId: characterId,
        holderName: character.name,
        userId: new ObjectId(auth.userId),
        username: auth.username,
        countryId: character.countryId,
      };

      const forexEnabled = await isForexEnabled();

      // Payouts are computed in ₳ but credited to a wallet held in the fund's
      // native currency. Convert ₳ → native (× rate) before crediting, mirroring
      // the subscribe debit. Without this, redemptions underpay/overpay by the
      // currency rate for every fund whose rate ≠ 1.
      const fundCurrency = fund.anchorCurrencyCode as CurrencyCode;
      let fundFxRate = 1.0;
      if (forexEnabled) {
        const fxResult = await loadCharacterFxRate(db, fundCurrency);
        if (!fxResult.ok) {
          return errorResponse(503, "Exchange rate unavailable, try again shortly");
        }
        fundFxRate = fxResult.rate;
      }

      await recordFundCommandQuote(db, command.key, {
        turn: auditTurn,
        navAnchor: fund.quotedNav,
        fundCurrency,
        fundFxRate,
        forexEnabled,
        heldUnits: position.units,
        legacyUnits: position.legacyUnits ?? position.units,
      });

      {
        let result:
          | {
              redeemedUnits: number;
              paidAmountAnchor: number;
              queuedUnits: number;
              queuedAmountAnchor: number;
              status: "paid" | "partial" | "queued";
              sharesSoldForLiquidity?: number;
              payoutLogs: Array<{
                transactionId: ObjectId;
                units: number;
                amountAnchor: number;
                navAnchor: number;
              }>;
              finalNavAnchor: number;
              /** ₳ → fund-currency rate the payouts were credited at. */
              redeemFxRate: number;
            }
          | undefined;

        const runRedemptionBody = async (
          sess: import("mongodb").ClientSession | undefined,
          compensate: boolean,
          undo: Array<() => Promise<void>>
        ) => {
          const s = sess ? { session: sess } : undefined;
          // Guarded debit: a concurrent redemption may have drained the position
          // since the pre-check above — never pay out units that weren't debited.
          const debit = await debitFundPosition(
            db,
            fund._id,
            "character",
            { characterId },
            units,
            s
          );
          if (!debit.ok) {
            throw badRequest("Insufficient units — your position changed, please retry.");
          }
          // On the standalone path there is no transaction to roll back, so the
          // exact pre-debit position is restored if a later leg throws.
          if (compensate) {
            undo.push(async () => {
              await db.collection("indexFundPositions").updateOne(
                { _id: position!._id },
                {
                  $set: {
                    units: position!.units,
                    updatedAt: position!.updatedAt,
                    ...(position!.avgNavAnchor !== undefined
                      ? { avgNavAnchor: position!.avgNavAnchor }
                      : {}),
                    ...(position!.legacyUnits !== undefined
                      ? { legacyUnits: position!.legacyUnits }
                      : {}),
                  },
                  $setOnInsert: {
                    fundId: position!.fundId,
                    holderKind: position!.holderKind,
                    createdAt: position!.createdAt,
                    ...(position!.characterId !== undefined
                      ? { characterId: position!.characterId }
                      : {}),
                  },
                },
                { upsert: true }
              );
            });
          }

          // Ticket #857 grandfather: units bought before the currency-scale fix
          // (legacy) were charged the raw ₳ magnitude as native, so they redeem
          // rate-free (× 1); post-fix units redeem at the true × rate. The blend is
          // applied uniformly to every payout leg (immediate + queued), so total
          // native = legacy×nav + postfix×nav×rate.
          const blendedRedeemFxRate = computeBlendedRedeemFxRate({
            legacyUnitsRedeemed: debit.legacyUnitsRedeemed,
            totalUnits: units,
            fundFxRate,
            forexEnabled,
          });

          // Burn all accepted units up front. Any unpaid remainder becomes a
          // queued cash payable, not phantom fund units in the NAV denominator.
          const supplyBurn = await db.collection("indexFunds").updateOne(
            { _id: fund._id, unitSupply: { $gte: units } },
            {
              $inc: { unitSupply: -units },
              $set: { updatedAt: new Date() },
            },
            s
          );
          if (supplyBurn.matchedCount === 0) {
            throw new Error("Fund unit supply changed during redemption; please retry.");
          }
          if (compensate) {
            undo.push(async () => {
              await db
                .collection("indexFunds")
                .updateOne(
                  { _id: fund._id },
                  { $inc: { unitSupply: units }, $set: { updatedAt: new Date() } }
                );
            });
          }

          let fundState = await resolveFundBySlugOrId(db, slug, s);
          if (!fundState) throw new Error("Fund not found");
          let existingQueuedLiabilityAnchor = await getQueuedRedemptionLiabilityAnchor(
            db,
            fundState._id
          );

          let cashQuote = quoteCashOnlyRedemption({
            quotedNav: fundState.quotedNav,
            requestedUnits: units,
            cashAnchor: Math.max(0, fundState.cashAnchor - existingQueuedLiabilityAnchor),
          });

          let totalRedeemedUnits = 0;
          let totalPaidAnchor = 0;
          let sharesSoldForLiquidity = 0;
          const payoutLogs: Array<{
            transactionId: ObjectId;
            units: number;
            amountAnchor: number;
            navAnchor: number;
          }> = [];

          async function payRedeemableUnits(quote: typeof cashQuote): Promise<void> {
            if (quote.redeemableUnits <= 0) return;

            // Balance-gated debit. Without the $gte guard two concurrent redeems
            // could both read the same cash, both pass the affordability check and
            // both debit, driving fund cash negative. The queued-redemption path
            // already guards this way; the immediate path did not.
            const cashDebit = await db.collection("indexFunds").updateOne(
              { _id: fundState!._id, cashAnchor: { $gte: quote.paidAmountAnchor } },
              {
                $inc: {
                  cashAnchor: -quote.paidAmountAnchor,
                },
                $set: { updatedAt: new Date() },
              },
              s
            );
            if (cashDebit.matchedCount === 0) {
              throw new Error("FUND_CASH_RACE");
            }
            // Undo for this leg's cash debit, unwound by the outer stack if a
            // later leg throws.
            const cashUndo = compensate
              ? async () => {
                  await db.collection("indexFunds").updateOne(
                    { _id: fundState!._id },
                    {
                      $inc: { cashAnchor: quote.paidAmountAnchor },
                      $set: { updatedAt: new Date() },
                    }
                  );
                }
              : undefined;
            if (cashUndo) undo.push(cashUndo);

            const creditInc = buildPersonalBalanceInc(
              forexEnabled ? quote.paidAmountAnchor * blendedRedeemFxRate : quote.paidAmountAnchor,
              fundState!.anchorCurrencyCode,
              forexEnabled
            );
            const creditResult = await db
              .collection("characters")
              .updateOne(
                { _id: characterId },
                { $inc: creditInc, $set: { updatedAt: new Date() } },
                s
              );
            if (creditResult.matchedCount === 0) {
              // Holder gone. Unwind everything already applied (position,
              // supply and cash) via the compensation stack instead of
              // reporting a payout that never landed.
              throw notFound("Character not found");
            }

            if (compensate) {
              const negatedInc: Record<string, number> = {};
              for (const [field, value] of Object.entries(creditInc)) {
                negatedInc[field] = -value;
              }
              undo.push(async () => {
                await db
                  .collection("characters")
                  .updateOne({ _id: characterId }, { $inc: negatedInc });
              });
            }

            const redemptionTxId = await insertFundTransaction(
              db,
              {
                fundId: fundState!._id,
                kind: "redemption",
                holderKind: "character",
                characterId,
                units: quote.redeemableUnits,
                navAnchor: fundState!.quotedNav,
                amountAnchor: quote.paidAmountAnchor,
                createdAt: new Date(),
              },
              s
            );
            if (compensate) {
              undo.push(async () => {
                await db.collection("indexFundTransactions").deleteOne({ _id: redemptionTxId });
              });
            }

            totalRedeemedUnits += quote.redeemableUnits;
            totalPaidAnchor += quote.paidAmountAnchor;
            payoutLogs.push({
              transactionId: redemptionTxId,
              units: quote.redeemableUnits,
              amountAnchor: quote.paidAmountAnchor,
              navAnchor: fundState!.quotedNav,
            });
          }

          await payRedeemableUnits(cashQuote);

          if (cashQuote.queuedUnits > 0 && fundState.holdings.length > 0) {
            const sellResult = await sellFundHoldingsForRedemptionCash(
              db,
              fundState,
              cashQuote.queuedAmountAnchor,
              { ...s, note: "Player redemption liquidity" }
            );
            if (compensate && sellResult.undo) undo.push(sellResult.undo);
            sharesSoldForLiquidity += sellResult.sharesSold;

            fundState = (await resolveFundBySlugOrId(db, slug, s)) ?? fundState;
            existingQueuedLiabilityAnchor = await getQueuedRedemptionLiabilityAnchor(
              db,
              fundState._id
            );
            const afterSellQuote = quoteCashOnlyRedemption({
              quotedNav: fundState.quotedNav,
              requestedUnits: cashQuote.queuedUnits,
              cashAnchor: Math.max(0, fundState.cashAnchor - existingQueuedLiabilityAnchor),
            });
            await payRedeemableUnits(afterSellQuote);

            cashQuote = {
              ...cashQuote,
              queuedUnits: afterSellQuote.queuedUnits,
              queuedAmountAnchor: afterSellQuote.queuedAmountAnchor,
              status:
                afterSellQuote.queuedUnits === 0
                  ? totalRedeemedUnits < units
                    ? "partial"
                    : "paid"
                  : totalRedeemedUnits > 0
                    ? "partial"
                    : "queued",
            };
          }

          if (cashQuote.queuedUnits > 0) {
            const queueEntryId = await enqueueRedemption(
              db,
              {
                fundId: fundState._id,
                holderKind: "character",
                characterId,
                units: cashQuote.queuedUnits,
                requestedNavAnchor: fundState.quotedNav,
                requestedAmountAnchor: cashQuote.queuedAmountAnchor,
                paidAmountAnchor: 0,
                unitsBurnedAtRequest: true,
                // Grandfather multiplier for the queued remainder (see redeem
                // blend above): the cron credits paidAmount × redeemFxRate.
                redeemFxRate: blendedRedeemFxRate,
                // cashQuote.status is already "partial" when some units were paid
                // immediately (or via the liquidity sale above) before the rest got
                // queued — hardcoding "queued" here discarded that distinction, so
                // support tooling couldn't tell a fresh request from a
                // partially-paid one (both looked identically "queued"). Never
                // "paid" here: that only happens when queuedUnits === 0, which
                // skips this block entirely.
                status: cashQuote.status,
                createdAt: new Date(),
                updatedAt: new Date(),
              },
              s
            );
            if (compensate) {
              undo.push(async () => {
                await db.collection("indexFundRedemptionQueue").deleteOne({ _id: queueEntryId });
              });
            }

            const queuedTxId = await insertFundTransaction(
              db,
              {
                fundId: fundState._id,
                kind: "redemption_queued",
                holderKind: "character",
                characterId,
                units: cashQuote.queuedUnits,
                navAnchor: fundState.quotedNav,
                amountAnchor: cashQuote.queuedAmountAnchor,
                note: "Queued pending fund liquidity",
                createdAt: new Date(),
              },
              s
            );
            if (compensate) {
              undo.push(async () => {
                await db.collection("indexFundTransactions").deleteOne({ _id: queuedTxId });
              });
            }
          }

          const finalStatus: "paid" | "partial" | "queued" =
            cashQuote.queuedUnits === 0 ? "paid" : totalRedeemedUnits > 0 ? "partial" : "queued";

          result = {
            redeemedUnits: totalRedeemedUnits,
            paidAmountAnchor: totalPaidAnchor,
            queuedUnits: cashQuote.queuedUnits,
            queuedAmountAnchor: cashQuote.queuedAmountAnchor,
            status: finalStatus,
            payoutLogs,
            finalNavAnchor: fundState.quotedNav,
            redeemFxRate: blendedRedeemFxRate,
            ...(sharesSoldForLiquidity > 0 ? { sharesSoldForLiquidity } : {}),
          };
        };

        // Thin wrapper: run the body and, on the standalone (non-atomic) path,
        // unwind every leg it applied in reverse order. A failure in the unwind
        // itself is reported as an AggregateError so the caller never treats a
        // partially-applied redemption as a clean abort.
        const runRedemption = async (sess?: import("mongodb").ClientSession) => {
          const compensate = !sess;
          const undo: Array<() => Promise<void>> = [];
          try {
            await runRedemptionBody(sess, compensate, undo);
          } catch (error) {
            if (!compensate || undo.length === 0) throw error;
            const compensationErrors: unknown[] = [];
            while (undo.length > 0) {
              const revert = undo.pop()!;
              try {
                await revert();
              } catch (compensationError) {
                compensationErrors.push(compensationError);
              }
            }
            if (compensationErrors.length > 0) {
              throw new AggregateError(
                [error, ...compensationErrors],
                `Redemption failed and ${compensationErrors.length} compensation step(s) were incomplete`
              );
            }
            throw error;
          }
          const {
            payoutLogs: _logs,
            finalNavAnchor: _nav,
            redeemFxRate: _fx,
            ...response
          } = result!;
          await completeFundCommand(db, command.key, { success: true, ...response }, 200, sess, {
            fundId: fund._id,
            fundName: fund.name,
            fundSlug: fund.slug,
            fundTicker: fund.tickerSymbol,
            currencyCode: fundCurrency,
            holderId: characterId,
            holderName: character.name,
            turn: auditTurn,
            entries: result!.payoutLogs.map((payout) => ({
              transactionId: payout.transactionId,
              amountNative: forexEnabled
                ? payout.amountAnchor * result!.redeemFxRate
                : payout.amountAnchor,
            })),
          });
        };

        try {
          // No session (standalone Mongo, probed by the helper): without a
          // transaction to serialize concurrent redemptions, take the fund's
          // redemption lock, exactly like the code 20/263 path below.
          const lockBusy = await runTransactionWithSessionRetry(
            async () => db.client,
            async (session) => {
              if (session) {
                await runRedemption(session);
                return false;
              }
              const releaseLock = await claimFundRedemptionLock(db, fund._id);
              if (!releaseLock) return true;
              try {
                await runRedemption();
              } finally {
                await releaseLock();
              }
              return false;
            }
          );
          if (lockBusy) {
            return errorResponse(
              409,
              "Another redemption for this fund is still processing. Try again."
            );
          }
        } catch (err) {
          if (err instanceof Error && err.message === "FUND_CASH_RACE") {
            // Another redemption took the cash between the quote and the debit.
            // Nothing was written, so the caller can simply retry.
            return errorResponse(409, "Another redemption drew this fund's cash first. Try again.");
          } else {
            throw err;
          }
        }

        logIndexFundRedeemActivity(db, {
          fund,
          holder: holderContext,
          requestedUnits: units,
          redeemedUnits: result!.redeemedUnits,
          paidAmountAnchor: result!.paidAmountAnchor,
          navAnchor: result!.finalNavAnchor,
          queuedUnits: result!.queuedUnits,
          turn: auditTurn,
        });

        recordAudit({
          source: "api",
          action: "fund.sell",
          category: "market",
          subject: { type: "investmentFund", id: fund._id, name: fund.name ?? fund.slug },
          counterparty: { type: "character", id: characterId, name: character.name },
          amount: result!.paidAmountAnchor,
          currencyCode: fundCurrency,
          anchorAmount: result!.paidAmountAnchor,
          delta: [
            { field: "status", before: null, after: result!.status },
            { field: "redeemedUnits", before: null, after: result!.redeemedUnits },
            { field: "queuedUnits", before: null, after: result!.queuedUnits },
          ],
          outcome: "ok",
        });

        const {
          payoutLogs: _payoutLogs,
          finalNavAnchor: _finalNav,
          redeemFxRate: _redeemFxRate,
          ...response
        } = result!;
        return NextResponse.json({ success: true, ...response });
      }
    };
    const response = await execute();
    await completeFundCommand(db, command.key, await response.clone().json(), response.status);
    await resumeFundCommandAudit(db, command.key);
    return response;
  } catch (error) {
    const failure = handleRouteError(error);
    if (claimedOperationId) return pendingFundCommandResponse(claimedOperationId);
    return failure;
  }
}
