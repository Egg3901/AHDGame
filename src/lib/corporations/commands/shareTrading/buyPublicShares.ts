import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { ObjectId } from "mongodb";
import { MoneyFlowKeyConflictError, MoneyFlowTerminalError } from "@/lib/db/nonAtomicMoneyFlow";
import { requireCorporationActionsEnabled } from "@/lib/api/requireCorporationActions";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { buySharesSchema } from "@/lib/api/schemas/corporations";
import { handleRouteError } from "@/lib/api/errors";
import {
  corpPurchaseWouldCycle,
  OWNERSHIP_CYCLE_ERROR,
} from "@/lib/corporations/subsidiaries/cycleGuard";
import { resolveCorporation } from "@/lib/api/corporations/resolveQuery";
import { assertCeoTradeNotBlocked } from "@/lib/corporations/commands/privatization/openVoteGuard";
import type { Character, Corporation, User } from "@/lib/db/types";
import type { ImperialCharacter } from "@/lib/db/types/imperialCharacter";
import { logEconomicAction } from "@/lib/corporations/economicActionLog";
import { personalBalanceField } from "@/lib/corporations/commands/shareTrading/shareFillMoney";
import {
  executePublicShareTradeFlow,
  getStoredPublicShareTradeResponse,
  recoverPublicShareTradeByKey,
  type PublicShareTradePlan,
} from "@/lib/corporations/commands/shareTrading/publicShareTradeSpend";
import type { ShareOrderPlacementDealer } from "@/lib/corporations/shareOrderPlacement";
import { getShareBuybackMode } from "@/lib/corporations/shareBuybackMode";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { getHomeCurrency, loadCharacterFxRate } from "@/lib/currency/characterFunds";
import {
  anchorToCorpLiquidCapital,
  estimateCorpWalletSpend,
  getCorpFxRate,
  loadFxRatesRecord,
  resolveCorpLiquidCurrencyCode,
  shareTradeAnchorValue,
} from "@/lib/currency/corporationCapital";
import { autoConvertForPurchase, convertForExplicitPay } from "@/lib/currency/autoConvert";
import { notifyHostileTakeoverThresholdIfEligible } from "@/lib/corporations/hostileTakeoverNotifications";
import { isOrderFlowPriceEligible } from "@/lib/corporations/marketExecution";
import { loadEquityQuote } from "@/lib/equities/marketPool";
import { isOrderFlowWashRoundTrip } from "@/lib/corporations/orderFlowWashGuard";
import { CURRENCY_SYMBOLS } from "@/lib/constants/currencies";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { GameState } from "@/lib/db/types";
import { assertCeoAcquisitionWithinCap } from "@/lib/corporations/ceoShareAcquisitionCap";
import { rejectDuringTurn } from "@/lib/api/rejectDuringTurn";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/** Maps keyed-flow claim failures onto the legacy 409 surface. */
function mapTradeKeyError(error: unknown): NextResponse {
  if (error instanceof MoneyFlowTerminalError) {
    return NextResponse.json(
      { error: "Trade already settled; start a new attempt with a new key." },
      { status: 409 }
    );
  }
  if (error instanceof MoneyFlowKeyConflictError) {
    return NextResponse.json(
      { error: "Idempotency key was reused for a different transfer." },
      { status: 409 }
    );
  }
  throw error;
}

async function runTradeKeyRecovery(
  db: import("mongodb").Db,
  tradeKey: string
): Promise<NextResponse> {
  try {
    const recovered = await recoverPublicShareTradeByKey(db, tradeKey);
    if (!recovered.ok) {
      return NextResponse.json({ error: recovered.error }, { status: recovered.status });
    }
    return NextResponse.json(recovered.body);
  } catch (error) {
    return mapTradeKeyError(error);
  }
}

/**
 * POST /api/corporations/[id]/shares/buy
 * Buy shares from the public float at current market price.
 * When buyAsCorporation is true, uses the caller's corporation's liquidCapital.
 * auth: requireBasicAuth (both paths)
 * errors: 400 insufficient funds/float, 403 not CEO, 404 corp not found
 */
