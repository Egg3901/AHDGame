import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getDb } from "@/lib/mongodb";
import {
  MoneyFlowKeyConflictError,
  MoneyFlowTerminalError,
  keyedInsertId,
} from "@/lib/db/nonAtomicMoneyFlow";
import {
  SHARE_ORDER_PLACEMENT_ORDER_DOMAIN,
  executeShareOrderPlacementFlow,
  getStoredPlacementResponse,
  recoverShareOrderPlacementByKey,
  type ShareOrderPlacementDealer,
  type ShareOrderPlacementPlan,
} from "@/lib/corporations/shareOrderPlacement";
import { personalBalanceField } from "@/lib/corporations/commands/shareTrading/shareFillMoney";
import { requireCorporationActionsEnabled } from "@/lib/api/requireCorporationActions";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { placeOrderSchema } from "@/lib/api/schemas/corporations";
import { handleRouteError } from "@/lib/api/errors";
import { resolveCorporation } from "@/lib/api/corporations/resolveQuery";
import { assertCeoTradeNotBlocked } from "@/lib/corporations/commands/privatization/openVoteGuard";
import {
  corpPurchaseWouldCycle,
  OWNERSHIP_CYCLE_ERROR,
} from "@/lib/corporations/subsidiaries/cycleGuard";
import type { Corporation, ShareOrder } from "@/lib/db/types";
import { getCharacterByUserId } from "@/lib/db/characterLookup";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { getHomeCurrency, loadCharacterFxRate } from "@/lib/currency/characterFunds";
import type { CurrencyCode } from "@/lib/constants/currencies";
import {
  anchorToCorpLiquidCapital,
  corpLiquidCapitalToAnchor,
  estimateCorpWalletSpend,
  getCorpFxRate,
  loadFxRatesRecord,
  resolveCorpLiquidCurrencyCode,
  shareTradeAnchorValue,
} from "@/lib/currency/corporationCapital";
import { notifyHostileTakeoverThresholdIfEligible } from "@/lib/corporations/hostileTakeoverNotifications";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { assertCeoAcquisitionWithinCap } from "@/lib/corporations/ceoShareAcquisitionCap";
import { CURRENCY_SYMBOLS } from "@/lib/constants/currencies";
import {
  isOrderFlowPriceEligible,
  isWithinShareExecutionBand,
} from "@/lib/corporations/marketExecution";
import { equityPoolDepthMessage, loadEquityQuote } from "@/lib/equities/marketPool";
import { rejectDuringTurn } from "@/lib/api/rejectDuringTurn";
import { getShareBuybackMode } from "@/lib/corporations/shareBuybackMode";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/** Maps keyed-flow claim failures onto the legacy 409 surface. */
function mapPlacementKeyError(error: unknown): NextResponse {
  if (error instanceof MoneyFlowTerminalError) {
    return NextResponse.json(
      { error: "Placement already settled; start a new attempt with a new key." },
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

async function runPlacementKeyRecovery(
  db: import("mongodb").Db,
  placementKey: string
): Promise<NextResponse> {
  try {
    const recovered = await recoverShareOrderPlacementByKey(db, placementKey);
    if (!recovered.ok) {
      return NextResponse.json({ error: recovered.error }, { status: recovered.status });
    }
    return NextResponse.json(recovered.body);
  } catch (error) {
    return mapPlacementKeyError(error);
  }
}

/**
 * POST /api/corporations/[id]/shares/orders
 * Place a limit buy or sell order.
 *
 * Buy order: money escrowed immediately from corp `liquidCapital` or character
 * `currencyBalances.personal`. If current price <= limit price, fills immediately
 * from public float. Otherwise stays open until price drops.
 *
 * Sell order: shares debited from holdings immediately (`sharesDebitedAtCreation`).
 *   If current price >= limit price, fills immediately (money credited).
 *   Otherwise stays open until price rises.
 */
export async function placeShareOrder(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    // Crash-safe placement (issue #1672): the escrow debit, the share
    // reserve, the immediate-fill legs, and the order insert run as keyed
    // idempotent steps. `Idempotency-Key` replays the stored outcome
    // without moving money again.
    const headerKey = request.headers.get("Idempotency-Key");
    if (headerKey !== null && (headerKey.length === 0 || headerKey.length > 128)) {
      return NextResponse.json({ error: "Invalid Idempotency-Key header" }, { status: 400 });
    }

    const { id } = await params;
    const parsed = await parseJsonBody(request, placeOrderSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const { type, shares, pricePerShare, placeAsCorporation } = parsed.data;
    const db = await getDb();

    // Same-key retry: the first attempt already validated, so reconcile
    // through the stored plan instead of re-running the guards (which
    // post-debit reads would fail). Runs before the action/turn guards so
    // crash recovery converges even while fresh placements are blocked.
    if (headerKey !== null) {
      const prior = await getStoredPlacementResponse(db, headerKey);
      if (prior) {
        return runPlacementKeyRecovery(db, headerKey);
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
    const executionPrice = type === "buy" ? marketQuote.askPriceLocal : marketQuote.bidPriceLocal;
    const orderFlowEligible = isOrderFlowPriceEligible(
      corporation.publicFloat,
      corporation.totalShares
    );

    // Limit prices must sit inside the fundamental-anchored sanity band.
    // Wildly off-fundamental limit orders were used as manipulation rails
    // (2026-08-20 incident: limit fills ~10x fundamental inflated order-flow
    // notionals and moved real money at fabricated prices). Honest orders
    // near the market price are unaffected; the band only exists when the
    // corp has a positive fundamentalSharePrice to anchor on.
    if (!isWithinShareExecutionBand(corporation, pricePerShare)) {
      return NextResponse.json(
        {
          error: `Limit price is too far from ${corporation.name}'s fundamental share price. Place an order closer to the current valuation.`,
        },
        { status: 400 }
      );
    }

    const character = await getCharacterByUserId(db, auth.user.userId);
    if (!character) {
      return NextResponse.json({ error: "Character not found" }, { status: 404 });
    }
    const tradeLock = await assertCeoTradeNotBlocked(db, corporation, character._id);
    if (tradeLock.blocked) {
      return NextResponse.json({ error: tradeLock.error }, { status: tradeLock.status });
    }
    const now = new Date();
    const forexEnabled = await isForexEnabled();
    const homeCurrency = getHomeCurrency(character);

    // sharePrice and user-supplied pricePerShare are both denominated in the
    // target corp's liquidCurrencyCode (v0.2.6). Normalize to ₳ here; every
    // cost/proceeds/escrow calculation below reads through this rate.
    const targetFxRate = await getCorpFxRate(db, corporation);
    const currentTurn = await getCurrentTurn(db);

    // CEO self-acquisition cap: a personal buy order by the corp's own CEO counts
    // against the 10%/120-turn window (reserved at placement; open buy orders are
    // tallied by the guard). Corp-placed orders can't trade own shares (blocked below).
    if (!placeAsCorporation && type === "buy") {
      const ceoCap = await assertCeoAcquisitionWithinCap(
        db,
        corporation,
        character._id,
        "characterId",
        shares,
        currentTurn
      );
      if (ceoCap) return NextResponse.json({ error: ceoCap.error }, { status: ceoCap.status });
    }

    // Treasury-backed market maker: an immediate-fill sell into the float is
    // bought back from the ISSUER's own liquidCapital (its local currency),
    // capped at what the treasury holds. Mirrors the market-order sell route so
    // a limit order can't bypass the cap. (Pending orders that don't fill now
    // are filled later peer-to-peer or by the turn processor.)
    //
    // Crash-safe placement (issue #1672) pins the dealer routing and the
    // escrow-mode split here, before the keyed flow starts, so a retry
    // replays the same figures instead of re-reading post-debit state. The
    // pool-depth pre-check below stays in the route (read-only); the flow
    // re-guards the same message for a pool race at step time.
    const issuerBuyback = shares * executionPrice;
    const issuerCurrency = resolveCorpLiquidCurrencyCode(corporation) ?? "USD";
    const buybackMode = getShareBuybackMode(corporation);
    function poolDepthError(): { message: string; status: number } {
      return {
        message: equityPoolDepthMessage(marketQuote.bidDepthShares, marketQuote.currency),
        status: 400,
      };
    }
    function treasuryCoverError(): { message: string; status: number } {
      const sym = CURRENCY_SYMBOLS[issuerCurrency] ?? "$";
      return {
        message: `${corporation.name}'s treasury can't cover this sale (needs ${sym}${issuerBuyback.toLocaleString(undefined, { maximumFractionDigits: 0 })}). List the shares for sale to a real buyer instead.`,
        status: 400,
      };
    }
    /** Pool-depth gate shared by every immediate sell (legacy pre-check). */
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
    function pinBuyDealer(): ShareOrderPlacementDealer {
      if (marketQuote.active) {
        return {
          kind: "pool",
          currency: marketQuote.currency,
          amountLocal: issuerBuyback,
          flowKind: "purchasesIn",
        };
      }
      if (buybackMode === "escrow") return { kind: "escrow-credit", amountLocal: issuerBuyback };
      return { kind: "treasury", amountLocal: issuerBuyback };
    }
    /** Pins the sell dealer leg; reads the issuer escrow pot for the split. */
    async function pinSellDealer(): Promise<ShareOrderPlacementDealer> {
      if (marketQuote.active) {
        // Signed matcher convention: a pool sell debits pool cash, so the
        // pinned movement is negative with the salesOut counter side.
        return {
          kind: "pool",
          currency: marketQuote.currency,
          amountLocal: -issuerBuyback,
          flowKind: "salesOut",
        };
      }
      if (buybackMode === "escrow") {
        const issuerRow = await db
          .collection<Corporation>("corporations")
          .findOne({ _id: corporation._id }, { projection: { shareEscrowBalance: 1 } });
        const escrowBalance = issuerRow?.shareEscrowBalance ?? 0;
        const escrowPart = Math.min(issuerBuyback, Math.max(0, escrowBalance));
        return {
          kind: "escrow-split",
          amountLocal: issuerBuyback,
          escrowPart,
          treasuryPart: issuerBuyback - escrowPart,
        };
      }
      return { kind: "treasury", amountLocal: -issuerBuyback };
    }
    function sellDealerError(dealer: ShareOrderPlacementDealer): {
      message: string;
      status: number;
    } {
      if (dealer.kind === "pool") return poolDepthError();
      if (dealer.kind === "treasury") return treasuryCoverError();
      return { message: "Failed to place order", status: 500 };
    }
    const placementKey = headerKey ?? randomUUID();
    const orderIdHex = keyedInsertId(
      placementKey,
      SHARE_ORDER_PLACEMENT_ORDER_DOMAIN
    ).toHexString();
    /**
     * Run one fully-pinned placement plan. Fresh attempts settle the keyed
     * steps and return the legacy body; same-key retries converge on the
     * stored plan and return the stored body.
     */
    async function runPlacement(
      plan: Omit<ShareOrderPlacementPlan, "placementKey" | "orderIdHex">,
      immediate: boolean
    ): Promise<NextResponse> {
      try {
        const result = await executeShareOrderPlacementFlow(
          db,
          { ...plan, placementKey, orderIdHex },
          { idempotencyKey: placementKey }
        );
        if (!result.ok) {
          return NextResponse.json({ error: result.error }, { status: result.status });
        }
        if (immediate && !result.replayed) {
          void notifyHostileTakeoverThresholdIfEligible(db, corporation._id);
        }
        return NextResponse.json(result.body);
      } catch (error) {
        return mapPlacementKeyError(error);
      }
    }

    if (placeAsCorporation) {
      const placerCorp = await db
        .collection<Corporation>("corporations")
        .findOne({ ceoId: character._id, ceoVacant: { $ne: true } });
      if (!placerCorp) {
        return NextResponse.json(
          { error: "You must be an active CEO to place orders on behalf of a corporation" },
          { status: 403 }
        );
      }

      if (placerCorp._id.equals(corporation._id)) {
        return NextResponse.json(
          { error: "A corporation cannot trade its own shares" },
          { status: 400 }
        );
      }

      if (placerCorp.countryOwnerId) {
        return NextResponse.json(
          { error: "National corporations cannot hold equity positions" },
          { status: 400 }
        );
      }

      if (type === "buy" && (await corpPurchaseWouldCycle(db, placerCorp._id, corporation._id))) {
        return NextResponse.json({ error: OWNERSHIP_CYCLE_ERROR }, { status: 400 });
      }

      const placerFxRate = await getCorpFxRate(db, placerCorp);
      const placerCurrency = (resolveCorpLiquidCurrencyCode(placerCorp) ?? "USD") as CurrencyCode;
      const targetCurrency = (resolveCorpLiquidCurrencyCode(corporation) ?? "USD") as CurrencyCode;
      const fxRates = await loadFxRatesRecord(db);

      if (type === "buy") {
        const fillsNow = executionPrice <= pricePerShare;
        const publicFloat = corporation.publicFloat ?? 0;

        if (fillsNow && publicFloat >= shares) {
          const cost = shareTradeAnchorValue(
            shares,
            { ...corporation, sharePrice: executionPrice },
            targetFxRate
          );
          const corpPurchaseEstimate = estimateCorpWalletSpend({
            requiredAmount: shares * executionPrice,
            availableBalance: placerCorp.liquidCapital ?? 0,
            fromCurrency: placerCurrency,
            toCurrency: targetCurrency,
            rates: fxRates,
          });
          if (!corpPurchaseEstimate) {
            return NextResponse.json(
              { error: "Exchange rate unavailable, try again shortly" },
              { status: 503 }
            );
          }
          const costInPlacerCapital =
            placerCurrency !== targetCurrency
              ? corpPurchaseEstimate.spendAmount
              : anchorToCorpLiquidCapital(cost, placerCorp, placerFxRate);
          // Keyed placement (issue #1672): the balance-gated debit, the
          // float-guarded cap credit, the dealer credit, and the history
          // row run as exactly-once steps; the prefix compensates on a
          // guard failure so the legacy 400/409 surface is preserved.
          return runPlacement(
            {
              version: 1,
              kind: "buy-immediate",
              corpIdHex: corporation._id.toHexString(),
              corpName: corporation.name,
              shares,
              limitPrice: pricePerShare,
              executionPrice,
              turn: currentTurn,
              nowIso: now.toISOString(),
              orderFlowEligible,
              placerKind: "corporation",
              placerIdHex: placerCorp._id.toHexString(),
              placerName: placerCorp.name,
              characterIdHex: character._id.toHexString(),
              debitLeg: {
                collection: "corporations",
                idHex: placerCorp._id.toHexString(),
                field: "liquidCapital",
                amount: costInPlacerCapital,
              },
              proceedsLeg: null,
              capDebit: null,
              capCredit: {
                field: "corporationId",
                idHex: placerCorp._id.toHexString(),
                pricePerShare: executionPrice,
              },
              floatDelta: -shares,
              dealer: pinBuyDealer(),
              orderDoc: null,
              tx: {
                type: "stock_trade_buy",
                subjectType: "corporation",
                subjectIdHex: placerCorp._id.toHexString(),
                subjectName: placerCorp.name,
                amount: -costInPlacerCapital,
                includeBalanceAfter: true,
                currencyCode: resolveCorpLiquidCurrencyCode(placerCorp) ?? "USD",
                counterpartyType: "corporation",
                counterpartyName: corporation.name,
                counterpartyIdHex: corporation._id.toHexString(),
                meta: {
                  corporationId: corporation._id.toString(),
                  shares,
                  pricePerShare: executionPrice,
                  source: "limit_order_immediate_fill",
                },
              },
              history: {
                shares,
                pricePerShareAnchor: cost / shares,
                from: null,
                to: { corporationId: placerCorp._id, name: placerCorp.name },
                corpCurrencyCode: corporation.liquidCurrencyCode ?? undefined,
              },
              spread:
                placerCurrency !== targetCurrency
                  ? {
                      fee: corpPurchaseEstimate.spreadFee,
                      from: placerCurrency,
                      to: targetCurrency,
                    }
                  : null,
              audit: {
                counterpartyType: "corporation",
                counterpartyIdHex: placerCorp._id.toHexString(),
                counterpartyName: placerCorp.name,
                amount: -costInPlacerCapital,
                currencyCode: placerCurrency,
                orderType: "buy",
                status: "filled",
                shares,
                pricePerShare: executionPrice,
              },
              errors: {
                debit: { message: "Insufficient corporation funds", status: 400 },
                float: { message: "Not enough shares remain in public float", status: 409 },
                reserve: { message: "Not enough shares remain in public float", status: 409 },
                dealer: { message: "Failed to place order", status: 500 },
              },
              response: {
                success: true,
                filled: true,
                sharesBought: shares,
                cost: Math.round(cost * 100) / 100,
                spreadPaid:
                  placerCurrency !== targetCurrency
                    ? Math.round(corpPurchaseEstimate.spreadFee * 100) / 100
                    : 0,
                spreadCurrency: placerCurrency,
              },
            },
            true
          );
        }

        // pricePerShare is specified by the user in the target corp's local
        // currency. Escrow is STORED in that same currency (Option B) so that
        // partial fills subtract cleanly and cancels/refunds are FX-stable
        // relative to the fill math. Wallet debit/credit converts via ₳.
        const escrowAmount = shares * pricePerShare;
        const escrowAnchor = corpLiquidCapitalToAnchor(escrowAmount, corporation, targetFxRate);
        const escrowEstimate = estimateCorpWalletSpend({
          requiredAmount: escrowAmount,
          availableBalance: placerCorp.liquidCapital ?? 0,
          fromCurrency: placerCurrency,
          toCurrency: targetCurrency,
          rates: fxRates,
        });
        if (!escrowEstimate) {
          return NextResponse.json(
            { error: "Exchange rate unavailable, try again shortly" },
            { status: 503 }
          );
        }
        const escrowInPlacerCapital =
          placerCurrency !== targetCurrency
            ? escrowEstimate.spendAmount
            : anchorToCorpLiquidCapital(escrowAnchor, placerCorp, placerFxRate);
        // Keyed placement (issue #1672): the escrow debit and the order
        // insert run as exactly-once steps under the deterministic order
        // id, so a crash lands debited-with-no-order only until the retry
        // converges instead of forever.
        return runPlacement(
          {
            version: 1,
            kind: "buy-pending",
            corpIdHex: corporation._id.toHexString(),
            corpName: corporation.name,
            shares,
            limitPrice: pricePerShare,
            executionPrice,
            turn: currentTurn,
            nowIso: now.toISOString(),
            orderFlowEligible,
            placerKind: "corporation",
            placerIdHex: placerCorp._id.toHexString(),
            placerName: placerCorp.name,
            characterIdHex: character._id.toHexString(),
            debitLeg: {
              collection: "corporations",
              idHex: placerCorp._id.toHexString(),
              field: "liquidCapital",
              amount: escrowInPlacerCapital,
            },
            proceedsLeg: null,
            capDebit: null,
            capCredit: null,
            floatDelta: 0,
            dealer: null,
            orderDoc: {
              _id: keyedInsertId(placementKey, SHARE_ORDER_PLACEMENT_ORDER_DOMAIN),
              corporationId: corporation._id,
              characterId: character._id,
              placerCorporationId: placerCorp._id,
              type: "buy",
              shares,
              sharesRemaining: shares,
              pricePerShare,
              escrowAmount,
              status: "open",
              createdAt: now,
              updatedAt: now,
            } as ShareOrder,
            tx: {
              type: "stock_order_escrow",
              subjectType: "corporation",
              subjectIdHex: placerCorp._id.toHexString(),
              subjectName: placerCorp.name,
              amount: -escrowInPlacerCapital,
              includeBalanceAfter: true,
              currencyCode: resolveCorpLiquidCurrencyCode(placerCorp) ?? "USD",
              counterpartyType: "system",
              counterpartyName: "Order book escrow",
              meta: {
                corporationId: corporation._id.toString(),
                shares,
                pricePerShare,
              },
            },
            history: null,
            // The placer's FX spread is consumed at placement: cancel
            // refunds only the share value, not the spread markup, so it
            // rides post-commit. A compensated placement distributes
            // nothing, matching the legacy insert-failure refund.
            spread:
              placerCurrency !== targetCurrency
                ? {
                    fee: escrowEstimate.spreadFee,
                    from: placerCurrency,
                    to: targetCurrency,
                  }
                : null,
            audit: {
              counterpartyType: "corporation",
              counterpartyIdHex: placerCorp._id.toHexString(),
              counterpartyName: placerCorp.name,
              amount: -escrowInPlacerCapital,
              currencyCode: placerCurrency,
              orderType: "buy",
              status: "open",
              shares,
              pricePerShare,
            },
            errors: {
              debit: { message: "Insufficient corporation funds for escrow", status: 400 },
              float: { message: "Failed to place order", status: 500 },
              reserve: { message: "Failed to place order", status: 500 },
              dealer: { message: "Failed to place order", status: 500 },
            },
            response: {
              success: true,
              filled: false,
              escrowAmount,
              spreadPaid:
                placerCurrency !== targetCurrency
                  ? Math.round(escrowEstimate.spreadFee * 100) / 100
                  : 0,
              spreadCurrency: placerCurrency,
            },
          },
          false
        );
      } else {
        // Corp sell limit order
        const shareholderEntry = corporation.shareholders?.find(
          (sh) => sh.corporationId?.toString() === placerCorp._id.toString()
        );
        const ownedShares = shareholderEntry?.shares ?? 0;
        const openSellOrders = await db
          .collection<ShareOrder>("shareOrders")
          .find({
            corporationId: corporation._id,
            placerCorporationId: placerCorp._id,
            type: "sell",
            status: "open",
          })
          .toArray();
        const alreadyReserved = openSellOrders.reduce(
          (sum, o) => sum + (o.sharesDebitedAtCreation ? 0 : o.sharesRemaining),
          0
        );
        const available = ownedShares - alreadyReserved;
        if (available < shares) {
          return NextResponse.json(
            { error: `Only ${available.toLocaleString()} shares available` },
            { status: 400 }
          );
        }
        const fillsNow = executionPrice >= pricePerShare;
        if (fillsNow) {
          const proceeds =
            Math.round(
              shareTradeAnchorValue(
                shares,
                { ...corporation, sharePrice: executionPrice },
                targetFxRate
              ) * 100
            ) / 100;
          const proceedsInPlacerCapital = anchorToCorpLiquidCapital(
            proceeds,
            placerCorp,
            placerFxRate
          );
          const poolGate = gatePoolDepth();
          if (poolGate) return poolGate;
          const sellDealer = await pinSellDealer();
          // Keyed placement (issue #1672): the dealer debit, the seller
          // share debit, the proceeds credit, and the history row run as
          // exactly-once steps; the prefix compensates on a guard failure
          // so the legacy 400/409 surface is preserved.
          return runPlacement(
            {
              version: 1,
              kind: "sell-immediate",
              corpIdHex: corporation._id.toHexString(),
              corpName: corporation.name,
              shares,
              limitPrice: pricePerShare,
              executionPrice,
              turn: currentTurn,
              nowIso: now.toISOString(),
              orderFlowEligible,
              placerKind: "corporation",
              placerIdHex: placerCorp._id.toHexString(),
              placerName: placerCorp.name,
              characterIdHex: character._id.toHexString(),
              debitLeg: null,
              proceedsLeg: {
                collection: "corporations",
                idHex: placerCorp._id.toHexString(),
                field: "liquidCapital",
                amount: proceedsInPlacerCapital,
              },
              capDebit: {
                field: "corporationId",
                idHex: placerCorp._id.toHexString(),
                pricePerShare: shareholderEntry?.avgCostPerShare ?? executionPrice,
              },
              capCredit: null,
              floatDelta: shares,
              dealer: sellDealer,
              orderDoc: null,
              tx: {
                type: "stock_trade_sell",
                subjectType: "corporation",
                subjectIdHex: placerCorp._id.toHexString(),
                subjectName: placerCorp.name,
                amount: proceedsInPlacerCapital,
                includeBalanceAfter: false,
                currencyCode: resolveCorpLiquidCurrencyCode(placerCorp) ?? "USD",
                counterpartyType: "corporation",
                counterpartyName: corporation.name,
                counterpartyIdHex: corporation._id.toHexString(),
                meta: {
                  corporationId: corporation._id.toString(),
                  shares,
                  pricePerShare: executionPrice,
                  source: "limit_order_immediate_fill",
                },
              },
              history: {
                shares,
                pricePerShareAnchor: proceeds / shares,
                from: { corporationId: placerCorp._id, name: placerCorp.name },
                to: null,
                corpCurrencyCode: corporation.liquidCurrencyCode ?? undefined,
              },
              spread: null,
              audit: {
                counterpartyType: "corporation",
                counterpartyIdHex: placerCorp._id.toHexString(),
                counterpartyName: placerCorp.name,
                amount: proceedsInPlacerCapital,
                currencyCode: resolveCorpLiquidCurrencyCode(placerCorp) ?? "USD",
                orderType: "sell",
                status: "filled",
                shares,
                pricePerShare: executionPrice,
              },
              errors: {
                debit: { message: "Failed to place order", status: 500 },
                float: { message: "Failed to place order", status: 500 },
                reserve: {
                  message: "Shares were already sold or reserved by another action",
                  status: 409,
                },
                dealer: sellDealerError(sellDealer),
              },
              response: { success: true, filled: true, sharesSold: shares, proceeds },
            },
            true
          );
        }
        // Reserve shares by debiting from corp position (keyed, issue #1672):
        // the reserve and the order insert converge on retry instead of
        // stranding reserved shares when the insert throws.
        return runPlacement(
          {
            version: 1,
            kind: "sell-pending",
            corpIdHex: corporation._id.toHexString(),
            corpName: corporation.name,
            shares,
            limitPrice: pricePerShare,
            executionPrice,
            turn: currentTurn,
            nowIso: now.toISOString(),
            orderFlowEligible,
            placerKind: "corporation",
            placerIdHex: placerCorp._id.toHexString(),
            placerName: placerCorp.name,
            characterIdHex: character._id.toHexString(),
            debitLeg: null,
            proceedsLeg: null,
            capDebit: {
              field: "corporationId",
              idHex: placerCorp._id.toHexString(),
              pricePerShare: shareholderEntry?.avgCostPerShare ?? corporation.sharePrice,
            },
            capCredit: null,
            floatDelta: 0,
            dealer: null,
            orderDoc: {
              _id: keyedInsertId(placementKey, SHARE_ORDER_PLACEMENT_ORDER_DOMAIN),
              corporationId: corporation._id,
              characterId: character._id,
              placerCorporationId: placerCorp._id,
              type: "sell",
              shares,
              sharesRemaining: shares,
              sharesDebitedAtCreation: true,
              pricePerShare,
              escrowAmount: 0,
              status: "open",
              createdAt: now,
              updatedAt: now,
            } as ShareOrder,
            tx: null,
            history: null,
            spread: null,
            audit: {
              counterpartyType: "corporation",
              counterpartyIdHex: placerCorp._id.toHexString(),
              counterpartyName: placerCorp.name,
              orderType: "sell",
              status: "open",
              shares,
              pricePerShare,
            },
            errors: {
              debit: { message: "Failed to place order", status: 500 },
              float: { message: "Failed to place order", status: 500 },
              reserve: {
                message: "Shares were already sold or reserved by another action",
                status: 409,
              },
              dealer: { message: "Failed to place order", status: 500 },
            },
            response: { success: true, filled: false, sharesReserved: shares },
          },
          false
        );
      }
    }

    // Load character FX rate once for all character wallet operations.
    // escrowAmount stored in DB is in the target corp's liquidCurrencyCode
    // (Option B). Wallet debits/credits hop through ₳ via targetFxRate.
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

    if (type === "buy") {
      // Check if fills immediately (current price <= limit)
      const fillsNow = executionPrice <= pricePerShare;
      const publicFloat = corporation.publicFloat ?? 0;

      if (fillsNow && publicFloat >= shares) {
        // Immediate fill at current market price
        const cost = shareTradeAnchorValue(
          shares,
          { ...corporation, sharePrice: executionPrice },
          targetFxRate
        );
        const costInHome = cost * charFxRate;
        // Keyed placement (issue #1672): the wallet debit, the
        // float-guarded cap credit, the dealer credit, and the history row
        // run as exactly-once steps with the legacy 400/409 surface.
        return runPlacement(
          {
            version: 1,
            kind: "buy-immediate",
            corpIdHex: corporation._id.toHexString(),
            corpName: corporation.name,
            shares,
            limitPrice: pricePerShare,
            executionPrice,
            turn: currentTurn,
            nowIso: now.toISOString(),
            orderFlowEligible,
            placerKind: "character",
            placerIdHex: character._id.toHexString(),
            placerName: character.name,
            characterIdHex: character._id.toHexString(),
            debitLeg: {
              collection: "characters",
              idHex: character._id.toHexString(),
              field: personalBalanceField(homeCurrency, forexEnabled),
              amount: costInHome,
            },
            proceedsLeg: null,
            capDebit: null,
            capCredit: {
              field: "characterId",
              idHex: character._id.toHexString(),
              pricePerShare: executionPrice,
            },
            floatDelta: -shares,
            dealer: pinBuyDealer(),
            orderDoc: null,
            tx: {
              type: "stock_trade_buy",
              subjectType: "character",
              subjectIdHex: character._id.toHexString(),
              subjectName: character.name,
              amount: -costInHome,
              includeBalanceAfter: true,
              currencyCode: homeCurrency,
              counterpartyType: "corporation",
              counterpartyName: corporation.name,
              counterpartyIdHex: corporation._id.toHexString(),
              meta: {
                corporationId: corporation._id.toString(),
                shares,
                pricePerShare: executionPrice,
                source: "limit_order_immediate_fill",
              },
            },
            history: {
              shares,
              pricePerShareAnchor: cost / shares,
              from: null,
              to: { characterId: character._id, name: character.name },
              corpCurrencyCode: corporation.liquidCurrencyCode ?? undefined,
            },
            spread: null,
            audit: {
              counterpartyType: "character",
              counterpartyIdHex: character._id.toHexString(),
              counterpartyName: character.name,
              amount: -costInHome,
              currencyCode: homeCurrency,
              orderType: "buy",
              status: "filled",
              shares,
              pricePerShare: executionPrice,
            },
            errors: {
              debit: { message: "Insufficient funds for immediate fill", status: 400 },
              float: { message: "Not enough shares remain in public float", status: 409 },
              reserve: { message: "Not enough shares remain in public float", status: 409 },
              dealer: { message: "Failed to place order", status: 500 },
            },
            response: {
              success: true,
              filled: true,
              sharesBought: shares,
              cost: Math.round(cost * 100) / 100,
            },
          },
          true
        );
      }

      // Pending buy order — escrow stored in target corp's local currency
      // (Option B). Wallet debit converts local → ₳ → char home via the
      // target's FX; the stored escrowAmount is FX-stable against fill cost
      // because both are `shares × pricePerShare` in the same currency.
      const escrowAmount = shares * pricePerShare;
      const escrowAnchor = corpLiquidCapitalToAnchor(escrowAmount, corporation, targetFxRate);
      const escrowInHome = escrowAnchor * charFxRate;
      // Keyed placement (issue #1672): the escrow debit and the order
      // insert run as exactly-once steps under the deterministic order id.
      return runPlacement(
        {
          version: 1,
          kind: "buy-pending",
          corpIdHex: corporation._id.toHexString(),
          corpName: corporation.name,
          shares,
          limitPrice: pricePerShare,
          executionPrice,
          turn: currentTurn,
          nowIso: now.toISOString(),
          orderFlowEligible,
          placerKind: "character",
          placerIdHex: character._id.toHexString(),
          placerName: character.name,
          characterIdHex: character._id.toHexString(),
          debitLeg: {
            collection: "characters",
            idHex: character._id.toHexString(),
            field: personalBalanceField(homeCurrency, forexEnabled),
            amount: escrowInHome,
          },
          proceedsLeg: null,
          capDebit: null,
          capCredit: null,
          floatDelta: 0,
          dealer: null,
          orderDoc: {
            _id: keyedInsertId(placementKey, SHARE_ORDER_PLACEMENT_ORDER_DOMAIN),
            corporationId: corporation._id,
            characterId: character._id,
            type: "buy",
            shares,
            sharesRemaining: shares,
            pricePerShare,
            escrowAmount,
            status: "open",
            createdAt: now,
            updatedAt: now,
          } as ShareOrder,
          tx: {
            type: "stock_order_escrow",
            subjectType: "character",
            subjectIdHex: character._id.toHexString(),
            subjectName: character.name,
            amount: -escrowInHome,
            includeBalanceAfter: true,
            currencyCode: homeCurrency,
            counterpartyType: "system",
            counterpartyName: "Order book escrow",
            meta: {
              corporationId: corporation._id.toString(),
              shares,
              pricePerShare,
            },
          },
          history: null,
          spread: null,
          audit: {
            counterpartyType: "character",
            counterpartyIdHex: character._id.toHexString(),
            counterpartyName: character.name,
            amount: -escrowInHome,
            currencyCode: homeCurrency,
            orderType: "buy",
            status: "open",
            shares,
            pricePerShare,
          },
          errors: {
            debit: {
              message: `Insufficient funds. Need ${escrowInHome.toLocaleString(undefined, { minimumFractionDigits: 2 })} ${homeCurrency} in escrow`,
              status: 400,
            },
            float: { message: "Failed to place order", status: 500 },
            reserve: { message: "Failed to place order", status: 500 },
            dealer: { message: "Failed to place order", status: 500 },
          },
          response: { success: true, filled: false, escrowAmount },
        },
        false
      );
    } else {
      // Sell order — validate and reserve shares
      const shareholderEntry = corporation.shareholders?.find(
        (sh) => sh.characterId?.toString() === character._id.toString()
      );
      const ownedShares = shareholderEntry?.shares ?? 0;

      // Also check for already-reserved shares in open sell orders
      const openSellOrders = await db
        .collection<ShareOrder>("shareOrders")
        .find({
          corporationId: corporation._id,
          characterId: character._id,
          type: "sell",
          status: "open",
        })
        .toArray();
      const alreadyReserved = openSellOrders.reduce(
        (sum, o) => sum + (o.sharesDebitedAtCreation ? 0 : o.sharesRemaining),
        0
      );
      const availableShares = ownedShares - alreadyReserved;

      if (availableShares < shares) {
        return NextResponse.json(
          {
            error: `Only ${availableShares.toLocaleString()} shares available (${alreadyReserved.toLocaleString()} reserved in open orders)`,
          },
          { status: 400 }
        );
      }

      // Check if fills immediately (current price >= limit)
      const fillsNow = executionPrice >= pricePerShare;

      if (fillsNow) {
        // Immediate fill at current market price
        const proceeds = shareTradeAnchorValue(
          shares,
          { ...corporation, sharePrice: executionPrice },
          targetFxRate
        );
        const proceedsInHome = proceeds * charFxRate;

        const poolGate = gatePoolDepth();
        if (poolGate) return poolGate;
        const sellDealer = await pinSellDealer();
        // Keyed placement (issue #1672): the dealer debit, the seller
        // share debit, the proceeds credit, and the history row run as
        // exactly-once steps with the legacy 400/409 surface.
        return runPlacement(
          {
            version: 1,
            kind: "sell-immediate",
            corpIdHex: corporation._id.toHexString(),
            corpName: corporation.name,
            shares,
            limitPrice: pricePerShare,
            executionPrice,
            turn: currentTurn,
            nowIso: now.toISOString(),
            orderFlowEligible,
            placerKind: "character",
            placerIdHex: character._id.toHexString(),
            placerName: character.name,
            characterIdHex: character._id.toHexString(),
            debitLeg: null,
            proceedsLeg: {
              collection: "characters",
              idHex: character._id.toHexString(),
              field: personalBalanceField(homeCurrency, forexEnabled),
              amount: proceedsInHome,
            },
            capDebit: {
              field: "characterId",
              idHex: character._id.toHexString(),
              pricePerShare: shareholderEntry?.avgCostPerShare ?? executionPrice,
            },
            capCredit: null,
            floatDelta: shares,
            dealer: sellDealer,
            orderDoc: null,
            tx: {
              type: "stock_trade_sell",
              subjectType: "character",
              subjectIdHex: character._id.toHexString(),
              subjectName: character.name,
              amount: proceedsInHome,
              includeBalanceAfter: false,
              currencyCode: homeCurrency,
              counterpartyType: "corporation",
              counterpartyName: corporation.name,
              counterpartyIdHex: corporation._id.toHexString(),
              meta: {
                corporationId: corporation._id.toString(),
                shares,
                pricePerShare: executionPrice,
                source: "limit_order_immediate_fill",
              },
            },
            history: {
              shares,
              pricePerShareAnchor: proceeds / shares,
              from: { characterId: character._id, name: character.name },
              to: null,
              corpCurrencyCode: corporation.liquidCurrencyCode ?? undefined,
            },
            spread: null,
            audit: {
              counterpartyType: "character",
              counterpartyIdHex: character._id.toHexString(),
              counterpartyName: character.name,
              amount: proceedsInHome,
              currencyCode: homeCurrency,
              orderType: "sell",
              status: "filled",
              shares,
              pricePerShare: executionPrice,
            },
            errors: {
              debit: { message: "Failed to place order", status: 500 },
              float: { message: "Failed to place order", status: 500 },
              reserve: {
                message: "Shares were already sold or reserved by another action",
                status: 409,
              },
              dealer: sellDealerError(sellDealer),
            },
            response: {
              success: true,
              filled: true,
              sharesSold: shares,
              proceeds: Math.round(proceeds * 100) / 100,
            },
          },
          true
        );
      }

      // Pending sell: debit holdings now and set sharesDebitedAtCreation so
      // fill does not debit again. Cancel restores the shares. Keyed
      // (issue #1672): the reserve and the order insert converge on retry.
      return runPlacement(
        {
          version: 1,
          kind: "sell-pending",
          corpIdHex: corporation._id.toHexString(),
          corpName: corporation.name,
          shares,
          limitPrice: pricePerShare,
          executionPrice,
          turn: currentTurn,
          nowIso: now.toISOString(),
          orderFlowEligible,
          placerKind: "character",
          placerIdHex: character._id.toHexString(),
          placerName: character.name,
          characterIdHex: character._id.toHexString(),
          debitLeg: null,
          proceedsLeg: null,
          capDebit: {
            field: "characterId",
            idHex: character._id.toHexString(),
            pricePerShare: shareholderEntry?.avgCostPerShare ?? executionPrice,
          },
          capCredit: null,
          floatDelta: 0,
          dealer: null,
          orderDoc: {
            _id: keyedInsertId(placementKey, SHARE_ORDER_PLACEMENT_ORDER_DOMAIN),
            corporationId: corporation._id,
            characterId: character._id,
            type: "sell",
            shares,
            sharesRemaining: shares,
            sharesDebitedAtCreation: true,
            pricePerShare,
            escrowAmount: 0,
            status: "open",
            createdAt: now,
            updatedAt: now,
          } as ShareOrder,
          tx: null,
          history: null,
          spread: null,
          audit: {
            counterpartyType: "character",
            counterpartyIdHex: character._id.toHexString(),
            counterpartyName: character.name,
            orderType: "sell",
            status: "open",
            shares,
            pricePerShare,
          },
          errors: {
            debit: { message: "Failed to place order", status: 500 },
            float: { message: "Failed to place order", status: 500 },
            reserve: {
              message: "Shares were already sold or reserved by another action",
              status: 409,
            },
            dealer: { message: "Failed to place order", status: 500 },
          },
          response: { success: true, filled: false, sharesReserved: shares },
        },
        false
      );
    }
  } catch (error) {
    return handleRouteError(error);
  }
}
