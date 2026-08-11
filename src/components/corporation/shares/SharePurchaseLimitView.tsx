"use client";

import { useState } from "react";
import { useCurrency } from "@/contexts/CurrencyContext";
import { requestCharacterStatsRefetch } from "@/lib/characterStatsSync";
import { formatSharePriceOrder } from "@/lib/utils/formatters";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { MyShareOrder } from "../CorporationPageTypes";
import type { OrderSide } from "./sharePurchaseModalTypes";

interface SharePurchaseLimitViewProps {
  orderSide: OrderSide;
  limitAsCorp: boolean;
  quantity: number;
  quantityDraft: string | null;
  limitPrice: number;
  successMsg: string;
  onSwitchSide: (side: OrderSide) => void;
  setLimitAsCorp: (v: boolean) => void;
  setQuantity: (v: number) => void;
  setQuantityDraft: (v: string | null) => void;
  setLimitPrice: (v: number) => void;
  resetQuantity: (q: number) => void;
  parseQtyDigits: (raw: string, max?: number) => number;
  onSwitchToOrders: () => void;
  onSuccess: () => void;
  myCorporation: {
    id: string;
    name: string;
    liquidCapital: number;
    liquidCurrencyCode?: string;
  } | null;
  myShares: number;
  myCorporationShares: number;
  corpId: string;
  corpCurrencyCode: CurrencyCode | undefined;
  personalCashAnchor: number;
  myCorpLiquidInternal: number;
  myCorpLiquidCurrency: CurrencyCode;
  limitSellSharesAvail: number;
  maxLimitBuyShares: number;
  buyCost: number;
  limitBuyBudget: number;
  limitPersonalBudgetLabel: string;
  limitPersonalBudgetValue: string;
  limitPersonalAfterPurchase: string;
  corpLimitAfterEscrow: string;
  limitBuyFundsShort: boolean;
  limitSellInsufficient: boolean;
  limitBuyFillsNow: boolean;
  limitSellFillsNow: boolean;
  ratesNeededButMissing: boolean;
  estimatedFxFeeAnchor: number;
  inputSymbol: string;
  openBuyOrders: MyShareOrder[];
  openSellOrders: MyShareOrder[];
}

