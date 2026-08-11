"use client";

import Link from "next/link";
import { useCurrency } from "@/contexts/CurrencyContext";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { MarketOrder } from "../CorporationPageTypes";

interface OpenOrdersPanelProps {
  marketOrders: MarketOrder[];
  myCharacterId: string | null;
  /** Target corp's currencyCode — order.pricePerShare is stored in this currency (Option B). */
  corpCurrencyCode?: CurrencyCode;
  myCorporation: {
    id: string;
    name: string;
    liquidCapital: number;
    liquidCurrencyCode?: string;
  } | null;
  fillAmounts: Record<string, number>;
  setFillAmounts: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  fillAskAsCorp: boolean;
  setFillAskAsCorp: React.Dispatch<React.SetStateAction<boolean>>;
  loading: boolean;
  handleFillOrder: (orderId: string, orderType: "buy" | "sell", shares?: number) => Promise<void>;
  handleCancelOrder: (orderId: string) => Promise<void>;
}

export default function OpenOrdersPanel({
  marketOrders,
  myCharacterId,
  corpCurrencyCode,
  myCorporation,
  fillAmounts,
  setFillAmounts,
  fillAskAsCorp,
  setFillAskAsCorp,
  loading,
  handleFillOrder,
  handleCancelOrder,
}: OpenOrdersPanelProps) {
  const { formatPriceOrder, formatAmount, toInternalFrom } = useCurrency();
  // Share prices on dev are currently LOCAL under Option B (pre-forex-v2 behavior
  // once merged). Route through `corpCurrencyCode` normalization so wallet-pref
  // display renders correctly for non-USD target corps.
  const displayPrice = (local: number) =>
    corpCurrencyCode
      ? formatPriceOrder(toInternalFrom(local, corpCurrencyCode), corpCurrencyCode)
      : formatPriceOrder(local);
  const buyOrders = marketOrders.filter((o) => o.type === "buy");
  const sellOrders = marketOrders.filter((o) => o.type === "sell");
  const myCorpLiquidCurrency = (myCorporation?.liquidCurrencyCode ?? "USD") as CurrencyCode;
  const myCorpLiquidInternal = myCorporation
    ? toInternalFrom(myCorporation.liquidCapital, myCorpLiquidCurrency)
    : 0;

  return (
    <div className="rounded-xl border border-card-border bg-card p-6">
      <h2 className="text-lg font-bold text-foreground mb-4">Open Orders</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        {/* Buy Orders (Bids) — someone wants to buy; you can sell to them */}
        <div>
          <div className="text-xs font-semibold text-success uppercase tracking-wider mb-3">
            Buy Orders (Bids)
          </div>
          {buyOrders.length === 0 ? (
            <p className="text-xs text-muted">No buy orders</p>
          ) : (
            <div className="divide-y divide-card-border/50 rounded-lg border border-card-border overflow-hidden">
              {buyOrders.map((order) => (
                <div
                  key={order._id}
                  className={`px-4 py-3 ${order.isMine ? "bg-primary/5" : "bg-card-elevated/30"}`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <span className="text-sm text-foreground font-medium">
                        {order.sharesRemaining.toLocaleString("en-US")} shares
                      </span>
                      <span className="text-sm text-muted ml-2">
                        @ {displayPrice(order.pricePerShare)}
                      </span>
                    </div>
                    <div className="text-right">
                      {order.characterSequentialId ? (
                        <Link
                          href={`/character/${order.characterSequentialId}`}
                          className="text-xs text-primary hover:underline"
                        >
                          {order.characterName}
                        </Link>
                      ) : (
                        <span className="text-xs text-muted">{order.characterName}</span>
                      )}
                      {order.isMine && (
                        <span className="ml-1 text-xs text-primary font-medium">(You)</span>
                      )}
                    </div>
                  </div>
                  {!order.isMine && myCharacterId && (
                    <div className="flex items-center gap-2 mt-1">
                      <input
                        type="number"
                        value={fillAmounts[order._id] || ""}
                        onChange={(e) =>
                          setFillAmounts((prev) => ({
                            ...prev,
                            [order._id]: Math.min(
                              order.sharesRemaining,
                              Math.max(1, Math.floor(Number(e.target.value)))
                            ),
                          }))
                        }
                        placeholder="Shares"
                        min={1}
                        max={order.sharesRemaining}
                        className="w-24 rounded border border-card-border bg-background px-2 py-1 text-xs focus:border-primary/60 focus:outline-none"
                      />
                      <button
                        onClick={() => handleFillOrder(order._id, "buy", fillAmounts[order._id])}
                        disabled={loading || !fillAmounts[order._id]}
                        className="rounded bg-error/80 px-3 py-1 text-xs font-medium text-white hover:bg-error transition-colors disabled:opacity-50"
                      >
                        Sell
                      </button>
                    </div>
                  )}
                  {order.isMine && (
                    <div className="flex items-center justify-end mt-1">
                      <button
                        onClick={() => handleCancelOrder(order._id)}
                        disabled={loading}
                        className="text-xs text-error hover:text-error/80 transition-colors disabled:opacity-50"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Sell Orders (Asks) — someone wants to sell; you can buy from them */}
        <div>
          <div className="text-xs font-semibold text-error uppercase tracking-wider mb-3">
            Sell Orders (Asks)
          </div>
          {myCorporation && sellOrders.some((o) => !o.isMine) && (
            <div className="mb-3">
              <label className="mb-1.5 block text-xs text-muted">Buy asks using</label>
              <div className="flex overflow-hidden rounded-lg border border-card-border text-xs">
                <button
                  type="button"
                  onClick={() => setFillAskAsCorp(false)}
                  className={`flex-1 border-r border-card-border px-3 py-2 text-left transition-colors ${
                    !fillAskAsCorp
                      ? "bg-primary/10 text-primary"
                      : "bg-card-elevated text-muted hover:text-foreground"
                  }`}
                >
                  <div className="font-semibold">Personal cash</div>
                </button>
                <button
                  type="button"
                  onClick={() => setFillAskAsCorp(true)}
                  className={`flex-1 px-3 py-2 text-left transition-colors ${
                    fillAskAsCorp
                      ? "bg-primary/10 text-primary"
                      : "bg-card-elevated text-muted hover:text-foreground"
                  }`}
                >
                  <div className="font-semibold">{myCorporation.name}</div>
                  <div
                    className={`mt-0.5 tabular-nums ${fillAskAsCorp ? "text-primary/70" : "text-muted/60"}`}
                  >
                    {formatAmount(myCorpLiquidInternal, myCorpLiquidCurrency)}
                  </div>
                </button>
              </div>
            </div>
          )}
          {sellOrders.length === 0 ? (
            <p className="text-xs text-muted">No sell orders</p>
          ) : (
            <div className="divide-y divide-card-border/50 rounded-lg border border-card-border overflow-hidden">
              {sellOrders.map((order) => (
                <div
                  key={order._id}
                  className={`px-4 py-3 ${order.isMine ? "bg-primary/5" : "bg-card-elevated/30"}`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <span className="text-sm text-foreground font-medium">
                        {order.sharesRemaining.toLocaleString("en-US")} shares
                      </span>
                      <span className="text-sm text-muted ml-2">
                        @ {displayPrice(order.pricePerShare)}
                      </span>
                    </div>
                    <div className="text-right">
                      {order.characterSequentialId ? (
                        <Link
                          href={`/character/${order.characterSequentialId}`}
                          className="text-xs text-primary hover:underline"
                        >
                          {order.characterName}
                        </Link>
                      ) : (
                        <span className="text-xs text-muted">{order.characterName}</span>
                      )}
                      {order.isMine && (
                        <span className="ml-1 text-xs text-primary font-medium">(You)</span>
                      )}
                    </div>
                  </div>
                  {!order.isMine && myCharacterId && (
                    <div className="flex items-center gap-2 mt-1">
                      <input
                        type="number"
                        value={fillAmounts[order._id] || ""}
                        onChange={(e) =>
                          setFillAmounts((prev) => ({
                            ...prev,
                            [order._id]: Math.min(
                              order.sharesRemaining,
                              Math.max(1, Math.floor(Number(e.target.value)))
                            ),
                          }))
                        }
                        placeholder="Shares"
                        min={1}
                        max={order.sharesRemaining}
                        className="w-24 rounded border border-card-border bg-background px-2 py-1 text-xs focus:border-primary/60 focus:outline-none"
                      />
                      <button
                        onClick={() => handleFillOrder(order._id, "sell", fillAmounts[order._id])}
                        disabled={loading || !fillAmounts[order._id]}
                        className="rounded bg-success/80 px-3 py-1 text-xs font-medium text-white hover:bg-success transition-colors disabled:opacity-50"
                      >
                        Buy
                      </button>
                    </div>
                  )}
                  {order.isMine && (
                    <div className="flex items-center justify-end mt-1">
                      <button
                        onClick={() => handleCancelOrder(order._id)}
                        disabled={loading}
                        className="text-xs text-error hover:text-error/80 transition-colors disabled:opacity-50"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
