"use client";

import { useState } from "react";
import { useCurrency } from "@/contexts/CurrencyContext";
import { requestCharacterStatsRefetch } from "@/lib/characterStatsSync";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { MarketOrder } from "../CorporationPageTypes";

export function SharePurchaseOrderbookView({
  orderbookAsks,
  orderbookBids,
  myCorporation,
  personalCashAnchor,
  myCorpLiquidInternal,
  myCorpLiquidCurrency,
  corpCurrencyCode,
  corpId,
  onSuccess,
}: {
  orderbookAsks: MarketOrder[];
  orderbookBids: MarketOrder[];
  myCorporation: {
    id: string;
    name: string;
    liquidCapital: number;
    liquidCurrencyCode?: string;
  } | null;
  personalCashAnchor: number;
  myCorpLiquidInternal: number;
  myCorpLiquidCurrency: CurrencyCode;
  corpCurrencyCode: CurrencyCode | undefined;
  corpId: string;
  onSuccess: () => void;
}) {
  const { formatAmount, formatPriceOrder, toInternalFrom } = useCurrency();
  const [fillOrderbookAsCorp, setFillOrderbookAsCorp] = useState(false);
  const [localFillAmounts, setLocalFillAmounts] = useState<Record<string, number>>({});
  const [fillingId, setFillingId] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState("");
  const [error, setError] = useState("");

  const orderbookCount = orderbookAsks.length + orderbookBids.length;

  async function handleFillLocal(
    orderId: string,
    orderType: "buy" | "sell",
    shares: number | undefined
  ) {
    if (!shares || shares < 1) {
      setError("Enter a quantity to fill");
      return;
    }
    setFillingId(orderId);
    setError("");
    setSuccessMsg("");
    try {
      const res = await fetch(`/api/corporations/${corpId}/shares/orders/${orderId}/fill`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shares,
          fillAsCorporation: orderType === "sell" && !!myCorporation && fillOrderbookAsCorp,
        }),
      });
      const data = (await res.json()) as { error?: string; sharesFilled: number; total: number };
      if (!res.ok) {
        setError(data.error ?? "Fill failed");
        return;
      }
      const verb = orderType === "sell" ? "Bought" : "Sold";
      setSuccessMsg(
        `${verb} ${data.sharesFilled.toLocaleString("en-US")} shares for ${formatAmount(data.total)}`
      );
      setLocalFillAmounts((prev) => {
        const next = { ...prev };
        delete next[orderId];
        return next;
      });
      onSuccess();
      requestCharacterStatsRefetch();
    } catch {
      setError("Network error");
    } finally {
      setFillingId(null);
    }
  }

  return (
    <div className="space-y-5">
      {orderbookCount === 0 ? (
        <p className="py-4 text-center text-sm text-muted">No open orders from other players.</p>
      ) : (
        <>
          {/* Sell orders (asks) — you can buy from these */}
          {orderbookAsks.length > 0 && (
            <div>
              {myCorporation && (
                <div className="mb-3">
                  <label className="mb-1.5 block text-xs text-muted">Buy using</label>
                  <div className="flex overflow-hidden rounded-lg border border-card-border text-xs">
                    <button
                      type="button"
                      onClick={() => setFillOrderbookAsCorp(false)}
                      className={`flex-1 border-r border-card-border px-3 py-2.5 text-left transition-colors ${
                        !fillOrderbookAsCorp
                          ? "bg-primary/10 text-primary"
                          : "bg-card-elevated text-muted hover:text-foreground"
                      }`}
                    >
                      <div className="font-semibold">Personally</div>
                      <div
                        className={`mt-0.5 tabular-nums ${!fillOrderbookAsCorp ? "text-primary/70" : "text-muted/60"}`}
                      >
                        {formatAmount(personalCashAnchor)}
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setFillOrderbookAsCorp(true)}
                      className={`flex-1 px-3 py-2.5 text-left transition-colors ${
                        fillOrderbookAsCorp
                          ? "bg-primary/10 text-primary"
                          : "bg-card-elevated text-muted hover:text-foreground"
                      }`}
                    >
                      <div className="font-semibold">{myCorporation.name}</div>
                      <div
                        className={`mt-0.5 tabular-nums ${fillOrderbookAsCorp ? "text-primary/70" : "text-muted/60"}`}
                      >
                        {formatAmount(myCorpLiquidInternal, myCorpLiquidCurrency)}
                      </div>
                    </button>
                  </div>
                </div>
              )}
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-success">
                For Sale — you can buy
              </p>
              <div className="divide-y divide-card-border/50 overflow-hidden rounded-lg border border-card-border">
                {orderbookAsks.map((order) => (
                  <div key={order._id} className="bg-card-elevated/30 px-4 py-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-sm font-medium text-foreground">
                          {order.sharesRemaining.toLocaleString("en-US")} shares
                        </span>
                        <span className="text-sm text-muted ml-2">
                          @{" "}
                          {formatPriceOrder(
                            corpCurrencyCode
                              ? toInternalFrom(order.pricePerShare, corpCurrencyCode)
                              : order.pricePerShare,
                            corpCurrencyCode
                          )}
                        </span>
                      </div>
                      <span className="text-xs text-muted">{order.characterName}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        inputMode="numeric"
                        value={
                          localFillAmounts[order._id] && localFillAmounts[order._id] > 0
                            ? String(localFillAmounts[order._id])
                            : ""
                        }
                        onChange={(e) => {
                          const raw = e.target.value.replace(/[^0-9]/g, "");
                          const n =
                            raw === ""
                              ? 0
                              : Math.min(
                                  order.sharesRemaining,
                                  Math.max(1, Math.floor(Number(raw)))
                                );
                          setLocalFillAmounts((prev) => ({ ...prev, [order._id]: n }));
                        }}
                        placeholder="Qty"
                        className="w-20 rounded border border-card-border bg-background px-2 py-1 text-xs focus:border-primary/60 focus:outline-none"
                      />
                      <button
                        onClick={() =>
                          handleFillLocal(order._id, "sell", localFillAmounts[order._id])
                        }
                        disabled={fillingId === order._id || !localFillAmounts[order._id]}
                        className="rounded bg-success/80 px-3 py-1 text-xs font-medium text-white hover:bg-success transition-colors disabled:opacity-50"
                      >
                        {fillingId === order._id ? "Buying…" : "Buy"}
                      </button>
                      {(localFillAmounts[order._id] ?? 0) > 0 && (
                        <span className="text-xs text-muted">
                          ={" "}
                          {formatAmount(
                            Math.round(
                              corpCurrencyCode
                                ? toInternalFrom(
                                    (localFillAmounts[order._id] ?? 0) * order.pricePerShare,
                                    corpCurrencyCode
                                  )
                                : (localFillAmounts[order._id] ?? 0) * order.pricePerShare
                            )
                          )}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Buy orders (bids) — you can sell to these */}
          {orderbookBids.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-error">
                Wanted — you can sell
              </p>
              <div className="divide-y divide-card-border/50 overflow-hidden rounded-lg border border-card-border">
                {orderbookBids.map((order) => (
                  <div key={order._id} className="bg-card-elevated/30 px-4 py-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-sm font-medium text-foreground">
                          {order.sharesRemaining.toLocaleString("en-US")} shares
                        </span>
                        <span className="text-sm text-muted ml-2">
                          @{" "}
                          {formatPriceOrder(
                            corpCurrencyCode
                              ? toInternalFrom(order.pricePerShare, corpCurrencyCode)
                              : order.pricePerShare,
                            corpCurrencyCode
                          )}
                        </span>
                      </div>
                      <span className="text-xs text-muted">{order.characterName}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        inputMode="numeric"
                        value={
                          localFillAmounts[order._id] && localFillAmounts[order._id] > 0
                            ? String(localFillAmounts[order._id])
                            : ""
                        }
                        onChange={(e) => {
                          const raw = e.target.value.replace(/[^0-9]/g, "");
                          const n =
                            raw === ""
                              ? 0
                              : Math.min(
                                  order.sharesRemaining,
                                  Math.max(1, Math.floor(Number(raw)))
                                );
                          setLocalFillAmounts((prev) => ({ ...prev, [order._id]: n }));
                        }}
                        placeholder="Qty"
                        className="w-20 rounded border border-card-border bg-background px-2 py-1 text-xs focus:border-primary/60 focus:outline-none"
                      />
                      <button
                        onClick={() =>
                          handleFillLocal(order._id, "buy", localFillAmounts[order._id])
                        }
                        disabled={fillingId === order._id || !localFillAmounts[order._id]}
                        className="rounded bg-error/80 px-3 py-1 text-xs font-medium text-white hover:bg-error transition-colors disabled:opacity-50"
                      >
                        {fillingId === order._id ? "Selling…" : "Sell"}
                      </button>
                      {(localFillAmounts[order._id] ?? 0) > 0 && (
                        <span className="text-xs text-muted">
                          ={" "}
                          {formatAmount(
                            Math.round(
                              corpCurrencyCode
                                ? toInternalFrom(
                                    (localFillAmounts[order._id] ?? 0) * order.pricePerShare,
                                    corpCurrencyCode
                                  )
                                : (localFillAmounts[order._id] ?? 0) * order.pricePerShare
                            )
                          )}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
      {successMsg && (
        <div className="rounded-lg border border-success/30 bg-success/5 px-3 py-2.5 text-xs text-success">
          {successMsg}
        </div>
      )}
      {error && <p className="text-xs text-error">{error}</p>}
    </div>
  );
}
