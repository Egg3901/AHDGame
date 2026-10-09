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
import { getDb } from "@/lib/mongodb";
import { getAuthUserWithCharacter } from "@/lib/auth";
import { handleRouteError, notFound, errorResponse } from "@/lib/api/errors";
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
  creditFundPosition,
  getPosition,
  insertFundTransaction,
} from "@/lib/indexFunds/fundQueries";
import { quoteIndexFundSubscription } from "@/lib/indexFunds/unitAccounting";
import {
  atomicallyDebitCharacterCash,
  refundCharacterCash,
} from "@/lib/financialTxLog/atomicCashGuard";
import { loadCharacterFxRate } from "@/lib/currency/characterFunds";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { autoConvertForPurchase, convertForExplicitPay } from "@/lib/currency/autoConvert";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { GameState } from "@/lib/db/types";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { logIndexFundSubscribeActivity } from "@/lib/indexFunds/fundTxLog";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { subscribeIndexFundSchema } from "@/lib/api/schemas/indexFunds";
import { recordAudit } from "@/lib/audit/recordAudit";

// POST /api/investment-funds/[slug]/subscribe — Subscribe (buy) fund units
// Auth: logged-in user with a character
// Requires "full" mode — partial mode blocks player transactions.
// Debits character's personal balance in the fund's anchor currency.
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

    const parsed = await parseJsonBody(request, subscribeIndexFundSchema);
    if (!parsed.success) {
      return errorResponse(parsed.status, parsed.error);
    }
    const { units, operationId, payCurrency } = parsed.data;
    if (parsed.data.corporationId)
      return tradeCorporationFund(
        db,
        auth.userId,
        characterId,
        fund,
        { ...parsed.data, corporationId: parsed.data.corporationId },
        "subscribe"
      );
    claimedOperationId = operationId;
    const command = await claimFundCommand(db, characterId, operationId, {
      fundId: fund._id.toHexString(),
      kind: "subscribe",
      units,
      ...(payCurrency ? { payCurrency } : {}),
    });
    if (command.response) return command.response;
    const execute = async () => {
      if (!(await isIndexFundsEnabled())) {
        return errorResponse(403, INDEX_FUNDS_DISABLED_MESSAGE);
      }
      if (!(await isIndexFundsFullMode())) {
        return errorResponse(403, INDEX_FUNDS_PARTIAL_MESSAGE);
      }

      if (fund.status !== "active") {
        return errorResponse(400, "Fund is not accepting subscriptions");
      }

      const quote = quoteIndexFundSubscription(fund.quotedNav, units);
      const totalCostAnchor = quote.costAnchor;
      const fundCurrency = fund.anchorCurrencyCode as CurrencyCode;
      const character = auth.character!;
      const auditTurn = await getCurrentTurn(db);

      // All accounting legs are committed together below.
      const forexEnabled = await isForexEnabled();

      // `quotedNav`/`costAnchor` are denominated in ₳; the character's wallet is
      // held in the fund's native currency. Convert ₳ → native (× rate) before
      // charging, exactly as the share-trading path does (`buyPublicShares`
      // costInHome). Skipping this undercharges/overcharges every fund whose
      // currency rate ≠ 1 (JPY ~107×, CNY ~8×, GBP ~1.5×). `cashAnchor` and the
      // transaction `amountAnchor` stay in ₳ — only the wallet legs are native.
      let fundFxRate = 1.0;
      if (forexEnabled) {
        const fxResult = await loadCharacterFxRate(db, fundCurrency);
        if (!fxResult.ok) {
          return errorResponse(503, "Exchange rate unavailable, try again shortly");
        }
        fundFxRate = fxResult.rate;
      }
      const totalCostNative = forexEnabled ? totalCostAnchor * fundFxRate : totalCostAnchor;

      await recordFundCommandQuote(db, command.key, {
        turn: auditTurn,
        navAnchor: fund.quotedNav,
        costAnchor: totalCostAnchor,
        costNative: totalCostNative,
        fundCurrency,
        fundFxRate,
        forexEnabled,
      });

      let subscribeSpreadCharged = 0;
      if (forexEnabled) {
        const gs = await db.collection<GameState>("gameState").findOne({ _id: "current" });
        if (payCurrency && payCurrency !== fundCurrency) {
          const convertResult = await convertForExplicitPay(db, {
            character,
            payCurrency,
            requiredCurrency: fundCurrency,
            requiredAmount: totalCostNative,
            turn: gs?.currentTurn ?? 0,
            forexEnabled,
          });
          if (!convertResult.success) {
            return errorResponse(400, convertResult.error);
          }
          subscribeSpreadCharged = convertResult.spreadCharged;
        } else {
          const convertResult = await autoConvertForPurchase(db, {
            character,
            requiredCurrency: fundCurrency,
            requiredAmount: totalCostNative,
            turn: gs?.currentTurn ?? 0,
            forexEnabled,
          });
          if (convertResult.needed && !convertResult.success) {
            return errorResponse(400, convertResult.error);
          }
          subscribeSpreadCharged = convertResult.spreadCharged;
        }
      }

      // Shared logic: debit cash, mint units, credit fund cash, record transaction.
      //
      // On the standalone path (no session) there is no transaction to roll back,
      // so every leg applied before a failure is undone in reverse order. With a
      // real session the transaction aborts and there is nothing to compensate.
      const applySubscription = async (
        session?: import("mongodb").ClientSession,
        compensateStandaloneFailure = false
      ) => {
        const mongoOpts = session ? { session } : undefined;
        const priorPosition = await getPosition(
          db,
          fund._id,
          "character",
          { characterId },
          mongoOpts
        );

        const debitResult = await atomicallyDebitCharacterCash(
          db,
          characterId,
          fundCurrency,
          totalCostNative,
          forexEnabled,
          mongoOpts
        );

        if (!debitResult.ok) {
          return { error: debitResult.error };
        }

        let transactionId: ObjectId;
        let positionCredited = false;
        let fundCredited = false;
        try {
          // Mint units to holder position.
          await creditFundPosition(
            db,
            fund._id,
            "character",
            { characterId },
            units,
            fund.quotedNav,
            mongoOpts
          );
          positionCredited = true;

          // Increment fund unit supply and cash anchor.
          await db.collection("indexFunds").updateOne(
            { _id: fund._id },
            {
              $inc: { unitSupply: units, cashAnchor: totalCostAnchor },
              $set: { updatedAt: new Date() },
            },
            mongoOpts
          );
          fundCredited = true;

          // Record the subscription transaction.
          transactionId = await insertFundTransaction(
            db,
            {
              fundId: fund._id,
              kind: "subscription",
              holderKind: "character",
              characterId,
              units,
              navAnchor: fund.quotedNav,
              amountAnchor: totalCostAnchor,
              createdAt: new Date(),
            },
            mongoOpts
          );
        } catch (error) {
          if (!compensateStandaloneFailure) throw error;
          const compensationErrors: unknown[] = [];
          const compensate = async (revert: () => Promise<void>) => {
            try {
              await revert();
            } catch (compensationError) {
              compensationErrors.push(compensationError);
            }
          };
          // Reverse in the exact reverse of the apply order.
          if (fundCredited) {
            await compensate(async () => {
              await db.collection("indexFunds").updateOne(
                { _id: fund._id },
                {
                  $inc: { unitSupply: -units, cashAnchor: -totalCostAnchor },
                  $set: { updatedAt: new Date() },
                }
              );
            });
          }
          if (positionCredited) {
            await compensate(async () => {
              const positions = db.collection("indexFundPositions");
              if (!priorPosition) {
                await positions.deleteOne({
                  fundId: fund._id,
                  holderKind: "character",
                  characterId,
                });
                return;
              }
              await positions.replaceOne({ _id: priorPosition._id }, priorPosition, {
                upsert: true,
              });
            });
          }
          await compensate(async () => {
            await refundCharacterCash(db, characterId, fundCurrency, totalCostNative, forexEnabled);
          });
          if (compensationErrors.length > 0) {
            throw new AggregateError(
              [error, ...compensationErrors],
              `Index fund subscription failed and ${compensationErrors.length} compensation step(s) were incomplete`
            );
          }
          throw error;
        }

        const result = {
          units,
          costAnchor: totalCostAnchor,
          nav: fund.quotedNav,
          balanceAfter: debitResult.newBalance,
        };
        await completeFundCommand(
          db,
          command.key,
          {
            success: true,
            ...result,
            spreadPaid: Math.round(subscribeSpreadCharged * 100) / 100,
          },
          200,
          session,
          {
            fundId: fund._id,
            fundName: fund.name,
            fundSlug: fund.slug,
            fundTicker: fund.tickerSymbol,
            currencyCode: fundCurrency,
            holderId: characterId,
            holderName: character.name,
            turn: auditTurn,
            entries: [
              {
                transactionId,
                amountNative: -totalCostNative,
                balanceAfter: debitResult.newBalance,
              },
            ],
          }
        );
        return { result };
      };

      // Try transactional path first; fall back to sequential writes if the
      // MongoDB instance doesn't support transactions (non-replica-set).
      {
        let subscriptionResult:
          { units: number; costAnchor: number; nav: number; balanceAfter: number } | undefined;
        let debitError: string | null = null;

        await runTransactionWithSessionRetry(
          async () => db.client,
          async (session) => {
            // `session` is undefined on the standalone fallback path, where a
            // partial write must be compensated by hand.
            const outcome = await applySubscription(session, !session);
            if (outcome.error) debitError = outcome.error;
            else subscriptionResult = outcome.result;
          }
        );

        if (debitError) {
          return errorResponse(
            400,
            debitError === "Insufficient funds"
              ? `Insufficient funds. Need ${totalCostAnchor.toLocaleString(undefined, { minimumFractionDigits: 2 })} ${fundCurrency}.`
              : debitError
          );
        }

        logIndexFundSubscribeActivity(db, {
          fund,
          holder: {
            holderKind: "character",
            holderId: characterId,
            holderName: character.name,
            userId: new ObjectId(auth.userId),
            username: auth.username,
            countryId: character.countryId,
          },
          units: subscriptionResult!.units,
          navAnchor: subscriptionResult!.nav,
          amountAnchor: subscriptionResult!.costAnchor,
          amountNative: totalCostNative,
          balanceAfter: subscriptionResult!.balanceAfter,
          source: "player",
          turn: auditTurn,
        });

        recordAudit({
          source: "api",
          action: "fund.buy",
          category: "market",
          subject: { type: "investmentFund", id: fund._id, name: fund.name ?? fund.slug },
          counterparty: { type: "character", id: characterId, name: character.name },
          amount: -subscriptionResult!.costAnchor,
          currencyCode: fundCurrency,
          anchorAmount: -subscriptionResult!.costAnchor,
          delta: [
            { field: "units", before: null, after: subscriptionResult!.units },
            { field: "nav", before: null, after: subscriptionResult!.nav },
          ],
          outcome: "ok",
        });

        return NextResponse.json({
          success: true,
          ...subscriptionResult!,
          spreadPaid: Math.round(subscribeSpreadCharged * 100) / 100,
        });
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
