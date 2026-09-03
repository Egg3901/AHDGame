import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireCorporationActionsEnabled } from "@/lib/api/requireCorporationActions";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { sellSharesSchema } from "@/lib/api/schemas/corporations";
import { handleRouteError } from "@/lib/api/errors";
import { resolveCorporation } from "@/lib/api/corporations/resolveQuery";
import { assertCeoTradeNotBlocked } from "@/lib/corporations/commands/privatization/openVoteGuard";
import type { Character, Corporation, ShareOrder, User } from "@/lib/db/types";
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
import {
  buildPersonalBalanceInc,
  getHomeCurrency,
  loadCharacterFxRate,
} from "@/lib/currency/characterFunds";
import {
  anchorToCorpLiquidCapital,
  getCorpFxRate,
  resolveCorpLiquidCurrencyCode,
  shareTradeAnchorValue,
} from "@/lib/currency/corporationCapital";
import {
  isOrderFlowPriceEligible,
  resolveShareExecutionPrice,
} from "@/lib/corporations/marketExecution";
import {
  buildOrderFlowWindowInc,
  buildOrderFlowWindowIncReversal,
  isOrderFlowWashRoundTrip,
} from "@/lib/corporations/orderFlowWashGuard";
import { emitTx } from "@/lib/financialTxLog/emit";
import {
  settleFloatSellDebit,
  reverseFloatSellDebit,
  onFloatSellCommitted,
  type EscrowDebitSplit,
} from "@/lib/corporations/shareEscrowSettlement";
import { CURRENCY_SYMBOLS } from "@/lib/constants/currencies";
import { closeCeoTenure } from "@/lib/corporations/ceoHistory";
import { recordAudit } from "@/lib/audit/recordAudit";
import { rejectDuringTurn } from "@/lib/api/rejectDuringTurn";
import { fillBestBuyOrderForMarketSell } from "@/lib/corporations/commands/shareTrading/fillBestBuyOrder";

interface RouteParams {
  params: Promise<{ id: string }>;
}