export function SharePurchaseLimitView({
  orderSide,
  limitAsCorp,
  quantity,
  quantityDraft,
  limitPrice,
  successMsg,
  onSwitchSide,
  setLimitAsCorp,
  setQuantity,
  setQuantityDraft,
  setLimitPrice,
  resetQuantity,
  parseQtyDigits,
  onSwitchToOrders,
  onSuccess,
  myCorporation,
  myShares,
  myCorporationShares,
  corpId,
  corpCurrencyCode,
  personalCashAnchor,
  myCorpLiquidInternal,
  myCorpLiquidCurrency,
  limitSellSharesAvail,
  maxLimitBuyShares,
  buyCost,
  limitBuyBudget,
  limitPersonalBudgetLabel,
  limitPersonalBudgetValue,
  limitPersonalAfterPurchase,
  corpLimitAfterEscrow,
  limitBuyFundsShort,
  limitSellInsufficient,
  limitBuyFillsNow,
  limitSellFillsNow,
  ratesNeededButMissing,
  estimatedFxFeeAnchor,
  inputSymbol,
  openBuyOrders,
  openSellOrders,
}: SharePurchaseLimitViewProps) {
  const { formatAmount, formatPriceOrder, toInternalFrom, toInternal } = useCurrency();
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const sellProceeds = quantity * toInternal(limitPrice);

  async function handleCancelOrder(orderId: string) {
    setCancellingId(orderId);
    try {
      const res = await fetch(`/api/corporations/${corpId}/shares/orders/${orderId}`, {
        method: "DELETE",
      });
      if (!res.ok) return;
      onSuccess();
      requestCharacterStatsRefetch();
    } catch {
      // swallow — parent error display handles broader errors
    } finally {
      setCancellingId(null);
    }
  }

  return (
    <div className="space-y-4">
      {/* Buy / Sell toggle */}
      <div className="flex overflow-hidden rounded-lg border border-card-border text-xs">
        <button
          type="button"
          onClick={() => onSwitchSide("buy")}
          className={`flex-1 border-r border-card-border py-2.5 text-center font-semibold transition-colors ${
            orderSide === "buy"
              ? "bg-success/15 text-success"
              : "bg-card-elevated text-muted hover:text-foreground"
          }`}
        >
          Buy Order
        </button>
        <button
          type="button"
          onClick={() => onSwitchSide("sell")}
          className={`flex-1 py-2.5 text-center font-semibold transition-colors ${
            orderSide === "sell"
              ? "bg-error/15 text-error"
              : "bg-card-elevated text-muted hover:text-foreground"
          }`}
        >
          Sell Order
        </button>
      </div>

      {/* Corp / Personal toggle (CEOs of other corporations only) */}
      {myCorporation && (
        <div className="flex overflow-hidden rounded-lg border border-card-border text-xs">
          <button
            type="button"
            onClick={() => {
              setLimitAsCorp(false);
              resetQuantity(0);
            }}
            className={`flex-1 border-r border-card-border px-3 py-2.5 text-left transition-colors ${
              !limitAsCorp
                ? "bg-primary/10 text-primary"
                : "bg-card-elevated text-muted hover:text-foreground"
            }`}
          >
            <div className="font-semibold">Personally</div>
            <div
              className={`mt-0.5 tabular-nums ${!limitAsCorp ? "text-primary/70" : "text-muted/60"}`}
            >
              {orderSide === "buy"
                ? `${formatAmount(personalCashAnchor)} cash`
                : `${myShares.toLocaleString("en-US")} shares`}
            </div>
          </button>
          <button
            type="button"
            onClick={() => {
              if (orderSide === "sell" && myCorporationShares === 0) return;
              setLimitAsCorp(true);
              resetQuantity(0);
            }}
            disabled={orderSide === "sell" && myCorporationShares === 0}
            title={
              orderSide === "sell" && myCorporationShares === 0
                ? "Your corporation holds no shares here"
                : undefined
            }
            className={`flex-1 px-3 py-2.5 text-left transition-colors ${
              orderSide === "sell" && myCorporationShares === 0
                ? "opacity-40 cursor-not-allowed bg-card-elevated text-muted"
                : limitAsCorp
                  ? "bg-primary/10 text-primary"
                  : "bg-card-elevated text-muted hover:text-foreground"
            }`}
          >
            <div className="font-semibold">{myCorporation.name}</div>
            <div
              className={`mt-0.5 tabular-nums ${limitAsCorp ? "text-primary/70" : "text-muted/60"}`}
            >
              {orderSide === "buy"
                ? `${formatAmount(myCorpLiquidInternal, myCorpLiquidCurrency)} liquid`
                : myCorporationShares === 0
                  ? "No shares held"
                  : `${myCorporationShares.toLocaleString("en-US")} shares`}
            </div>
          </button>
        </div>
      )}

      {/* Auto-execution explanation */}
      <div className="rounded-lg border border-card-border bg-card-elevated/40 px-3 py-2.5 text-xs text-muted space-y-1">
        {orderSide === "buy" ? (
          <>
            <p>
              Your order executes automatically when{" "}
              <strong className="text-foreground">either</strong>:
            </p>
            <ul className="ml-3 space-y-0.5">
              <li>· The market price drops to or below your limit, and float is available</li>
              <li>· Another player fills some or all of it directly (partial fills allowed)</li>
            </ul>
            <p className="pt-1">Funds are held in escrow until filled or cancelled.</p>
          </>
        ) : (
          <>
            <p>
              Your order executes automatically when{" "}
              <strong className="text-foreground">either</strong>:
            </p>
            <ul className="ml-3 space-y-0.5">
              <li>· The market price rises to or above your limit</li>
              <li>· Another player fills some or all of it directly (partial fills allowed)</li>
            </ul>
            <p className="pt-1">Shares are reserved until filled or cancelled.</p>
          </>
        )}
      </div>

      {/* Inputs */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1.5 block text-xs text-muted">
            {orderSide === "buy"
              ? "Shares to buy"
              : `Shares to sell · ${limitSellSharesAvail.toLocaleString("en-US")} available`}
          </label>
          <input
            type="text"
            inputMode="numeric"
            value={quantityDraft !== null ? quantityDraft : quantity === 0 ? "" : String(quantity)}
            onFocus={() => setQuantityDraft(quantity === 0 ? "" : String(quantity))}
            onChange={(e) => {
              const raw = e.target.value;
              setQuantityDraft(raw);
              const cap =
                orderSide === "sell"
                  ? limitSellSharesAvail
                  : Number.isFinite(maxLimitBuyShares)
                    ? maxLimitBuyShares
                    : undefined;
              setQuantity(parseQtyDigits(raw, cap));
            }}
            onBlur={() => setQuantityDraft(null)}
            placeholder="Quantity"
            className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm focus:border-primary/60 focus:outline-none"
          />
          {limitSellInsufficient && (
            <p className="mt-1 text-xs text-error">
              {limitAsCorp
                ? `Corporation holds only ${myCorporationShares.toLocaleString("en-US")} shares.`
                : `You only own ${myShares.toLocaleString("en-US")} shares.`}
            </p>
          )}
        </div>
        <div>
          <label className="mb-1.5 block text-xs text-muted">
            {orderSide === "buy"
              ? `Max price (${inputSymbol}/share)`
              : `Min price (${inputSymbol}/share)`}
          </label>
          <input
            type="number"
            value={limitPrice || ""}
            onChange={(e) => setLimitPrice(Math.max(0, Number(e.target.value)))}
            step={0.01}
            min={0.01}
            className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm focus:border-primary/60 focus:outline-none"
          />
        </div>
      </div>

      {/* Immediate fill indicator */}
      {quantity > 0 && limitPrice > 0 && (
        <div
          className={`rounded-lg border px-3 py-2 text-xs ${
            (orderSide === "buy" && limitBuyFillsNow) || (orderSide === "sell" && limitSellFillsNow)
              ? "border-success/30 bg-success/5 text-success"
              : "border-card-border bg-card-elevated/40 text-muted"
          }`}
        >
          {orderSide === "buy" && limitBuyFillsNow && (
            <>
              ✓ Fills immediately — your limit ({formatSharePriceOrder(limitPrice, inputSymbol)}) is
              at or above market
            </>
          )}
          {orderSide === "buy" && !limitBuyFillsNow && (
            <>
              Queued — fills when price drops to {formatSharePriceOrder(limitPrice, inputSymbol)} or
              a seller fills it
            </>
          )}
          {orderSide === "sell" && limitSellFillsNow && (
            <>
              ✓ Fills immediately — your limit ({formatSharePriceOrder(limitPrice, inputSymbol)}) is
              at or below market
            </>
          )}
          {orderSide === "sell" && !limitSellFillsNow && (
            <>
              Queued — fills when price rises to {formatSharePriceOrder(limitPrice, inputSymbol)} or
              a buyer fills it
            </>
          )}
        </div>
      )}

      {/* Cost / proceeds summary */}
      {quantity > 0 && (
        <div className="rounded-lg border border-card-border bg-card-elevated/40 p-4 space-y-2 text-sm">
          {orderSide === "buy" ? (
            <>
              <div className="flex justify-between">
                <span className="text-muted">Escrow amount</span>
                <span
                  className={`tabular-nums font-medium ${limitBuyFundsShort ? "text-error" : "text-foreground"}`}
                >
                  {formatAmount(Math.round(buyCost))}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">
                  {limitAsCorp ? "Corp liquid capital" : limitPersonalBudgetLabel}
                </span>
                <span className="tabular-nums font-medium">
                  {limitAsCorp ? formatAmount(limitBuyBudget) : limitPersonalBudgetValue}
                </span>
              </div>
              {estimatedFxFeeAnchor > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted">Est. FX fee</span>
                  <span className="tabular-nums font-medium text-warning">
                    {formatAmount(Math.round(estimatedFxFeeAnchor))}
                  </span>
                </div>
              )}
              {!ratesNeededButMissing && (
                <div className="flex justify-between border-t border-card-border pt-2">
                  <span className="text-muted">After escrowing</span>
                  <span
                    className={`tabular-nums font-medium ${limitBuyFundsShort ? "text-error" : "text-foreground"}`}
                  >
                    {limitAsCorp ? corpLimitAfterEscrow : limitPersonalAfterPurchase}
                  </span>
                </div>
              )}
              {ratesNeededButMissing && (
                <p className="text-xs text-muted border-t border-card-border pt-2">
                  Loading market rates…
                </p>
              )}
            </>
          ) : (
            <>
              <div className="flex justify-between">
                <span className="text-muted">Proceeds when filled</span>
                <span className="tabular-nums font-medium text-success">
                  {formatAmount(Math.round(sellProceeds))}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Shares reserved</span>
                <span className="tabular-nums font-medium">{quantity.toLocaleString("en-US")}</span>
              </div>
              <div className="flex justify-between border-t border-card-border pt-2">
                <span className="text-muted">Shares remaining after fill</span>
                <span className="tabular-nums font-medium text-muted">
                  {(myShares - quantity).toLocaleString("en-US")}
                </span>
              </div>
            </>
          )}
        </div>
      )}

      {/* Existing orders for this side */}
      {orderSide === "buy" && openBuyOrders.length > 0 && (
        <div className="rounded-lg border border-card-border bg-card-elevated/40 p-3 space-y-2">
          <p className="text-xs font-medium text-muted">
            {openBuyOrders.length} open buy order{openBuyOrders.length !== 1 ? "s" : ""}
            {" · "}
            <button onClick={onSwitchToOrders} className="text-primary hover:underline">
              Manage
            </button>
          </p>
          {openBuyOrders.map((o) => (
            <div key={o._id} className="flex items-center justify-between text-xs text-muted">
              <span>
                {o.sharesRemaining.toLocaleString("en-US")} @{" "}
                {formatPriceOrder(
                  corpCurrencyCode
                    ? toInternalFrom(o.pricePerShare, corpCurrencyCode)
                    : o.pricePerShare,
                  corpCurrencyCode
                )}
                {" · "}
                {formatAmount(
                  Math.round(
                    corpCurrencyCode
                      ? toInternalFrom(o.escrowAmount, corpCurrencyCode)
                      : o.escrowAmount
                  )
                )}{" "}
                escrowed
              </span>
              <button
                onClick={() => handleCancelOrder(o._id)}
                disabled={cancellingId === o._id}
                className="ml-3 text-error hover:text-error/80 transition-colors disabled:opacity-50"
              >
                {cancellingId === o._id ? "…" : "Cancel"}
              </button>
            </div>
          ))}
        </div>
      )}
      {orderSide === "sell" && openSellOrders.length > 0 && (
        <div className="rounded-lg border border-card-border bg-card-elevated/40 p-3 space-y-2">
          <p className="text-xs font-medium text-muted">
            {openSellOrders.length} open sell order{openSellOrders.length !== 1 ? "s" : ""}
            {" · "}
            <button onClick={onSwitchToOrders} className="text-primary hover:underline">
              Manage
            </button>
          </p>
          {openSellOrders.map((o) => (
            <div key={o._id} className="flex items-center justify-between text-xs text-muted">
              <span>
                {o.sharesRemaining.toLocaleString("en-US")} @{" "}
                {formatPriceOrder(
                  corpCurrencyCode
                    ? toInternalFrom(o.pricePerShare, corpCurrencyCode)
                    : o.pricePerShare,
                  corpCurrencyCode
                )}
                {" · "}
                {formatAmount(
                  Math.round(
                    corpCurrencyCode
                      ? toInternalFrom(o.sharesRemaining * o.pricePerShare, corpCurrencyCode)
                      : o.sharesRemaining * o.pricePerShare
                  )
                )}{" "}
                on fill
              </span>
              <button
                onClick={() => handleCancelOrder(o._id)}
                disabled={cancellingId === o._id}
                className="ml-3 text-error hover:text-error/80 transition-colors disabled:opacity-50"
              >
                {cancellingId === o._id ? "…" : "Cancel"}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Success message (modal stays open to place more) */}
      {successMsg && (
        <div className="rounded-lg border border-success/30 bg-success/5 px-3 py-2.5 text-xs text-success">
          {successMsg}
        </div>
      )}
    </div>
  );
}
