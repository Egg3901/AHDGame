import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { ObjectId } from "mongodb";
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
import {
  creditShares,
  creditSharesToCorp,
  creditSharesToImperial,
  debitShares,
  debitSharesFromCorp,
  debitSharesFromImperial,
} from "@/lib/corporations/shareholderOps";
import { recordShareTrade } from "@/lib/corporations/shareTradeHistory";
import { logEconomicAction } from "@/lib/corporations/economicActionLog";
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
import { distributeConversionSpread } from "@/lib/currency/marketMaker";
import { notifyHostileTakeoverThresholdIfEligible } from "@/lib/corporations/hostileTakeoverNotifications";
import { isOrderFlowPriceEligible } from "@/lib/corporations/marketExecution";
import { loadEquityQuote } from "@/lib/equities/marketPool";
import {
  buildOrderFlowWindowInc,
  buildOrderFlowWindowIncReversal,
  isOrderFlowWashRoundTrip,
} from "@/lib/corporations/orderFlowWashGuard";
import { CURRENCY_SYMBOLS } from "@/lib/constants/currencies";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { GameState } from "@/lib/db/types";
import { emitTx } from "@/lib/financialTxLog/emit";
import {
  atomicallyDebitCharacterCash,
  refundCharacterCash,
  atomicallyDebitImperialCash,
  refundImperialCash,
  atomicallyDebitCorpLiquidCapital,
  refundCorpLiquidCapital,
} from "@/lib/financialTxLog/atomicCashGuard";
import { applyFloatBuyCredit } from "@/lib/corporations/shareEscrowSettlement";
import { assertCeoAcquisitionWithinCap } from "@/lib/corporations/ceoShareAcquisitionCap";
import { rejectDuringTurn } from "@/lib/api/rejectDuringTurn";

interface RouteParams {
  params: Promise<{ id: string }>;
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

      // Atomic balance-gated debit. Replaces the read-then-write check + naïve
      // $inc that allowed concurrent corp share buys to over-deduct or — the
      // observed failure mode — credit shares while silently dropping the cash
      // deduction. See src/lib/financialTxLog/atomicCashGuard.ts.
      const corpDebit = await atomicallyDebitCorpLiquidCapital(
        db,
        buyingCorp._id,
        costInBuyerCapital
      );
      if (!corpDebit.ok) {
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
        return NextResponse.json(
          {
            error:
              buyingCurrency !== targetCurrency
                ? `Insufficient funds. Need ${targetSym}${costStr}${currencyNote}`
                : `Insufficient funds. Need ${targetSym}${costStr}, corp has ${buySym}${haveStr} ${buyingCurrency}`,
          },
          { status: 400 }
        );
      }

      // Wash-trade guard (see orderFlowWashGuard): a buy that round-trips this
      // corp's own recent sell contributes nothing to the order-flow window and
      // neutralizes the sell leg instead.
      const washExcluded =
        orderFlowEligible &&
        (await isOrderFlowWashRoundTrip(
          db,
          corporation._id,
          { corporationId: buyingCorp._id },
          "buy",
          now
        ));
      const orderFlowInc = buildOrderFlowWindowInc(
        orderFlowEligible,
        "buy",
        shares * executionPrice,
        washExcluded
      );
      const orderFlowIncReversal = buildOrderFlowWindowIncReversal(
        orderFlowEligible,
        "buy",
        shares * executionPrice,
        washExcluded
      );