export async function buyPublicShares(request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    const parsed = await parseJsonBody(request, buySharesSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const { shares, buyAsCorporation, payCurrency } = parsed.data;

    // Crash-safe float trades (issue #1672): the buyer debit, the float and
    // cap-table writes, and the issuer credit run as keyed idempotent steps.
    // `Idempotency-Key` replays the stored outcome without moving money again.
    const headerKey = request.headers.get("Idempotency-Key");
    if (headerKey !== null && (headerKey.length === 0 || headerKey.length > 128)) {
      return NextResponse.json({ error: "Invalid Idempotency-Key header" }, { status: 400 });
    }

    // Same-key retry: the first attempt already validated, so reconcile
    // through the stored plan instead of re-running the guards (which
    // post-debit reads would fail). Runs before the action/turn guards so
    // crash recovery converges even while fresh trades are blocked.
    if (headerKey !== null) {
      const dbForReplay = await getDb();
      const prior = await getStoredPublicShareTradeResponse(dbForReplay, headerKey);
      if (prior) {
        return runTradeKeyRecovery(dbForReplay, headerKey);
      }
    }

    if (buyAsCorporation) {
      // ── Corp buy path ─────────────────────────────────────────────
      const corpAuth = await requireBasicAuth();
      if (!corpAuth.ok) return corpAuth.response;

      const rateLimit = checkRateLimit(`corp-buy:${corpAuth.user.userId}`, 20, 60000);
      if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

      const db = await getDb();
      const corpGuard = await requireCorporationActionsEnabled(db);
      if (corpGuard) return corpGuard;
      const turnGuard = await rejectDuringTurn(db);
      if (turnGuard) return turnGuard;

      const resolved = await resolveCorporation(db, id);
      if (!resolved.ok) return resolved.response;
      const { corporation } = resolved;
      const marketQuote = await loadEquityQuote(db, corporation);
      const executionPrice = marketQuote.askPriceLocal;
      const orderFlowEligible = isOrderFlowPriceEligible(
        corporation.publicFloat,
        corporation.totalShares
      );

      const publicFloat = corporation.publicFloat ?? 0;
      if (publicFloat < shares) {
        return NextResponse.json(
          { error: `Only ${publicFloat.toLocaleString()} shares available in public float` },
          { status: 400 }
        );
      }

      // Resolve CEO identity from correct collection
      const corpUserDoc = await db
        .collection<User>("users")
        .findOne({ _id: new ObjectId(corpAuth.user.userId) });
      const isCeoImperial =
        corpUserDoc?.activeCharacterType === "imperial" && !!corpUserDoc?.activeImperialCharacterId;

      let ceoId: ObjectId;
      if (isCeoImperial) {
        const imperial = await db.collection<ImperialCharacter>("imperialCharacters").findOne({
          _id: corpUserDoc!.activeImperialCharacterId!,
          userId: new ObjectId(corpAuth.user.userId),
        });
        if (!imperial) {
          return NextResponse.json({ error: "Imperial character not found" }, { status: 404 });
        }
        ceoId = imperial._id;
      } else {
        const characterQuery = corpUserDoc?.activeCharacterId
          ? { _id: corpUserDoc.activeCharacterId, userId: new ObjectId(corpAuth.user.userId) }
          : { userId: new ObjectId(corpAuth.user.userId) };
        const character = await db.collection<Character>("characters").findOne(characterQuery);
        if (!character) {
          return NextResponse.json({ error: "Character not found" }, { status: 404 });
        }
        ceoId = character._id;
      }

      // Look up the buying corporation (caller must be CEO)
      const buyingCorp = await db
        .collection<Corporation>("corporations")
        .findOne({ ceoId, ceoVacant: { $ne: true } });
      if (!buyingCorp) {
        return NextResponse.json(
          { error: "You must be a CEO to buy shares on behalf of a corporation" },
          { status: 403 }
        );
      }
      if (buyingCorp._id.equals(corporation._id)) {
        return NextResponse.json(
          { error: "A corporation cannot purchase its own shares" },
          { status: 400 }
        );
      }
      if (buyingCorp.countryOwnerId) {
        return NextResponse.json(
          { error: "National corporations cannot hold equity positions" },
          { status: 400 }
        );
      }

      if (await corpPurchaseWouldCycle(db, buyingCorp._id, corporation._id)) {
        return NextResponse.json({ error: OWNERSHIP_CYCLE_ERROR }, { status: 400 });
      }

      // sharePrice is stored in the target corp's liquidCurrencyCode (v0.2.6).
      // Normalize through ₳ before converting to the buyer's currency — direct
      // multiplication by the buyer's FX rate would double-convert.
      const buyingCurrency = (resolveCorpLiquidCurrencyCode(buyingCorp) ?? "USD") as CurrencyCode;
      const targetCurrency = (resolveCorpLiquidCurrencyCode(corporation) ?? "USD") as CurrencyCode;
      const fxRates = await loadFxRatesRecord(db);
      const targetFxRate =
        fxRates[targetCurrency] && fxRates[targetCurrency]! > 0 ? fxRates[targetCurrency]! : 1;
      const cost = shareTradeAnchorValue(
        shares,
        { ...corporation, sharePrice: executionPrice },
        targetFxRate
      );
      const corpPurchaseEstimate = estimateCorpWalletSpend({
        requiredAmount: shares * executionPrice,
        availableBalance: buyingCorp.liquidCapital ?? 0,
        fromCurrency: buyingCurrency,
        toCurrency: targetCurrency,
        rates: fxRates,
      });
      if (!corpPurchaseEstimate) {
        return NextResponse.json(
          { error: "Exchange rate unavailable, try again shortly" },
          { status: 503 }
        );
      }
      const costInBuyerCapital =
        buyingCurrency !== targetCurrency
          ? corpPurchaseEstimate.spendAmount
          : anchorToCorpLiquidCapital(cost, buyingCorp, fxRates[buyingCurrency] ?? 1);

      const now = new Date();
      const currentTurn = await getCurrentTurn(db);
      const tradeKey = headerKey ?? randomUUID();

      // Pinned legacy guard surface: the keyed buyer-debit step re-guards
      // the same balance condition at apply time and reports this exact
      // string, computed from pre-debit reads like the legacy check.
      const buySym = CURRENCY_SYMBOLS[buyingCurrency] ?? "$";
      const targetSym = CURRENCY_SYMBOLS[targetCurrency] ?? "$";
      const costStr = cost.toLocaleString(undefined, { minimumFractionDigits: 2 });
      const adjustedStr = costInBuyerCapital.toLocaleString(undefined, {
        minimumFractionDigits: 2,
      });
      const haveStr = (buyingCorp.liquidCapital ?? 0).toLocaleString(undefined, {
        minimumFractionDigits: 2,
      });
      const currencyNote =
        buyingCurrency !== targetCurrency
          ? ` (${buySym}${adjustedStr} ${buyingCurrency} incl. FX, corp has ${buySym}${haveStr} ${buyingCurrency})`
          : "";
      const debitError =
        buyingCurrency !== targetCurrency
          ? `Insufficient funds. Need ${targetSym}${costStr}${currencyNote}`
          : `Insufficient funds. Need ${targetSym}${costStr}, corp has ${buySym}${haveStr} ${buyingCurrency}`;

      // Wash-trade guard (see orderFlowWashGuard): a buy that round-trips this
      // corp's own recent sell contributes nothing to the order-flow window and
      // neutralizes the sell leg instead. Read-only; pinned into the plan.
      const washExcluded =
        orderFlowEligible &&
        (await isOrderFlowWashRoundTrip(
          db,
          corporation._id,
          { corporationId: buyingCorp._id },
          "buy",
          now
        ));

      // Treasury-backed market maker routing, pinned before the flow starts
      // (mirrors `applyFloatBuyCredit`): pool counterparty when the quote is
      // pool-backed, else the issuer escrow or treasury leg.
      const issuerBuyback = shares * executionPrice;
      let corpDealer: ShareOrderPlacementDealer;
      if (marketQuote.active) {
        corpDealer = {
          kind: "pool",
          currency: marketQuote.currency,
          amountLocal: issuerBuyback,
          flowKind: "purchasesIn",
        };
      } else if (getShareBuybackMode(corporation) === "escrow") {
        corpDealer = { kind: "escrow-credit", amountLocal: issuerBuyback };
      } else {
        corpDealer = { kind: "treasury", amountLocal: issuerBuyback };
      }

      const corpBuyPlan: PublicShareTradePlan = {
        version: 1,
        tradeKey,
        kind: "market-buy",
        corpIdHex: corporation._id.toHexString(),
        corpName: corporation.name,
        shares,
        executionPrice,
        turn: currentTurn,
        nowIso: now.toISOString(),
        orderFlowEligible,
        washExcluded,
        buyerDebit: {
          collection: "corporations",
          idHex: buyingCorp._id.toHexString(),
          field: "liquidCapital",
          amount: costInBuyerCapital,
        },
        capCredit: {
          field: "corporationId",
          idHex: buyingCorp._id.toHexString(),
          pricePerShare: executionPrice,
        },
        capDebit: null,
        proceedsLeg: null,
        dealer: corpDealer,
        ceoVacate: null,
        closeTenureHolderIdHex: null,
        tx: {
          type: "stock_trade_buy",
          subjectType: "corporation",
          subjectIdHex: buyingCorp._id.toHexString(),
          subjectName: buyingCorp.name,
          amount: -costInBuyerCapital,
          includeBalanceAfter: true,
          currencyCode: resolveCorpLiquidCurrencyCode(buyingCorp) ?? "USD",
          counterpartyType: "corporation",
          counterpartyIdHex: corporation._id.toHexString(),
          counterpartyName: corporation.name,
          meta: {
            corporationId: corporation._id.toString(),
            shares,
            pricePerShare: executionPrice,
          },
        },
        history: {
          kind: "market_buy",
          shares,
          pricePerShareAnchor: cost / shares,
          from: null,
          to: { corporationId: buyingCorp._id, name: buyingCorp.name },
          corpCurrencyCode: corporation.liquidCurrencyCode,
        },
        // Route the FX spread the corp already paid on a cross-currency share
        // buy into the CB system post-commit (reserve slice then revenue).
        // Previously this spread was destroyed.
        spread:
          buyingCurrency !== targetCurrency
            ? {
                fee: corpPurchaseEstimate.spreadFee,
                from: buyingCurrency,
                to: targetCurrency,
              }
            : null,
        audit: null,
        notifyTakeover: true,
        errors: {
          "buyer-debit": { message: debitError, status: 400 },
          float: { message: "Not enough shares remain in public float", status: 409 },
          "buyer-credit": { message: "Failed to record trade", status: 500 },
          dealer: { message: "Failed to record trade", status: 500 },
          "seller-debit": { message: "Failed to record trade", status: 500 },
          "proceeds-credit": { message: "Failed to record trade", status: 500 },
          history: { message: "Failed to record trade", status: 500 },
        },
        response: {
          success: true,
          sharesBought: shares,
          cost: Math.round(cost * 100) / 100,
          costInBuyerCurrency: Math.round(costInBuyerCapital * 100) / 100,
          buyerCurrency: buyingCurrency,
          pricePerShare: executionPrice,
          buyer: "corporation",
          buyerName: buyingCorp.name,
          // FX spread the corp paid on a cross-currency buy (0 when same currency).
          spreadPaid:
            buyingCurrency !== targetCurrency
              ? Math.round(corpPurchaseEstimate.spreadFee * 100) / 100
              : 0,
          spreadCurrency: buyingCurrency,
        },
      };

      let corpBuyResult;
      try {
        corpBuyResult = await executePublicShareTradeFlow(db, corpBuyPlan, {
          idempotencyKey: tradeKey,
        });
      } catch (error) {
        return mapTradeKeyError(error);
      }
      if (!corpBuyResult.ok) {
        return NextResponse.json({ error: corpBuyResult.error }, { status: corpBuyResult.status });
      }
      if (!corpBuyResult.replayed) {
        void notifyHostileTakeoverThresholdIfEligible(db, corporation._id);
        void logEconomicAction(db, {
          characterId: ceoId,
          userId: corpAuth.user.userId,
          actionType: "buyShares",
          turn: currentTurn,
          characterName: buyingCorp.name,
          username: corpUserDoc?.username,
          countryId: corporation.countryId,
          // `cost` is the total ₳ (anchor) purchase price (pricePerShareAnchor = cost/shares).
          corpCashCostAnchor: cost,
          currencyCode: corporation.liquidCurrencyCode,
          result: {
            success: true,
            message: `${buyingCorp.name} bought ${shares.toLocaleString()} shares of ${corporation.name}`,
          },
        }).catch(() => {});
      }
      return NextResponse.json(corpBuyResult.body);
    }

    // ── Character buy path (regular or imperial) ──────────────────────
    const basicAuth = await requireBasicAuth();
    if (!basicAuth.ok) return basicAuth.response;

    const rateLimit = checkRateLimit(basicAuth.user.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const [db, forexEnabled] = await Promise.all([getDb(), isForexEnabled()]);

    const corpGuard2 = await requireCorporationActionsEnabled(db);
    if (corpGuard2) return corpGuard2;
    const turnGuard = await rejectDuringTurn(db);
    if (turnGuard) return turnGuard;

    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;
    const marketQuote = await loadEquityQuote(db, corporation);
    const executionPrice = marketQuote.askPriceLocal;
    const orderFlowEligible = isOrderFlowPriceEligible(
      corporation.publicFloat,
      corporation.totalShares
    );

    const publicFloat = corporation.publicFloat ?? 0;
    if (publicFloat < shares) {
      return NextResponse.json(
        { error: `Only ${publicFloat.toLocaleString()} shares available in public float` },
        { status: 400 }
      );
    }

    const userDoc = await db
      .collection<User>("users")
      .findOne({ _id: new ObjectId(basicAuth.user.userId) });
    const isImperialMode =
      userDoc?.activeCharacterType === "imperial" && !!userDoc?.activeImperialCharacterId;

    // sharePrice is stored in the target corp's liquidCurrencyCode (v0.2.6);
    // normalize to ₳ before applying the character's home-currency FX.
    const targetFxRate = await getCorpFxRate(db, corporation);
    const cost = shareTradeAnchorValue(
      shares,
      { ...corporation, sharePrice: executionPrice },
      targetFxRate
    );

    if (isImperialMode) {
      // ── Imperial character share buy ────────────────────────────
      const imperial = await db.collection<ImperialCharacter>("imperialCharacters").findOne({
        _id: userDoc!.activeImperialCharacterId!,
        userId: new ObjectId(basicAuth.user.userId),
      });
      if (!imperial) {
        return NextResponse.json({ error: "Imperial character not found" }, { status: 404 });
      }
      const ceoCapImp = await assertCeoAcquisitionWithinCap(
        db,
        corporation,
        imperial._id,
        "imperialCharacterId",
        shares,
        await getCurrentTurn(db)
      );
      if (ceoCapImp) {
        return NextResponse.json({ error: ceoCapImp.error }, { status: ceoCapImp.status });
      }
      // Convert cost from ₳ to imperial character's home currency
      const imperialHomeCurrency = getHomeCurrency(imperial);
      let imperialFxRate = 1.0;
      if (forexEnabled) {
        const fxResult = await loadCharacterFxRate(db, imperialHomeCurrency);
        if (!fxResult.ok) {
          return NextResponse.json(
            { error: "Exchange rate unavailable, try again shortly" },
            { status: 503 }
          );
        }
        imperialFxRate = fxResult.rate;
      }
      const costInImperialHome = forexEnabled ? cost * imperialFxRate : cost;

      // Currency conversion: explicit pay-currency runs convertForExplicitPay;
      // otherwise honor character.autoConvertEnabled by consolidating other
      // wallets via autoConvertForPurchase (matches bond buy flow).
      if (forexEnabled) {
        const gs = await db.collection<GameState>("gameState").findOne({ _id: "current" });
        if (payCurrency && payCurrency !== imperialHomeCurrency) {
          const convertResult = await convertForExplicitPay(db, {
            character: imperial,
            payCurrency,
            requiredCurrency: imperialHomeCurrency,
            requiredAmount: costInImperialHome,
            turn: gs?.currentTurn ?? 0,
            forexEnabled,
            collectionName: "imperialCharacters",
          });
          if (!convertResult.success) {
            return NextResponse.json({ error: convertResult.error }, { status: 400 });
          }
        } else {
          const convertResult = await autoConvertForPurchase(db, {
            character: imperial,
            requiredCurrency: imperialHomeCurrency,
            requiredAmount: costInImperialHome,
            turn: gs?.currentTurn ?? 0,
            forexEnabled,
            collectionName: "imperialCharacters",
          });
          if (convertResult.needed && !convertResult.success) {
            return NextResponse.json({ error: convertResult.error }, { status: 400 });
          }
        }
      }

      const now = new Date();
      const imperialTurn = await getCurrentTurn(db);
      const imperialTradeKey = headerKey ?? randomUUID();

      // Wash-trade guard (see orderFlowWashGuard). Read-only; pinned below.
      const washExcluded =
        orderFlowEligible &&
        (await isOrderFlowWashRoundTrip(
          db,
          corporation._id,
          { imperialCharacterId: imperial._id },
          "buy",
          now
        ));

      const imperialIssuerBuyback = shares * executionPrice;
      let imperialDealer: ShareOrderPlacementDealer;
      if (marketQuote.active) {
        imperialDealer = {
          kind: "pool",
          currency: marketQuote.currency,
          amountLocal: imperialIssuerBuyback,
          flowKind: "purchasesIn",
        };
      } else if (getShareBuybackMode(corporation) === "escrow") {
        imperialDealer = { kind: "escrow-credit", amountLocal: imperialIssuerBuyback };
      } else {
        imperialDealer = { kind: "treasury", amountLocal: imperialIssuerBuyback };
      }

      const imperialBuyPlan: PublicShareTradePlan = {
        version: 1,
        tradeKey: imperialTradeKey,
        kind: "market-buy",
        corpIdHex: corporation._id.toHexString(),
        corpName: corporation.name,
        shares,
        executionPrice,
        turn: imperialTurn,
        nowIso: now.toISOString(),
        orderFlowEligible,
        washExcluded,
        buyerDebit: {
          collection: "imperialCharacters",
          idHex: imperial._id.toHexString(),
          field: personalBalanceField(imperialHomeCurrency, forexEnabled),
          amount: costInImperialHome,
        },
        capCredit: {
          field: "imperialCharacterId",
          idHex: imperial._id.toHexString(),
          pricePerShare: executionPrice,
        },
        capDebit: null,
        proceedsLeg: null,
        dealer: imperialDealer,
        ceoVacate: null,
        closeTenureHolderIdHex: null,
        tx: {
          type: "stock_trade_buy",
          subjectType: "character",
          subjectIdHex: imperial._id.toHexString(),
          subjectName: imperial.name,
          amount: -costInImperialHome,
          includeBalanceAfter: true,
          currencyCode: imperialHomeCurrency,
          counterpartyType: "corporation",
          counterpartyIdHex: corporation._id.toHexString(),
          counterpartyName: corporation.name,
          meta: {
            corporationId: corporation._id.toString(),
            shares,
            pricePerShare: executionPrice,
            imperial: true,
          },
        },
        history: {
          kind: "market_buy",
          shares,
          pricePerShareAnchor: cost / shares,
          from: null,
          to: { imperialCharacterId: imperial._id, name: imperial.name },
          corpCurrencyCode: corporation.liquidCurrencyCode,
        },
        spread: null,
        audit: null,
        notifyTakeover: true,
        errors: {
          "buyer-debit": {
            message: `Insufficient funds. Need ${costInImperialHome.toLocaleString(undefined, { minimumFractionDigits: 2 })} ${imperialHomeCurrency}.`,
            status: 400,
          },
          float: { message: "Not enough shares remain in public float", status: 409 },
          "buyer-credit": { message: "Failed to record trade", status: 500 },
          dealer: { message: "Failed to record trade", status: 500 },
          "seller-debit": { message: "Failed to record trade", status: 500 },
          "proceeds-credit": { message: "Failed to record trade", status: 500 },
          history: { message: "Failed to record trade", status: 500 },
        },
        response: {
          success: true,
          sharesBought: shares,
          cost: Math.round(cost * 100) / 100,
          pricePerShare: executionPrice,
        },
      };

      let imperialBuyResult;
      try {
        imperialBuyResult = await executePublicShareTradeFlow(db, imperialBuyPlan, {
          idempotencyKey: imperialTradeKey,
        });
      } catch (error) {
        return mapTradeKeyError(error);
      }
      if (!imperialBuyResult.ok) {
        return NextResponse.json(
          { error: imperialBuyResult.error },
          { status: imperialBuyResult.status }
        );
      }
      if (!imperialBuyResult.replayed) {
        void notifyHostileTakeoverThresholdIfEligible(db, corporation._id);
        void logEconomicAction(db, {
          characterId: imperial._id,
          userId: basicAuth.user.userId,
          actionType: "buyShares",
          turn: imperialTurn,
          characterName: imperial.name,
          username: userDoc?.username,
          countryId: corporation.countryId,
          // `cost` is the total ₳ (anchor) purchase price (pricePerShareAnchor = cost/shares).
          corpCashCostAnchor: cost,
          currencyCode: corporation.liquidCurrencyCode,
          result: {
            success: true,
            message: `Bought ${shares.toLocaleString()} shares of ${corporation.name}`,
          },
        }).catch(() => {});
      }
      return NextResponse.json(imperialBuyResult.body);
    }

    // ── Regular character share buy ─────────────────────────────
    const characterQuery = userDoc?.activeCharacterId
      ? { _id: userDoc.activeCharacterId, userId: new ObjectId(basicAuth.user.userId) }
      : { userId: new ObjectId(basicAuth.user.userId) };
    const character = await db.collection<Character>("characters").findOne(characterQuery);
    if (!character) {
      return NextResponse.json({ error: "Character not found" }, { status: 404 });
    }
    const tradeLock = await assertCeoTradeNotBlocked(db, corporation, character._id);
    if (tradeLock.blocked) {
      return NextResponse.json({ error: tradeLock.error }, { status: tradeLock.status });
    }
    // Load full character doc for balance check and home currency lookup.
    const charDoc = await db.collection<Character>("characters").findOne({ _id: character._id });
    if (!charDoc) {
      return NextResponse.json({ error: "Character not found" }, { status: 404 });
    }

    const ceoCap = await assertCeoAcquisitionWithinCap(
      db,
      corporation,
      charDoc._id,
      "characterId",
      shares,
      await getCurrentTurn(db)
    );
    if (ceoCap) {
      return NextResponse.json({ error: ceoCap.error }, { status: ceoCap.status });
    }

    // Cost is in ₳; convert to character's home currency before deducting.
    const homeCurrency = getHomeCurrency(charDoc);
    let charFxRate = 1.0;
    if (forexEnabled) {
      const fxResult = await loadCharacterFxRate(db, homeCurrency);
      if (!fxResult.ok) {
        return NextResponse.json(
          { error: "Exchange rate unavailable, try again shortly" },
          { status: 503 }
        );
      }
      charFxRate = fxResult.rate;
    }
    const costInHome = forexEnabled ? cost * charFxRate : cost;

    // Currency conversion: explicit pay-currency runs convertForExplicitPay;
    // otherwise honor character.autoConvertEnabled by consolidating other
    // wallets via autoConvertForPurchase (matches bond buy flow).
    let charSpreadCharged = 0;
    if (forexEnabled) {
      const gs = await db.collection<GameState>("gameState").findOne({ _id: "current" });
      if (payCurrency && payCurrency !== homeCurrency) {
        const convertResult = await convertForExplicitPay(db, {
          character: charDoc,
          payCurrency,
          requiredCurrency: homeCurrency,
          requiredAmount: costInHome,
          turn: gs?.currentTurn ?? 0,
          forexEnabled,
        });
        if (!convertResult.success) {
          return NextResponse.json({ error: convertResult.error }, { status: 400 });
        }
        charSpreadCharged = convertResult.spreadCharged;
      } else {
        const convertResult = await autoConvertForPurchase(db, {
          character: charDoc,
          requiredCurrency: homeCurrency,
          requiredAmount: costInHome,
          turn: gs?.currentTurn ?? 0,
          forexEnabled,
        });
        if (convertResult.needed && !convertResult.success) {
          return NextResponse.json({ error: convertResult.error }, { status: 400 });
        }
        charSpreadCharged = convertResult.spreadCharged;
      }
    }

    const now = new Date();
    const charTurn = await getCurrentTurn(db);
    const charTradeKey = headerKey ?? randomUUID();

    // Wash-trade guard (see orderFlowWashGuard). Read-only; pinned below.
    const washExcluded =
      orderFlowEligible &&
      (await isOrderFlowWashRoundTrip(
        db,
        corporation._id,
        { characterId: character._id },
        "buy",
        now
      ));

    const charIssuerBuyback = shares * executionPrice;
    let charDealer: ShareOrderPlacementDealer;
    if (marketQuote.active) {
      charDealer = {
        kind: "pool",
        currency: marketQuote.currency,
        amountLocal: charIssuerBuyback,
        flowKind: "purchasesIn",
      };
    } else if (getShareBuybackMode(corporation) === "escrow") {
      charDealer = { kind: "escrow-credit", amountLocal: charIssuerBuyback };
    } else {
      charDealer = { kind: "treasury", amountLocal: charIssuerBuyback };
    }

    const charBuyPlan: PublicShareTradePlan = {
      version: 1,
      tradeKey: charTradeKey,
      kind: "market-buy",
      corpIdHex: corporation._id.toHexString(),
      corpName: corporation.name,
      shares,
      executionPrice,
      turn: charTurn,
      nowIso: now.toISOString(),
      orderFlowEligible,
      washExcluded,
      buyerDebit: {
        collection: "characters",
        idHex: character._id.toHexString(),
        field: personalBalanceField(homeCurrency, forexEnabled),
        amount: costInHome,
      },
      capCredit: {
        field: "characterId",
        idHex: character._id.toHexString(),
        pricePerShare: executionPrice,
      },
      capDebit: null,
      proceedsLeg: null,
      dealer: charDealer,
      ceoVacate: null,
      closeTenureHolderIdHex: null,
      tx: {
        type: "stock_trade_buy",
        subjectType: "character",
        subjectIdHex: character._id.toHexString(),
        subjectName: charDoc.name,
        amount: -costInHome,
        includeBalanceAfter: true,
        currencyCode: homeCurrency,
        counterpartyType: "corporation",
        counterpartyIdHex: corporation._id.toHexString(),
        counterpartyName: corporation.name,
        meta: {
          corporationId: corporation._id.toString(),
          shares,
          pricePerShare: executionPrice,
        },
      },
      history: {
        kind: "market_buy",
        shares,
        pricePerShareAnchor: cost / shares,
        from: null,
        to: { characterId: character._id, name: charDoc.name },
        corpCurrencyCode: corporation.liquidCurrencyCode,
      },
      // Character FX spreads are consumed inside autoConvert (folded into the
      // pinned cost); there is nothing left to distribute post-commit.
      spread: null,
      audit: null,
      notifyTakeover: true,
      errors: {
        "buyer-debit": {
          message: `Insufficient funds. Need ${costInHome.toLocaleString(undefined, { minimumFractionDigits: 2 })} ${homeCurrency}.`,
          status: 400,
        },
        float: { message: "Not enough shares remain in public float", status: 409 },
        "buyer-credit": { message: "Failed to record trade", status: 500 },
        dealer: { message: "Failed to record trade", status: 500 },
        "seller-debit": { message: "Failed to record trade", status: 500 },
        "proceeds-credit": { message: "Failed to record trade", status: 500 },
        history: { message: "Failed to record trade", status: 500 },
      },
      response: {
        success: true,
        sharesBought: shares,
        cost: Math.round(cost * 100) / 100,
        pricePerShare: executionPrice,
        // FX spread already folded into the cost when paying in a foreign currency.
        spreadPaid: Math.round(charSpreadCharged * 100) / 100,
      },
    };

    let charBuyResult;
    try {
      charBuyResult = await executePublicShareTradeFlow(db, charBuyPlan, {
        idempotencyKey: charTradeKey,
      });
    } catch (error) {
      return mapTradeKeyError(error);
    }
    if (!charBuyResult.ok) {
      return NextResponse.json({ error: charBuyResult.error }, { status: charBuyResult.status });
    }
    if (!charBuyResult.replayed) {
      void notifyHostileTakeoverThresholdIfEligible(db, corporation._id);
      void logEconomicAction(db, {
        characterId: character._id,
        userId: basicAuth.user.userId,
        actionType: "buyShares",
        turn: charTurn,
        characterName: charDoc.name,
        username: userDoc?.username,
        countryId: corporation.countryId,
        // `cost` is the total ₳ (anchor) purchase price (pricePerShareAnchor = cost/shares).
        corpCashCostAnchor: cost,
        currencyCode: corporation.liquidCurrencyCode,
        result: {
          success: true,
          message: `Bought ${shares.toLocaleString()} shares of ${corporation.name}`,
        },
      }).catch(() => {});
    }
    return NextResponse.json(charBuyResult.body);
  } catch (error) {
    return handleRouteError(error);
  }
}
