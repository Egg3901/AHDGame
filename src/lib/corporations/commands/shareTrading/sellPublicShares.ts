import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { MoneyFlowKeyConflictError, MoneyFlowTerminalError } from "@/lib/db/nonAtomicMoneyFlow";
import { requireCorporationActionsEnabled } from "@/lib/api/requireCorporationActions";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { sellSharesSchema } from "@/lib/api/schemas/corporations";
import { handleRouteError } from "@/lib/api/errors";
import { resolveCorporation } from "@/lib/api/corporations/resolveQuery";
import { assertCeoTradeNotBlocked } from "@/lib/corporations/commands/privatization/openVoteGuard";
import type { Character, Corporation, ShareOrder, User } from "@/lib/db/types";
import type { ImperialCharacter } from "@/lib/db/types/imperialCharacter";
import { logEconomicAction } from "@/lib/corporations/economicActionLog";
import { personalBalanceField } from "@/lib/corporations/commands/shareTrading/shareFillMoney";
import {
  buildOrderBookFillFingerprint,
  executePublicShareTradeFlow,
  getStoredPublicShareTradeResponse,
  recordCompletedTradeResponse,
  recoverPublicShareTradeByKey,
  type PublicShareTradeCeoSnapshot,
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
  getCorpFxRate,
  resolveCorpLiquidCurrencyCode,
  shareTradeAnchorValue,
} from "@/lib/currency/corporationCapital";
import { isOrderFlowPriceEligible } from "@/lib/corporations/marketExecution";
import { equityPoolDepthMessage, loadEquityQuote } from "@/lib/equities/marketPool";
import { isOrderFlowWashRoundTrip } from "@/lib/corporations/orderFlowWashGuard";
import { CURRENCY_SYMBOLS } from "@/lib/constants/currencies";
import { rejectDuringTurn } from "@/lib/api/rejectDuringTurn";
import { fillBestBuyOrderForMarketSell } from "@/lib/corporations/commands/shareTrading/fillBestBuyOrder";

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
 * POST /api/corporations/[id]/shares/sell
 * Sell shares at current market price into the public float.
 * When sellAsCorporation is true, sells on behalf of the caller's corporation.
 * auth: requireBasicAuth
 * errors: 400 insufficient shares, 403 not CEO, 404 corp not found
 */