function buildCeoRestoreUpdate(corporation: Corporation, now: Date) {
  const unsetFields: Record<string, ""> = {};
  if (corporation.ceoVacantSinceTurn === undefined) {
    unsetFields.ceoVacantSinceTurn = "";
  }
  if (!corporation.pendingCeoCharacterId) {
    unsetFields.pendingCeoCharacterId = "";
  }

  return {
    $set: {
      ceoId: corporation.ceoId,
      userId: corporation.userId,
      ceoVacant: corporation.ceoVacant ?? false,
      updatedAt: now,
      ...(corporation.ceoVacantSinceTurn !== undefined
        ? { ceoVacantSinceTurn: corporation.ceoVacantSinceTurn }
        : {}),
      ...(corporation.pendingCeoCharacterId
        ? { pendingCeoCharacterId: corporation.pendingCeoCharacterId }
        : {}),
    },
    ...(Object.keys(unsetFields).length > 0 ? { $unset: unsetFields } : {}),
  };
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
    const [db, forexEnabled] = await Promise.all([getDb(), isForexEnabled()]);
    const corpGuard = await requireCorporationActionsEnabled(db);
    if (corpGuard) return corpGuard;
    const turnGuard = await rejectDuringTurn(db);
    if (turnGuard) return turnGuard;

    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;
    const executionPrice = resolveShareExecutionPrice(corporation);
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
    const issuerBuyback = shares * executionPrice;
    const issuerCurrency = resolveCorpLiquidCurrencyCode(corporation) ?? "USD";
    // Hoisted so the outer-scope rollback paths can reverse the exact escrow/
    // treasury split recorded when the issuer buyback was settled.
    let issuerBuybackSplit: EscrowDebitSplit | undefined;
    async function gateIssuerBuyback(): Promise<NextResponse | null> {
      const settle = await settleFloatSellDebit(db, corporation, issuerBuyback);
      issuerBuybackSplit = settle.split;
      if (!settle.ok) {
        const sym = CURRENCY_SYMBOLS[issuerCurrency] ?? "$";
        return NextResponse.json(
          {
            error: `${corporation.name}'s treasury can't cover this sale (needs ${sym}${issuerBuyback.toLocaleString(undefined, { maximumFractionDigits: 0 })}). List the shares for sale to a real buyer instead.`,
          },
          { status: 400 }
        );
      }
      return null;
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

      const buybackGate = await gateIssuerBuyback();
      if (buybackGate) return buybackGate;

      // Wash-trade guard: a sell that round-trips this corp's own recent buy
      // contributes nothing to the order-flow window and neutralizes the buy
      // leg instead (see orderFlowWashGuard).
      const washExcluded =
        orderFlowEligible &&
        (await isOrderFlowWashRoundTrip(
          db,
          corporation._id,
          { corporationId: sellerCorp._id },
          "sell",
          now
        ));
      const orderFlowInc = buildOrderFlowWindowInc(
        orderFlowEligible,
        "sell",
        shares * executionPrice,
        washExcluded
      );
      const orderFlowIncReversal = buildOrderFlowWindowIncReversal(
        orderFlowEligible,
        "sell",
        shares * executionPrice,
        washExcluded
      );

      const remainingAfterSale = await debitSharesFromCorp(
        db,
        corporation._id,
        sellerCorp._id,
        shares,
        {
          $inc: {
            publicFloat: shares,
            ...orderFlowInc,
          },
          $set: { updatedAt: now },
        },
        { requireSufficient: true }
      );
      if (remainingAfterSale < 0) {
        await reverseFloatSellDebit(db, corporation, issuerBuyback, { split: issuerBuybackSplit });
        return NextResponse.json(
          { error: "Shares were already sold or reserved by another action" },
          { status: 409 }
        );
      }

      // Convert ₳-denominated proceeds into seller corp's home currency.
      const sellerFxRate = await getCorpFxRate(db, sellerCorp);
      const proceedsInSellerCapital = anchorToCorpLiquidCapital(proceeds, sellerCorp, sellerFxRate);

      const sellerCredit = await db
        .collection<Corporation>("corporations")
        .updateOne(
          { _id: sellerCorp._id },
          { $inc: { liquidCapital: proceedsInSellerCapital }, $set: { updatedAt: now } }
        );
      if (sellerCredit.matchedCount === 0) {
        await creditSharesToCorp(
          db,
          corporation._id,
          sellerCorp._id,
          shares,
          shareholderEntry.avgCostPerShare ?? executionPrice,
          {
            $inc: {
              publicFloat: -shares,
              ...orderFlowIncReversal,
            },
            $set: { updatedAt: new Date() },
          }
        );
        await reverseFloatSellDebit(db, corporation, issuerBuyback, { split: issuerBuybackSplit });
        throw new Error("Seller corporation not found");
      }

      void recordShareTrade(db, {
        corporationId: corporation._id,
        kind: "market_sell",
        turn: await getCurrentTurn(db),
        shares,
        pricePerShareAnchor: proceeds / shares,
        from: { corporationId: sellerCorp._id, name: sellerCorp.name },
        to: null,
        corpCurrencyCode: corporation.liquidCurrencyCode,
      });

      void logEconomicAction(db, {
        characterId: ceoId,
        userId: basicAuth.user.userId,
        actionType: "sellShares",
        turn: await getCurrentTurn(db),
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

      void emitTx(db, {
        type: "stock_trade_sell",
        turn: await getCurrentTurn(db),
        createdAt: now,
        subjectType: "corporation",
        subjectId: sellerCorp._id,
        subjectName: sellerCorp.name,
        amount: proceedsInSellerCapital,
        currencyCode: resolveCorpLiquidCurrencyCode(sellerCorp) ?? "USD",
        counterpartyType: "corporation",
        counterpartyId: corporation._id,
        counterpartyName: corporation.name,
        meta: {
          corporationId: corporation._id.toString(),
          shares,
          pricePerShare: executionPrice,
        },
      });

      // Sell committed: shares returned to the float and the issuer treasury was
      // debited (gateIssuerBuyback above). Symmetrically back out the realized
      // issuance proceeds so the share-price book-floor lever tracks the float
      // shrinking. Best-effort/terminal — never gates the committed sell.
      void onFloatSellCommitted(db, corporation, issuerBuyback);

      recordAudit({
        source: "api",
        action: "share.sell",
        category: "market",
        subject: { type: "corporation", id: corporation._id, name: corporation.name },
        counterparty: { type: "corporation", id: sellerCorp._id, name: sellerCorp.name },
        amount: proceedsInSellerCapital,
        currencyCode: resolveCorpLiquidCurrencyCode(sellerCorp) ?? "USD",
        refs: { corporationId: corporation._id },
        delta: [
          { field: "status", before: null, after: "filled" },
          { field: "shares", before: null, after: shares },
          { field: "pricePerShare", before: null, after: executionPrice },
        ],
        outcome: "ok",
      });

      return NextResponse.json({
        success: true,
        sharesSold: shares,
        proceeds,
        pricePerShare: executionPrice,
        seller: "corporation",
      });
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
      // Wash-trade guard (see orderFlowWashGuard): round-trip legs are excluded
      // from order-flow accumulation and neutralize the opposite leg instead.
      const washExcluded =
        orderFlowEligible &&
        (await isOrderFlowWashRoundTrip(
          db,
          corporation._id,
          { imperialCharacterId: imperial._id },
          "sell",
          now
        ));
      const orderFlowInc = buildOrderFlowWindowInc(
        orderFlowEligible,
        "sell",
        shares * executionPrice,
        washExcluded
      );
      const orderFlowIncReversal = buildOrderFlowWindowIncReversal(
        orderFlowEligible,
        "sell",
        shares * executionPrice,
        washExcluded
      );
      let corporationUpdate: {
        $inc: {
          publicFloat: number;
          orderFlowWindowSellValue?: number;
          orderFlowWindowBuyValue?: number;
        };
        $set: {
          updatedAt: Date;
          ceoVacant?: boolean;
          ceoVacantSinceTurn?: number;
        };
        $unset?: {
          ceoId: "";
          userId: "";
          pendingCeoCharacterId: "";
        };
      } = {
        $inc: {
          publicFloat: shares,
          ...orderFlowInc,
        },
        $set: { updatedAt: now },
      };
      if (shouldVacateCeo) {
        const currentTurn = await getCurrentTurn(db);
        corporationUpdate = {
          $inc: {
            publicFloat: shares,
            ...orderFlowInc,
          },
          $set: {
            ceoVacant: true,
            ceoVacantSinceTurn: currentTurn,
            updatedAt: now,
          },
          $unset: { ceoId: "", userId: "", pendingCeoCharacterId: "" },
        };
      }

      // Proceeds are in ₳; convert to imperial character's home currency before crediting.
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
          return NextResponse.json({
            success: true,
            sharesSold: orderFill.shares,
            proceeds: Math.round(orderFill.proceedsAnchor * 100) / 100,
            pricePerShare: orderFill.pricePerShareLocal,
            execution: "order_book",
          });
        }
      }

      const buybackGate = await gateIssuerBuyback();
      if (buybackGate) return buybackGate;

      const remainingAfterSale = await debitSharesFromImperial(
        db,
        corporation._id,
        imperial._id,
        shares,
        corporationUpdate,
        { requireSufficient: true }
      );
      if (remainingAfterSale < 0) {
        await reverseFloatSellDebit(db, corporation, issuerBuyback, { split: issuerBuybackSplit });
        return NextResponse.json(
          { error: "Shares were already sold or reserved by another action" },
          { status: 409 }
        );
      }

      const sellerCredit = await db.collection<ImperialCharacter>("imperialCharacters").updateOne(
        { _id: imperial._id },
        {
          $inc: {
            ...buildPersonalBalanceInc(proceedsInImperialHome, imperialHomeCurrency, forexEnabled),
          },
          $set: { updatedAt: now },
        }
      );
      if (sellerCredit.matchedCount === 0) {
        await creditSharesToImperial(
          db,
          corporation._id,
          imperial._id,
          shares,
          {
            $inc: {
              publicFloat: -shares,
              ...orderFlowIncReversal,
            },
            $set: { updatedAt: new Date() },
          },
          { pricePerShare: shareholderEntry?.avgCostPerShare ?? executionPrice }
        );
        if (shouldVacateCeo) {
          await db
            .collection<Corporation>("corporations")
            .updateOne({ _id: corporation._id }, buildCeoRestoreUpdate(corporation, new Date()));
        }
        await reverseFloatSellDebit(db, corporation, issuerBuyback, { split: issuerBuybackSplit });
        throw new Error("Imperial seller not found");
      }
      if (shouldVacateCeo) {
        void db
          .collection("corporationCeoVotes")
          .deleteMany({ corporationId: corporation._id })
          .catch(() => undefined);
        await closeCeoTenure(db, corporation._id, {
          holderId: imperial._id,
          turn: await getCurrentTurn(db),
        });
      }

      void recordShareTrade(db, {
        corporationId: corporation._id,
        kind: "market_sell",
        turn: await getCurrentTurn(db),
        shares,
        pricePerShareAnchor: proceeds / shares,
        from: { imperialCharacterId: imperial._id, name: imperial.name },
        to: null,
        corpCurrencyCode: corporation.liquidCurrencyCode,
      });

      void logEconomicAction(db, {
        characterId: imperial._id,
        userId: basicAuth.user.userId,
        actionType: "sellShares",
        turn: await getCurrentTurn(db),
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

      void emitTx(db, {
        type: "stock_trade_sell",
        turn: await getCurrentTurn(db),
        createdAt: now,
        subjectType: "character",
        subjectId: imperial._id,
        subjectName: imperial.name,
        amount: proceedsInImperialHome,
        currencyCode: imperialHomeCurrency,
        counterpartyType: "corporation",
        counterpartyId: corporation._id,
        counterpartyName: corporation.name,
        meta: {
          corporationId: corporation._id.toString(),
          shares,
          pricePerShare: executionPrice,
        },
      });

      // Sell committed (imperial): back out realized issuance proceeds to match
      // the float shrinking. Best-effort/terminal — never gates the committed sell.
      void onFloatSellCommitted(db, corporation, issuerBuyback);

      recordAudit({
        source: "api",
        action: "share.sell",
        category: "market",
        subject: { type: "corporation", id: corporation._id, name: corporation.name },
        counterparty: { type: "character", id: imperial._id, name: imperial.name },
        amount: proceedsInImperialHome,
        currencyCode: imperialHomeCurrency,
        refs: { corporationId: corporation._id },
        delta: [
          { field: "status", before: null, after: "filled" },
          { field: "shares", before: null, after: shares },
          { field: "pricePerShare", before: null, after: executionPrice },
        ],
        outcome: "ok",
      });

      return NextResponse.json({
        success: true,
        sharesSold: shares,
        proceeds,
        pricePerShare: executionPrice,
      });
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
    // Wash-trade guard (see orderFlowWashGuard): round-trip legs are excluded
    // from order-flow accumulation and neutralize the opposite leg instead.
    const washExcluded =
      orderFlowEligible &&
      (await isOrderFlowWashRoundTrip(
        db,
        corporation._id,
        { characterId: charDoc._id },
        "sell",
        now
      ));
    const orderFlowInc = buildOrderFlowWindowInc(
      orderFlowEligible,
      "sell",
      shares * executionPrice,
      washExcluded
    );
    const orderFlowIncReversal = buildOrderFlowWindowIncReversal(
      orderFlowEligible,
      "sell",
      shares * executionPrice,
      washExcluded
    );
    let corporationUpdate: {
      $inc: {
        publicFloat: number;
        orderFlowWindowSellValue?: number;
        orderFlowWindowBuyValue?: number;
      };
      $set: { updatedAt: Date; ceoVacant?: boolean; ceoVacantSinceTurn?: number };
      $unset?: { ceoId: ""; userId: ""; pendingCeoCharacterId: "" };
    } = {
      $inc: {
        publicFloat: shares,
        ...orderFlowInc,
      },
      $set: { updatedAt: now },
    };
    if (shouldVacateCeo) {
      const currentTurn = await getCurrentTurn(db);
      corporationUpdate = {
        $inc: {
          publicFloat: shares,
          ...orderFlowInc,
        },
        $set: {
          ceoVacant: true,
          ceoVacantSinceTurn: currentTurn,
          updatedAt: now,
        },
        $unset: { ceoId: "", userId: "", pendingCeoCharacterId: "" },
      };
    }

    // Proceeds are in ₳; convert to character's home currency before crediting.
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
        return NextResponse.json({
          success: true,
          sharesSold: orderFill.shares,
          proceeds: Math.round(orderFill.proceedsAnchor * 100) / 100,
          pricePerShare: orderFill.pricePerShareLocal,
          execution: "order_book",
        });
      }
    }

    const buybackGate = await gateIssuerBuyback();
    if (buybackGate) return buybackGate;

    const remainingAfterSale = await debitShares(
      db,
      corporation._id,
      charDoc._id,
      shares,
      corporationUpdate,
      { requireSufficient: true }
    );
    if (remainingAfterSale < 0) {
      await reverseFloatSellDebit(db, corporation, issuerBuyback, { split: issuerBuybackSplit });
      return NextResponse.json(
        { error: "Shares were already sold or reserved by another action" },
        { status: 409 }
      );
    }

    const sellerCredit = await db.collection<Character>("characters").updateOne(
      { _id: charDoc._id },
      {
        $inc: { ...buildPersonalBalanceInc(proceedsInHome, homeCurrency, forexEnabled) },
        $set: { updatedAt: now },
      }
    );
    if (sellerCredit.matchedCount === 0) {
      await creditShares(
        db,
        corporation._id,
        charDoc._id,
        shares,
        {
          $inc: {
            publicFloat: -shares,
            ...orderFlowIncReversal,
          },
          $set: { updatedAt: new Date() },
        },
        { pricePerShare: shareholderEntry?.avgCostPerShare ?? executionPrice }
      );
      if (shouldVacateCeo) {
        await db
          .collection<Corporation>("corporations")
          .updateOne({ _id: corporation._id }, buildCeoRestoreUpdate(corporation, new Date()));
      }
      await reverseFloatSellDebit(db, corporation, issuerBuyback, { split: issuerBuybackSplit });
      throw new Error("Seller character not found");
    }
    if (shouldVacateCeo) {
      void db
        .collection("corporationCeoVotes")
        .deleteMany({ corporationId: corporation._id })
        .catch(() => undefined);
      await closeCeoTenure(db, corporation._id, {
        holderId: charDoc._id,
        turn: await getCurrentTurn(db),
      });
    }

    void recordShareTrade(db, {
      corporationId: corporation._id,
      kind: "market_sell",
      turn: await getCurrentTurn(db),
      shares,
      pricePerShareAnchor: proceeds / shares,
      from: { characterId: charDoc._id, name: charDoc.name },
      to: null,
      corpCurrencyCode: corporation.liquidCurrencyCode,
    });

    void logEconomicAction(db, {
      characterId: charDoc._id,
      userId: basicAuth.user.userId,
      actionType: "sellShares",
      turn: await getCurrentTurn(db),
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

    void emitTx(db, {
      type: "stock_trade_sell",
      turn: await getCurrentTurn(db),
      createdAt: now,
      subjectType: "character",
      subjectId: charDoc._id,
      subjectName: charDoc.name,
      amount: proceedsInHome,
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

    // Sell committed (character): back out realized issuance proceeds to match
    // the float shrinking. Best-effort/terminal — never gates the committed sell.
    void onFloatSellCommitted(db, corporation, issuerBuyback);

    recordAudit({
      source: "api",
      action: "share.sell",
      category: "market",
      subject: { type: "corporation", id: corporation._id, name: corporation.name },
      counterparty: { type: "character", id: charDoc._id, name: charDoc.name },
      amount: proceedsInHome,
      currencyCode: homeCurrency,
      refs: { corporationId: corporation._id },
      delta: [
        { field: "status", before: null, after: "filled" },
        { field: "shares", before: null, after: shares },
        { field: "pricePerShare", before: null, after: executionPrice },
      ],
      outcome: "ok",
    });

    return NextResponse.json({
      success: true,
      sharesSold: shares,
      proceeds,
      pricePerShare: executionPrice,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