      let sharesCredited = false;
      try {
        const credited = await creditSharesToCorp(
          db,
          corporation._id,
          buyingCorp._id,
          shares,
          executionPrice,
          {
            $inc: {
              publicFloat: -shares,
              ...orderFlowInc,
            },
            $set: { updatedAt: now },
          },
          { guardFilter: { publicFloat: { $gte: shares } } }
        );
        if (!credited) {
          await refundCorpLiquidCapital(db, buyingCorp._id, costInBuyerCapital);
          return NextResponse.json(
            { error: "Not enough shares remain in public float" },
            { status: 409 }
          );
        }
        sharesCredited = true;

        void recordShareTrade(db, {
          corporationId: corporation._id,
          kind: "market_buy",
          turn: await getCurrentTurn(db),
          shares,
          pricePerShareAnchor: cost / shares,
          from: null,
          to: { corporationId: buyingCorp._id, name: buyingCorp.name },
          corpCurrencyCode: corporation.liquidCurrencyCode,
        });

        void logEconomicAction(db, {
          characterId: ceoId,
          userId: corpAuth.user.userId,
          actionType: "buyShares",
          turn: await getCurrentTurn(db),
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

        void notifyHostileTakeoverThresholdIfEligible(db, corporation._id);

        await emitTx(db, {
          type: "stock_trade_buy",
          turn: await getCurrentTurn(db),
          createdAt: now,
          subjectType: "corporation",
          subjectId: buyingCorp._id,
          subjectName: buyingCorp.name,
          amount: -costInBuyerCapital,
          balanceAfter: corpDebit.newBalance,
          currencyCode: resolveCorpLiquidCurrencyCode(buyingCorp) ?? "USD",
          counterpartyType: "corporation",
          counterpartyId: corporation._id,
          counterpartyName: corporation.name,
          meta: {
            corporationId: corporation._id.toString(),
            shares,
            pricePerShare: executionPrice,
          },
        });

        // Treasury-backed market maker: the buyer's payment is injected into
        // the issuer's liquidCapital so a float buy conserves money instead of
        // vanishing. Last statement in the try — if it throws, the catch rolls
        // back the shares + buyer cash, so the issuer simply isn't credited.
        await applyFloatBuyCredit(db, corporation, shares * executionPrice);

        // Route the FX spread the corp already paid on a cross-currency share
        // buy into the CB system (reserve slice → target-currency CB; revenue →
        // buyer-currency CB). Previously this spread was destroyed.
        if (buyingCurrency !== targetCurrency) {
          await distributeConversionSpread(
            db,
            corpPurchaseEstimate.spreadFee,
            buyingCurrency,
            targetCurrency
          );
        }
      } catch (err) {
        if (sharesCredited) {
          await debitSharesFromCorp(
            db,
            corporation._id,
            buyingCorp._id,
            shares,
            {
              $inc: {
                publicFloat: shares,
                ...orderFlowIncReversal,
              },
              $set: { updatedAt: new Date() },
            },
            { requireSufficient: true }
          );
        }
        await refundCorpLiquidCapital(db, buyingCorp._id, costInBuyerCapital);
        throw err;
      }

      return NextResponse.json({
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
      });
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

      // Atomic balance-gated debit on imperial wallet (post-autoConvert).
      const debitResult = await atomicallyDebitImperialCash(
        db,
        imperial._id,
        imperialHomeCurrency,
        costInImperialHome,
        forexEnabled
      );
      if (!debitResult.ok) {
        return NextResponse.json(
          {
            error: `Insufficient funds. Need ${costInImperialHome.toLocaleString(undefined, { minimumFractionDigits: 2 })} ${imperialHomeCurrency}.`,
          },
          { status: 400 }
        );
      }

      // Wash-trade guard (see orderFlowWashGuard).
      const washExcluded =
        orderFlowEligible &&
        (await isOrderFlowWashRoundTrip(
          db,
          corporation._id,
          { imperialCharacterId: imperial._id },
          "buy",
          now
        ));
      const orderFlowInc = buildOrderFlowWindowInc(
        orderFlowEligible,
        "buy",
        shares * executionPrice,
        washExcluded
      );
      const orderFlowIncReversal = buildOrderFlowWindowIncReversal(
        orderFlowEligible,
        "buy",
        shares * executionPrice,
        washExcluded
      );

      let sharesCredited = false;
      try {
        const credited = await creditSharesToImperial(
          db,
          corporation._id,
          imperial._id,
          shares,
          {
            $inc: {
              publicFloat: -shares,
              ...orderFlowInc,
            },
            $set: { updatedAt: now },
          },
          { pricePerShare: executionPrice, guardFilter: { publicFloat: { $gte: shares } } }
        );
        if (!credited) {
          await refundImperialCash(
            db,
            imperial._id,
            imperialHomeCurrency,
            costInImperialHome,
            forexEnabled
          );
          return NextResponse.json(
            { error: "Not enough shares remain in public float" },
            { status: 409 }
          );
        }
        sharesCredited = true;

        void recordShareTrade(db, {
          corporationId: corporation._id,
          kind: "market_buy",
          turn: await getCurrentTurn(db),
          shares,
          pricePerShareAnchor: cost / shares,
          from: null,
          to: { imperialCharacterId: imperial._id, name: imperial.name },
          corpCurrencyCode: corporation.liquidCurrencyCode,
        });

        void logEconomicAction(db, {
          characterId: imperial._id,
          userId: basicAuth.user.userId,
          actionType: "buyShares",
          turn: await getCurrentTurn(db),
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

        await emitTx(db, {
          type: "stock_trade_buy",
          turn: await getCurrentTurn(db),
          createdAt: now,
          subjectType: "character",
          subjectId: imperial._id,
          subjectName: imperial.name,
          amount: -costInImperialHome,
          balanceAfter: debitResult.newBalance,
          currencyCode: imperialHomeCurrency,
          counterpartyType: "corporation",
          counterpartyId: corporation._id,
          counterpartyName: corporation.name,
          meta: {
            corporationId: corporation._id.toString(),
            shares,
            pricePerShare: executionPrice,
            imperial: true,
          },
        });

        // Treasury-backed market maker: inject the buyer's payment into the
        // issuer's liquidCapital so the float buy conserves money. Last in the
        // try — a throw here is rolled back by the catch below.
        await applyFloatBuyCredit(db, corporation, shares * executionPrice);
      } catch (err) {
        if (sharesCredited) {
          await debitSharesFromImperial(
            db,
            corporation._id,
            imperial._id,
            shares,
            {
              $inc: {
                publicFloat: shares,
                ...orderFlowIncReversal,
              },
              $set: { updatedAt: new Date() },
            },
            { requireSufficient: true }
          );
        }
        await refundImperialCash(
          db,
          imperial._id,
          imperialHomeCurrency,
          costInImperialHome,
          forexEnabled
        );
        throw err;
      }

      return NextResponse.json({
        success: true,
        sharesBought: shares,
        cost: Math.round(cost * 100) / 100,
        pricePerShare: executionPrice,
      });
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

    // Atomic balance-gated debit. Closes the same race-window the bond buy
    // route had (concurrent buys passing read-side check on stale data,
    // partial writes leaving shares credited while cash never moved).
    const debitResult = await atomicallyDebitCharacterCash(
      db,
      character._id,
      homeCurrency,
      costInHome,
      forexEnabled
    );
    if (!debitResult.ok) {
      return NextResponse.json(
        {
          error: `Insufficient funds. Need ${costInHome.toLocaleString(undefined, { minimumFractionDigits: 2 })} ${homeCurrency}.`,
        },
        { status: 400 }
      );
    }

    // Wash-trade guard (see orderFlowWashGuard).
    const washExcluded =
      orderFlowEligible &&
      (await isOrderFlowWashRoundTrip(
        db,
        corporation._id,
        { characterId: character._id },
        "buy",
        now
      ));
    const orderFlowInc = buildOrderFlowWindowInc(
      orderFlowEligible,
      "buy",
      shares * executionPrice,
      washExcluded
    );
    const orderFlowIncReversal = buildOrderFlowWindowIncReversal(
      orderFlowEligible,
      "buy",
      shares * executionPrice,
      washExcluded
    );

    let sharesCredited = false;
    try {
      const credited = await creditShares(
        db,
        corporation._id,
        character._id,
        shares,
        {
          $inc: {
            publicFloat: -shares,
            ...orderFlowInc,
          },
          $set: { updatedAt: now },
        },
        { pricePerShare: executionPrice, guardFilter: { publicFloat: { $gte: shares } } }
      );
      if (!credited) {
        await refundCharacterCash(db, character._id, homeCurrency, costInHome, forexEnabled);
        return NextResponse.json(
          { error: "Not enough shares remain in public float" },
          { status: 409 }
        );
      }
      sharesCredited = true;

      void recordShareTrade(db, {
        corporationId: corporation._id,
        kind: "market_buy",
        turn: await getCurrentTurn(db),
        shares,
        pricePerShareAnchor: cost / shares,
        from: null,
        to: { characterId: character._id, name: charDoc.name },
        corpCurrencyCode: corporation.liquidCurrencyCode,
      });

      void logEconomicAction(db, {
        characterId: character._id,
        userId: basicAuth.user.userId,
        actionType: "buyShares",
        turn: await getCurrentTurn(db),
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

      await emitTx(db, {
        type: "stock_trade_buy",
        turn: await getCurrentTurn(db),
        createdAt: now,
        subjectType: "character",
        subjectId: character._id,
        subjectName: charDoc.name,
        amount: -costInHome,
        balanceAfter: debitResult.newBalance,
        currencyCode: homeCurrency,
        counterpartyType: "corporation",
        counterpartyId: corporation._id,
        counterpartyName: corporation.name,
        meta: {
          corporationId: corporation._id.toString(),
          shares,
          pricePerShare: executionPrice,
        },
      });

      // Treasury-backed market maker: inject the buyer's payment into the
      // issuer's liquidCapital so the float buy conserves money. Last in the
      // try — a throw here is rolled back by the catch below.
      await applyFloatBuyCredit(db, corporation, shares * executionPrice);
    } catch (err) {
      if (sharesCredited) {
        await debitShares(
          db,
          corporation._id,
          character._id,
          shares,
          {
            $inc: {
              publicFloat: shares,
              ...orderFlowIncReversal,
            },
            $set: { updatedAt: new Date() },
          },
          { requireSufficient: true }
        );
      }
      await refundCharacterCash(db, character._id, homeCurrency, costInHome, forexEnabled);
      throw err;
    }

    return NextResponse.json({
      success: true,
      sharesBought: shares,
      cost: Math.round(cost * 100) / 100,
      pricePerShare: executionPrice,
      // FX spread already folded into the cost when paying in a foreign currency.
      spreadPaid: Math.round(charSpreadCharged * 100) / 100,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
