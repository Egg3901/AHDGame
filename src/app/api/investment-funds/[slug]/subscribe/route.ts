import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { getAuthUserWithCharacter } from "@/lib/auth";
import { handleRouteError, notFound } from "@/lib/api/errors";
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
  insertFundTransaction,
} from "@/lib/indexFunds/fundQueries";
import { quoteIndexFundSubscription } from "@/lib/indexFunds/unitAccounting";
import { atomicallyDebitCharacterCash } from "@/lib/financialTxLog/atomicCashGuard";
import { loadCharacterFxRate } from "@/lib/currency/characterFunds";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { autoConvertForPurchase, convertForExplicitPay } from "@/lib/currency/autoConvert";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { GameState } from "@/lib/db/types";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { logIndexFundSubscribe } from "@/lib/indexFunds/fundTxLog";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { subscribeIndexFundSchema } from "@/lib/api/schemas/indexFunds";
import { recordAudit } from "@/lib/audit/recordAudit";

// POST /api/investment-funds/[slug]/subscribe — Subscribe (buy) fund units
// Auth: logged-in user with a character
// Requires "full" mode — partial mode blocks player transactions.
// Debits character's personal balance in the fund's anchor currency.
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

    const { slug } = await params;
    const fund = await resolveFundBySlugOrId(db, slug);
    if (!fund) throw notFound("Fund not found");
    if (fund.status !== "active") {
      return NextResponse.json({ error: "Fund is not accepting subscriptions" }, { status: 400 });
    }

    const parsed = await parseJsonBody(request, subscribeIndexFundSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { units, payCurrency } = parsed.data;

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
        return NextResponse.json(
          { error: "Exchange rate unavailable, try again shortly" },
          { status: 503 }
        );
      }
      fundFxRate = fxResult.rate;
    }
    const totalCostNative = forexEnabled ? totalCostAnchor * fundFxRate : totalCostAnchor;

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
          return NextResponse.json({ error: convertResult.error }, { status: 400 });
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
          return NextResponse.json({ error: convertResult.error }, { status: 400 });
        }
        subscribeSpreadCharged = convertResult.spreadCharged;
      }
    }

    // Shared logic: debit cash, mint units, credit fund cash, record transaction.
    const applySubscription = async (session?: import("mongodb").ClientSession) => {
      const mongoOpts = session ? { session } : undefined;

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

      // Increment fund unit supply and cash anchor.
      await db.collection("indexFunds").updateOne(
        { _id: fund._id },
        {
          $inc: { unitSupply: units, cashAnchor: totalCostAnchor },
          $set: { updatedAt: new Date() },
        },
        mongoOpts
      );

      // Record the subscription transaction.
      await insertFundTransaction(
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

      return {
        result: {
          units,
          costAnchor: totalCostAnchor,
          nav: fund.quotedNav,
          balanceAfter: debitResult.newBalance,
        },
      };
    };

    // Try transactional path first; fall back to sequential writes if the
    // MongoDB instance doesn't support transactions (non-replica-set).
    const session = db.client.startSession();
    try {
      let subscriptionResult:
        { units: number; costAnchor: number; nav: number; balanceAfter: number } | undefined;
      let debitError: string | null = null;

      try {
        await session.withTransaction(async () => {
          const outcome = await applySubscription(session);
          if (outcome.error) debitError = outcome.error;
          else subscriptionResult = outcome.result;
        });
      } catch (err) {
        const code = (err as { code?: number } | undefined)?.code;
        if (code === 20 || code === 263) {
          // No replica set — fall back to sequential writes.
          const outcome = await applySubscription();
          if (outcome.error) debitError = outcome.error;
          else subscriptionResult = outcome.result;
        } else {
          throw err;
        }
      }

      if (debitError) {
        return NextResponse.json(
          {
            error:
              debitError === "Insufficient funds"
                ? `Insufficient funds. Need ${totalCostAnchor.toLocaleString(undefined, { minimumFractionDigits: 2 })} ${fundCurrency}.`
                : debitError,
          },
          { status: 400 }
        );
      }

      void logIndexFundSubscribe(db, {
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
    } finally {
      await session.endSession();
    }
  } catch (error) {
    return handleRouteError(error);
  }
}
