import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { getAuthUserWithCharacter } from "@/lib/auth";
import { badRequest, handleRouteError, notFound } from "@/lib/api/errors";
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
import { logIndexFundRedeem, logIndexFundRedeemActivity } from "@/lib/indexFunds/fundTxLog";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { getQueuedRedemptionLiabilityAnchor } from "@/lib/indexFunds/fundValuation";
import { recordAudit } from "@/lib/audit/recordAudit";
import { rejectDuringTurn } from "@/lib/api/rejectDuringTurn";
import { claimFundRedemptionLock } from "@/lib/indexFunds/redemptionLock";

const redeemSchema = z.object({
  units: z.number().int().min(1),
});

// POST /api/investment-funds/[slug]/redeem — Redeem (sell) fund units
// Auth: logged-in user with a character
// Requires "full" mode — partial mode blocks player transactions.
// Pays from fund cash, sells underlying shares to public float when needed,
// then queues any remainder for the hourly fund cycle.
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const auth = await getAuthUserWithCharacter();
    if (!auth) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

    const rateLimit = checkRateLimit(auth.userId, 10, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const characterId = auth.character?._id;
    if (!characterId) {
      return NextResponse.json({ error: "No active character" }, { status: 400 });
    }

    const db = await getDb();
    if (!(await isIndexFundsEnabled())) {
      return NextResponse.json({ error: INDEX_FUNDS_DISABLED_MESSAGE }, { status: 403 });
    }
    if (!(await isIndexFundsFullMode())) {
      return NextResponse.json({ error: INDEX_FUNDS_PARTIAL_MESSAGE }, { status: 403 });
    }
    const turnGuard = await rejectDuringTurn(db);
    if (turnGuard) return turnGuard;

    const { slug } = await params;
    const fund = await resolveFundBySlugOrId(db, slug);
    if (!fund) throw notFound("Fund not found");
    if (fund.status === "delisted") {
      return NextResponse.json({ error: "Fund is delisted" }, { status: 400 });
    }

    const parsed = await parseJsonBody(request, redeemSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { units } = parsed.data;

    const position = await getPosition(db, fund._id, "character", { characterId });
    if (!position || position.units < units) {
      return NextResponse.json(
        { error: `Insufficient units. You hold ${position?.units ?? 0} units.` },
        { status: 400 }
      );
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
        return NextResponse.json(
          { error: "Exchange rate unavailable, try again shortly" },
          { status: 503 }
        );
      }
      fundFxRate = fxResult.rate;
    }

    const session = db.client.startSession();
    try {
      let result:
        | {
            redeemedUnits: number;
            paidAmountAnchor: number;
            queuedUnits: number;
            queuedAmountAnchor: number;
            status: "paid" | "partial" | "queued";
            sharesSoldForLiquidity?: number;
            payoutLogs: Array<{ units: number; amountAnchor: number; navAnchor: number }>;
            finalNavAnchor: number;
            /** ₳ → fund-currency rate the payouts were credited at. */
            redeemFxRate: number;
          }
        | undefined;

      const runRedemption = async (sess?: import("mongodb").ClientSession) => {
        const s = sess ? { session: sess } : undefined;
        // Guarded debit: a concurrent redemption may have drained the position
        // since the pre-check above — never pay out units that weren't debited.
        const debit = await debitFundPosition(db, fund._id, "character", { characterId }, units, s);
        if (!debit.ok) {
          throw badRequest("Insufficient units — your position changed, please retry.");
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
        const payoutLogs: Array<{ units: number; amountAnchor: number; navAnchor: number }> = [];

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

          const creditInc = buildPersonalBalanceInc(
            forexEnabled ? quote.paidAmountAnchor * blendedRedeemFxRate : quote.paidAmountAnchor,
            fundState!.anchorCurrencyCode,
            forexEnabled
          );
          await db
            .collection("characters")
            .updateOne(
              { _id: characterId },
              { $inc: creditInc, $set: { updatedAt: new Date() } },
              s
            );

          await insertFundTransaction(
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

          totalRedeemedUnits += quote.redeemableUnits;
          totalPaidAnchor += quote.paidAmountAnchor;
          payoutLogs.push({
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
          await enqueueRedemption(
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

          await insertFundTransaction(
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

      try {
        await session.withTransaction(async () => await runRedemption(session));
      } catch (err) {
        const code = (err as { code?: number } | undefined)?.code;
        if (code === 20 || code === 263) {
          const releaseLock = await claimFundRedemptionLock(db, fund._id);
          if (!releaseLock) {
            return NextResponse.json(
              { error: "Another redemption for this fund is still processing. Try again." },
              { status: 409 }
            );
          }
          try {
            await runRedemption();
          } finally {
            await releaseLock();
          }
        } else if (err instanceof Error && err.message === "FUND_CASH_RACE") {
          // Another redemption took the cash between the quote and the debit.
          // Nothing was written, so the caller can simply retry.
          return NextResponse.json(
            { error: "Another redemption drew this fund's cash first. Try again." },
            { status: 409 }
          );
        } else {
          throw err;
        }
      }

      for (const payout of result!.payoutLogs) {
        void logIndexFundRedeem(db, {
          fund,
          holder: holderContext,
          units: payout.units,
          navAnchor: payout.navAnchor,
          amountAnchor: payout.amountAnchor,
          amountNative: forexEnabled
            ? payout.amountAnchor * result!.redeemFxRate
            : payout.amountAnchor,
          source: "player",
          turn: auditTurn,
        });
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
    } finally {
      await session.endSession();
    }
  } catch (error) {
    return handleRouteError(error);
  }
}