export async function sellPublicShares(request: Request, { params }: RouteParams) {
  try {
    const basicAuth = await requireBasicAuth();
    if (!basicAuth.ok) return basicAuth.response;

    const rateLimit = checkRateLimit(basicAuth.user.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const { id } = await params;
    const parsed = await parseJsonBody(request, sellSharesSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const { shares, sellAsCorporation, confirmCeoVacate } = parsed.data;

    // Crash-safe float trades (issue #1672): the issuer debit, the share
    // debit, and the proceeds credit run as keyed idempotent steps.
    // `Idempotency-Key` replays the stored outcome without moving money again.
    const headerKey = request.headers.get("Idempotency-Key");
    if (headerKey !== null && (headerKey.length === 0 || headerKey.length > 128)) {
      return NextResponse.json({ error: "Invalid Idempotency-Key header" }, { status: 400 });
    }

    const [db, forexEnabled] = await Promise.all([getDb(), isForexEnabled()]);

    // Same-key retry: the first attempt already validated, so reconcile
    // through the stored plan instead of re-running the guards (which
    // post-debit reads would fail). Runs before the action/turn guards so
    // crash recovery converges even while fresh trades are blocked.
    if (headerKey !== null) {
      const prior = await getStoredPublicShareTradeResponse(db, headerKey);
      if (prior) {
        return runTradeKeyRecovery(db, headerKey);
      }
    }
    const corpGuard = await requireCorporationActionsEnabled(db);
    if (corpGuard) return corpGuard;
    const turnGuard = await rejectDuringTurn(db);
    if (turnGuard) return turnGuard;

    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;
    const marketQuote = await loadEquityQuote(db, corporation);
    const executionPrice = marketQuote.bidPriceLocal;
    const orderFlowEligible = isOrderFlowPriceEligible(
      corporation.publicFloat,
      corporation.totalShares
    );

    const now = new Date();
    // sharePrice is stored in the target corp's liquidCurrencyCode (v0.2.6).
    // Normalize to ₳ here so every downstream credit — seller corp liquidCapital,
    // imperial/character home wallet — uses the same anchor-denominated base.
    const targetFxRate = await getCorpFxRate(db, corporation);
    const proceeds =
      Math.round(
        shareTradeAnchorValue(
          shares,
          { ...corporation, sharePrice: executionPrice },
          targetFxRate
        ) * 100
      ) / 100;

    // Issuer settlement for a sell into the float, routed by shareBuybackMode:
    //  - instant mode: bought back from the ISSUER's own liquidCapital (local
    //    currency), capped at what the treasury can cover (the gate below).
    //  - escrow mode: debited from the market-making escrow with no cap (the
    //    balance may go negative), so the gate always passes.
    // Pre-fix the float minted the seller's proceeds with no counterparty debit.
    //
    // Crash-safe (issue #1672): the routing AND the escrow-mode split are
    // pinned here, before the keyed flow starts, so a retry replays the same
    // figures instead of re-reading post-debit state. The pool-depth
    // pre-check below stays in the route (read-only); the flow re-guards the
    // same message for a pool race at step time.
    const issuerBuyback = shares * executionPrice;
    const issuerCurrency = resolveCorpLiquidCurrencyCode(corporation) ?? "USD";
    function treasuryCoverError(): { message: string; status: number } {
      const sym = CURRENCY_SYMBOLS[issuerCurrency] ?? "$";
      return {
        message: `${corporation.name}'s treasury can't cover this sale (needs ${sym}${issuerBuyback.toLocaleString(undefined, { maximumFractionDigits: 0 })}). List the shares for sale to a real buyer instead.`,
        status: 400,
      };
    }
    /** Pool-depth gate shared by every float sell (legacy pre-check). */
    function gatePoolDepth(): NextResponse | null {
      if (marketQuote.active && shares > marketQuote.bidDepthShares) {
        return NextResponse.json(
          {
            error: equityPoolDepthMessage(marketQuote.bidDepthShares, marketQuote.currency),
            marketDepthShares: marketQuote.bidDepthShares,
          },
          { status: 400 }
        );
      }
      return null;
    }
    /** Pins the sell dealer leg; reads the issuer escrow pot for the split. */
    async function pinSellDealer(): Promise<{
      dealer: ShareOrderPlacementDealer;
      error: { message: string; status: number };
    }> {
      if (marketQuote.active) {
        return {
          dealer: {
            kind: "pool",
            currency: marketQuote.currency,
            amountLocal: -issuerBuyback,
            flowKind: "salesOut",
          },
          error: {
            message: equityPoolDepthMessage(marketQuote.bidDepthShares, marketQuote.currency),
            status: 400,
          },
        };
      }
      if (getShareBuybackMode(corporation) === "escrow") {
        const issuerRow = await db
          .collection<Corporation>("corporations")
          .findOne({ _id: corporation._id }, { projection: { shareEscrowBalance: 1 } });
        const escrowBalance = issuerRow?.shareEscrowBalance ?? 0;
        const escrowPart = Math.min(issuerBuyback, Math.max(0, escrowBalance));
        return {
          dealer: {
            kind: "escrow-split",
            amountLocal: issuerBuyback,
            escrowPart,
            treasuryPart: issuerBuyback - escrowPart,
          },
          error: { message: "Failed to record trade", status: 500 },
        };
      }
      return {
        dealer: { kind: "treasury", amountLocal: -issuerBuyback },
        error: treasuryCoverError(),
      };
    }
    function ceoSnapshotOf(corp: Corporation): PublicShareTradeCeoSnapshot {
      return {
        ceoIdHex: corp.ceoId.toHexString(),
        userIdHex: corp.userId.toHexString(),
        ceoVacant: corp.ceoVacant ?? false,
        ...(corp.ceoVacantSinceTurn !== undefined
          ? { ceoVacantSinceTurn: corp.ceoVacantSinceTurn }
          : {}),
        ...(corp.pendingCeoCharacterId
          ? { pendingCeoCharacterIdHex: corp.pendingCeoCharacterId.toHexString() }
          : {}),
      };
    }

    const userDoc = await db
      .collection<User>("users")
      .findOne({ _id: new ObjectId(basicAuth.user.userId) });
    const isImperialMode =
      userDoc?.activeCharacterType === "imperial" && !!userDoc?.activeImperialCharacterId;

    if (sellAsCorporation) {
      // Corp sell path — resolve CEO from correct collection
      let ceoId: ObjectId;
      if (isImperialMode) {
        const imperial = await db.collection<ImperialCharacter>("imperialCharacters").findOne({
          _id: userDoc!.activeImperialCharacterId!,
          userId: new ObjectId(basicAuth.user.userId),
        });
        if (!imperial) {
          return NextResponse.json({ error: "Imperial character not found" }, { status: 404 });
        }
        ceoId = imperial._id;
      } else {
        const characterQuery = userDoc?.activeCharacterId
          ? { _id: userDoc.activeCharacterId, userId: new ObjectId(basicAuth.user.userId) }
          : { userId: new ObjectId(basicAuth.user.userId) };
        const character = await db.collection<Character>("characters").findOne(characterQuery);
        if (!character) {
          return NextResponse.json({ error: "Character not found" }, { status: 404 });
        }
        ceoId = character._id;
      }

      const sellerCorp = await db
        .collection<Corporation>("corporations")
        .findOne({ ceoId, ceoVacant: { $ne: true } });
      if (!sellerCorp) {
        return NextResponse.json(
          { error: "You must be a CEO to sell shares on behalf of a corporation" },
          { status: 403 }
        );
      }

      const shareholderEntry = corporation.shareholders?.find(
        (sh) => sh.corporationId?.toString() === sellerCorp._id.toString()
      );
      if (!shareholderEntry || shareholderEntry.shares < shares) {
        return NextResponse.json(
          { error: `Corporation only owns ${shareholderEntry?.shares ?? 0} shares` },
          { status: 400 }
        );
      }

      const poolGate = gatePoolDepth();
      if (poolGate) return poolGate;

      // Wash-trade guard: a sell that round-trips this corp's own recent buy
      // contributes nothing to the order-flow window and neutralizes the buy
      // leg instead (see orderFlowWashGuard). Read-only; pinned below.
      const washExcluded =
        orderFlowEligible &&
        (await isOrderFlowWashRoundTrip(
          db,
          corporation._id,
          { corporationId: sellerCorp._id },
          "sell",
          now
        ));

      // Convert ₳-denominated proceeds into seller corp's home currency.
      // Pinned before the flow so recovery replays the same figure.
      const sellerFxRate = await getCorpFxRate(db, sellerCorp);
      const proceedsInSellerCapital = anchorToCorpLiquidCapital(proceeds, sellerCorp, sellerFxRate);
      const sellerCurrency = resolveCorpLiquidCurrencyCode(sellerCorp) ?? "USD";

      const corpSellDealer = await pinSellDealer();
      const corpSellTurn = await getCurrentTurn(db);
      const corpSellKey = headerKey ?? randomUUID();
      const corpSellPlan: PublicShareTradePlan = {
        version: 1,
        tradeKey: corpSellKey,
        kind: "market-sell",
        corpIdHex: corporation._id.toHexString(),
        corpName: corporation.name,
        shares,
        executionPrice,
        turn: corpSellTurn,
        nowIso: now.toISOString(),
        orderFlowEligible,
        washExcluded,
        buyerDebit: null,
        capCredit: null,
        capDebit: {
          field: "corporationId",
          idHex: sellerCorp._id.toHexString(),
          pricePerShare: shareholderEntry.avgCostPerShare ?? executionPrice,
        },
        proceedsLeg: {
          collection: "corporations",
          idHex: sellerCorp._id.toHexString(),
          field: "liquidCapital",
          amount: proceedsInSellerCapital,
        },
        dealer: corpSellDealer.dealer,
        ceoVacate: null,
        closeTenureHolderIdHex: null,
        tx: {
          type: "stock_trade_sell",
          subjectType: "corporation",
          subjectIdHex: sellerCorp._id.toHexString(),
          subjectName: sellerCorp.name,
          amount: proceedsInSellerCapital,
          includeBalanceAfter: false,
          currencyCode: sellerCurrency,
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
          kind: "market_sell",
          shares,
          pricePerShareAnchor: proceeds / shares,
          from: { corporationId: sellerCorp._id, name: sellerCorp.name },
          to: null,
          corpCurrencyCode: corporation.liquidCurrencyCode,
        },
        spread: null,
        audit: {
          counterpartyType: "corporation",
          counterpartyIdHex: sellerCorp._id.toHexString(),
          counterpartyName: sellerCorp.name,
          amount: proceedsInSellerCapital,
          currencyCode: sellerCurrency,
          shares,
          pricePerShare: executionPrice,
        },
        notifyTakeover: false,
        errors: {
          "buyer-debit": { message: "Failed to record trade", status: 500 },
          float: { message: "Failed to record trade", status: 500 },
          "buyer-credit": { message: "Failed to record trade", status: 500 },
          dealer: corpSellDealer.error,
          "seller-debit": {
            message: "Shares were already sold or reserved by another action",
            status: 409,
          },
          "proceeds-credit": { message: "Seller corporation not found", status: 500 },
          history: { message: "Failed to record trade", status: 500 },
        },
        response: {
          success: true,
          sharesSold: shares,
          proceeds,
          pricePerShare: executionPrice,
          seller: "corporation",
        },
      };

      let corpSellResult;
      try {
        corpSellResult = await executePublicShareTradeFlow(db, corpSellPlan, {
          idempotencyKey: corpSellKey,
        });
      } catch (error) {
        return mapTradeKeyError(error);
      }
      if (!corpSellResult.ok) {
        // A compensated dealer gate reports the pinned gate surface; a
        // pool-depth race keeps the legacy depth body without the shares hint.
        if (corpSellResult.status === 400 && marketQuote.active) {
          return NextResponse.json(
            {
              error: corpSellResult.error,
              marketDepthShares: marketQuote.bidDepthShares,
            },
            { status: 400 }
          );
        }
        return NextResponse.json(
          { error: corpSellResult.error },
          { status: corpSellResult.status }
        );
      }
      if (!corpSellResult.replayed) {
        void logEconomicAction(db, {
          characterId: ceoId,
          userId: basicAuth.user.userId,
          actionType: "sellShares",
          turn: corpSellTurn,
          characterName: sellerCorp.name,
          username: userDoc?.username,
          countryId: corporation.countryId,
          // `proceeds` is the ₳ (anchor) sale value gained (pricePerShareAnchor = proceeds/shares).
          // A sale spends no corp cash / MS, so only the gained revenue is logged.
          capturedRevenueAnchor: proceeds,
          currencyCode: corporation.liquidCurrencyCode,
          result: {
            success: true,
            message: `${sellerCorp.name} sold ${shares.toLocaleString()} shares of ${corporation.name}`,
          },
        }).catch(() => {});
      }
      return NextResponse.json(corpSellResult.body);
    }

    if (isImperialMode) {
      // ── Imperial character sell path ────────────────────────────
      const imperial = await db.collection<ImperialCharacter>("imperialCharacters").findOne({
        _id: userDoc!.activeImperialCharacterId!,
        userId: new ObjectId(basicAuth.user.userId),
      });
      if (!imperial) {
        return NextResponse.json({ error: "Imperial character not found" }, { status: 404 });
      }

      const shareholderEntry = corporation.shareholders?.find(
        (sh) => sh.imperialCharacterId?.toString() === imperial._id.toString()
      );
      const ownedShares = shareholderEntry?.shares ?? 0;
      if (ownedShares < shares) {
        return NextResponse.json({ error: `You only own ${ownedShares} shares` }, { status: 400 });
      }

      const shouldVacateCeo =
        corporation.ceoType === "imperial" &&
        imperial._id.equals(corporation.ceoId) &&
        ownedShares === shares;
      if (shouldVacateCeo && !confirmCeoVacate) {
        return NextResponse.json(
          {
            error: `You are the CEO of ${corporation.name}. Selling all ${shares.toLocaleString()} of your remaining shares will remove you as CEO — this can't be undone, and you'd have to be re-appointed to become CEO again.`,
            requiresCeoVacateConfirm: true,
          },
          { status: 409 }
        );
      }
      // Proceeds are in ₳; convert to imperial character's home currency before
      // crediting. Pinned before the flow so recovery replays the same figure.
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
      const proceedsInImperialHome = forexEnabled ? proceeds * imperialFxRate : proceeds;

      if (!shouldVacateCeo) {
        const orderFill = await fillBestBuyOrderForMarketSell({
          db,
          corporation,
          seller: {
            id: imperial._id,
            name: imperial.name,
            collectionName: "imperialCharacters",
            homeCurrency: imperialHomeCurrency,
            isImperial: true,
          },
          shares,
          forexEnabled,
          sellerFxRate: imperialFxRate,
          now,
          turn: await getCurrentTurn(db),
        });
        if (orderFill.filled) {
          const orderBookBody = {
            success: true,
            sharesSold: orderFill.shares,
            proceeds: Math.round(orderFill.proceedsAnchor * 100) / 100,
            pricePerShare: orderFill.pricePerShareLocal,
            execution: "order_book",
          };
          if (headerKey !== null) {
            try {
              const stored = await recordCompletedTradeResponse(
                db,
                headerKey,
                buildOrderBookFillFingerprint({
                  corpId: corporation._id,
                  sellerId: imperial._id,
                  shares: orderFill.shares,
                  pricePerShareLocal: orderFill.pricePerShareLocal,
                  proceedsAnchor: orderFill.proceedsAnchor,
                }),
                orderBookBody
              );
              return NextResponse.json(stored.body);
            } catch (error) {
              return mapTradeKeyError(error);
            }
          }
          return NextResponse.json(orderBookBody);
        }
      }

      const imperialPoolGate = gatePoolDepth();
      if (imperialPoolGate) return imperialPoolGate;

      // Wash-trade guard (see orderFlowWashGuard). Read-only; pinned below.
      const imperialWashExcluded =
        orderFlowEligible &&
        (await isOrderFlowWashRoundTrip(
          db,
          corporation._id,
          { imperialCharacterId: imperial._id },
          "sell",
          now
        ));

      const imperialSellDealer = await pinSellDealer();
      const imperialSellTurn = await getCurrentTurn(db);
      const imperialSellKey = headerKey ?? randomUUID();
      const imperialSellPlan: PublicShareTradePlan = {
        version: 1,
        tradeKey: imperialSellKey,
        kind: "market-sell",
        corpIdHex: corporation._id.toHexString(),
        corpName: corporation.name,
        shares,
        executionPrice,
        turn: imperialSellTurn,
        nowIso: now.toISOString(),
        orderFlowEligible,
        washExcluded: imperialWashExcluded,
        buyerDebit: null,
        capCredit: null,
        capDebit: {
          field: "imperialCharacterId",
          idHex: imperial._id.toHexString(),
          pricePerShare: shareholderEntry?.avgCostPerShare ?? executionPrice,
        },
        proceedsLeg: {
          collection: "imperialCharacters",
          idHex: imperial._id.toHexString(),
          field: personalBalanceField(imperialHomeCurrency, forexEnabled),
          amount: proceedsInImperialHome,
        },
        dealer: imperialSellDealer.dealer,
        ceoVacate: shouldVacateCeo ? ceoSnapshotOf(corporation) : null,
        closeTenureHolderIdHex: shouldVacateCeo ? imperial._id.toHexString() : null,
        tx: {
          type: "stock_trade_sell",
          subjectType: "character",
          subjectIdHex: imperial._id.toHexString(),
          subjectName: imperial.name,
          amount: proceedsInImperialHome,
          includeBalanceAfter: false,
          currencyCode: imperialHomeCurrency,
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
          kind: "market_sell",
          shares,
          pricePerShareAnchor: proceeds / shares,
          from: { imperialCharacterId: imperial._id, name: imperial.name },
          to: null,
          corpCurrencyCode: corporation.liquidCurrencyCode,
        },
        spread: null,
        audit: {
          counterpartyType: "character",
          counterpartyIdHex: imperial._id.toHexString(),
          counterpartyName: imperial.name,
          amount: proceedsInImperialHome,
          currencyCode: imperialHomeCurrency,
          shares,
          pricePerShare: executionPrice,
        },
        notifyTakeover: false,
        errors: {
          "buyer-debit": { message: "Failed to record trade", status: 500 },
          float: { message: "Failed to record trade", status: 500 },
          "buyer-credit": { message: "Failed to record trade", status: 500 },
          dealer: imperialSellDealer.error,
          "seller-debit": {
            message: "Shares were already sold or reserved by another action",
            status: 409,
          },
          "proceeds-credit": { message: "Imperial seller not found", status: 500 },
          history: { message: "Failed to record trade", status: 500 },
        },
        response: {
          success: true,
          sharesSold: shares,
          proceeds,
          pricePerShare: executionPrice,
        },
      };

      let imperialSellResult;
      try {
        imperialSellResult = await executePublicShareTradeFlow(db, imperialSellPlan, {
          idempotencyKey: imperialSellKey,
        });
      } catch (error) {
        return mapTradeKeyError(error);
      }
      if (!imperialSellResult.ok) {
        if (imperialSellResult.status === 400 && marketQuote.active) {
          return NextResponse.json(
            {
              error: imperialSellResult.error,
              marketDepthShares: marketQuote.bidDepthShares,
            },
            { status: 400 }
          );
        }
        return NextResponse.json(
          { error: imperialSellResult.error },
          { status: imperialSellResult.status }
        );
      }
      if (!imperialSellResult.replayed) {
        void logEconomicAction(db, {
          characterId: imperial._id,
          userId: basicAuth.user.userId,
          actionType: "sellShares",
          turn: imperialSellTurn,
          characterName: imperial.name,
          username: userDoc?.username,
          countryId: corporation.countryId,
          // `proceeds` is the ₳ (anchor) sale value gained (pricePerShareAnchor = proceeds/shares).
          // A sale spends no corp cash / MS, so only the gained revenue is logged.
          capturedRevenueAnchor: proceeds,
          currencyCode: corporation.liquidCurrencyCode,
          result: {
            success: true,
            message: `Sold ${shares.toLocaleString()} shares of ${corporation.name}`,
          },
        }).catch(() => {});
      }
      return NextResponse.json(imperialSellResult.body);
    }

    // ── Regular character sell path ───────────────────────────────
    const characterQuery = userDoc?.activeCharacterId
      ? { _id: userDoc.activeCharacterId, userId: new ObjectId(basicAuth.user.userId) }
      : { userId: new ObjectId(basicAuth.user.userId) };
    const charDoc = await db.collection<Character>("characters").findOne(characterQuery);
    if (!charDoc) {
      return NextResponse.json({ error: "Character not found" }, { status: 404 });
    }
    const sellTradeLock = await assertCeoTradeNotBlocked(db, corporation, charDoc._id);
    if (sellTradeLock.blocked) {
      return NextResponse.json({ error: sellTradeLock.error }, { status: sellTradeLock.status });
    }

    const shareholderEntry = corporation.shareholders?.find(
      (sh) => sh.characterId?.toString() === charDoc._id.toString()
    );
    const ownedShares = shareholderEntry?.shares ?? 0;

    // Character sell orders reserve shares without debiting the shareholder entry
    // (see orders POST — character path). Subtract their remaining quantity from
    // the available pool so a market sell can't race a pending limit order and
    // later produce phantom shares when the limit order silently fills.
    const openCharSellOrders = await db
      .collection<ShareOrder>("shareOrders")
      .find({
        corporationId: corporation._id,
        characterId: charDoc._id,
        type: "sell",
        status: "open",
        placerCorporationId: { $exists: false },
      })
      .toArray();
    const reservedInOrders = openCharSellOrders.reduce(
      (s, o) => s + (o.sharesDebitedAtCreation ? 0 : o.sharesRemaining),
      0
    );
    const availableShares = ownedShares - reservedInOrders;

    if (availableShares < shares) {
      return NextResponse.json(
        {
          error: `Only ${availableShares.toLocaleString()} shares available (${reservedInOrders.toLocaleString()} reserved in open sell orders)`,
        },
        { status: 400 }
      );
    }

    const shouldVacateCeo = charDoc._id.equals(corporation.ceoId) && availableShares === shares;
    if (shouldVacateCeo && !confirmCeoVacate) {
      return NextResponse.json(
        {
          error: `You are the CEO of ${corporation.name}. Selling all ${shares.toLocaleString()} of your remaining shares will remove you as CEO — this can't be undone, and you'd have to be re-appointed to become CEO again.`,
          requiresCeoVacateConfirm: true,
        },
        { status: 409 }
      );
    }
    // Proceeds are in ₳; convert to character's home currency before crediting.
    // Pinned before the flow so recovery replays the same figure.
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
    const proceedsInHome = forexEnabled ? proceeds * charFxRate : proceeds;

    if (!shouldVacateCeo) {
      const orderFill = await fillBestBuyOrderForMarketSell({
        db,
        corporation,
        seller: {
          id: charDoc._id,
          name: charDoc.name,
          collectionName: "characters",
          homeCurrency,
          isImperial: false,
        },
        shares,
        forexEnabled,
        sellerFxRate: charFxRate,
        now,
        turn: await getCurrentTurn(db),
      });
      if (orderFill.filled) {
        const orderBookBody = {
          success: true,
          sharesSold: orderFill.shares,
          proceeds: Math.round(orderFill.proceedsAnchor * 100) / 100,
          pricePerShare: orderFill.pricePerShareLocal,
          execution: "order_book",
        };
        if (headerKey !== null) {
          try {
            const stored = await recordCompletedTradeResponse(
              db,
              headerKey,
              buildOrderBookFillFingerprint({
                corpId: corporation._id,
                sellerId: charDoc._id,
                shares: orderFill.shares,
                pricePerShareLocal: orderFill.pricePerShareLocal,
                proceedsAnchor: orderFill.proceedsAnchor,
              }),
              orderBookBody
            );
            return NextResponse.json(stored.body);
          } catch (error) {
            return mapTradeKeyError(error);
          }
        }
        return NextResponse.json(orderBookBody);
      }
    }

    const charPoolGate = gatePoolDepth();
    if (charPoolGate) return charPoolGate;

    // Wash-trade guard (see orderFlowWashGuard). Read-only; pinned below.
    const charWashExcluded =
      orderFlowEligible &&
      (await isOrderFlowWashRoundTrip(
        db,
        corporation._id,
        { characterId: charDoc._id },
        "sell",
        now
      ));

    const charSellDealer = await pinSellDealer();
    const charSellTurn = await getCurrentTurn(db);
    const charSellKey = headerKey ?? randomUUID();
    const charSellPlan: PublicShareTradePlan = {
      version: 1,
      tradeKey: charSellKey,
      kind: "market-sell",
      corpIdHex: corporation._id.toHexString(),
      corpName: corporation.name,
      shares,
      executionPrice,
      turn: charSellTurn,
      nowIso: now.toISOString(),
      orderFlowEligible,
      washExcluded: charWashExcluded,
      buyerDebit: null,
      capCredit: null,
      capDebit: {
        field: "characterId",
        idHex: charDoc._id.toHexString(),
        pricePerShare: shareholderEntry?.avgCostPerShare ?? executionPrice,
      },
      proceedsLeg: {
        collection: "characters",
        idHex: charDoc._id.toHexString(),
        field: personalBalanceField(homeCurrency, forexEnabled),
        amount: proceedsInHome,
      },
      dealer: charSellDealer.dealer,
      ceoVacate: shouldVacateCeo ? ceoSnapshotOf(corporation) : null,
      closeTenureHolderIdHex: shouldVacateCeo ? charDoc._id.toHexString() : null,
      tx: {
        type: "stock_trade_sell",
        subjectType: "character",
        subjectIdHex: charDoc._id.toHexString(),
        subjectName: charDoc.name,
        amount: proceedsInHome,
        includeBalanceAfter: false,
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
        kind: "market_sell",
        shares,
        pricePerShareAnchor: proceeds / shares,
        from: { characterId: charDoc._id, name: charDoc.name },
        to: null,
        corpCurrencyCode: corporation.liquidCurrencyCode,
      },
      spread: null,
      audit: {
        counterpartyType: "character",
        counterpartyIdHex: charDoc._id.toHexString(),
        counterpartyName: charDoc.name,
        amount: proceedsInHome,
        currencyCode: homeCurrency,
        shares,
        pricePerShare: executionPrice,
      },
      notifyTakeover: false,
      errors: {
        "buyer-debit": { message: "Failed to record trade", status: 500 },
        float: { message: "Failed to record trade", status: 500 },
        "buyer-credit": { message: "Failed to record trade", status: 500 },
        dealer: charSellDealer.error,
        "seller-debit": {
          message: "Shares were already sold or reserved by another action",
          status: 409,
        },
        "proceeds-credit": { message: "Seller character not found", status: 500 },
        history: { message: "Failed to record trade", status: 500 },
      },
      response: {
        success: true,
        sharesSold: shares,
        proceeds,
        pricePerShare: executionPrice,
      },
    };

    let charSellResult;
    try {
      charSellResult = await executePublicShareTradeFlow(db, charSellPlan, {
        idempotencyKey: charSellKey,
      });
    } catch (error) {
      return mapTradeKeyError(error);
    }
    if (!charSellResult.ok) {
      if (charSellResult.status === 400 && marketQuote.active) {
        return NextResponse.json(
          {
            error: charSellResult.error,
            marketDepthShares: marketQuote.bidDepthShares,
          },
          { status: 400 }
        );
      }
      return NextResponse.json({ error: charSellResult.error }, { status: charSellResult.status });
    }
    if (!charSellResult.replayed) {
      void logEconomicAction(db, {
        characterId: charDoc._id,
        userId: basicAuth.user.userId,
        actionType: "sellShares",
        turn: charSellTurn,
        characterName: charDoc.name,
        username: userDoc?.username,
        countryId: corporation.countryId,
        // `proceeds` is the ₳ (anchor) sale value gained (pricePerShareAnchor = proceeds/shares).
        // A sale spends no corp cash / MS, so only the gained revenue is logged.
        capturedRevenueAnchor: proceeds,
        currencyCode: corporation.liquidCurrencyCode,
        result: {
          success: true,
          message: `Sold ${shares.toLocaleString()} shares of ${corporation.name}`,
        },
      }).catch(() => {});
    }
    return NextResponse.json(charSellResult.body);
  } catch (error) {
    return handleRouteError(error);
  }
}
