"use client";

import { useState } from "react";
import { useCurrency } from "@/contexts/CurrencyContext";
import { requestCharacterStatsRefetch } from "@/lib/characterStatsSync";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { MyShareOrder } from "../CorporationPageTypes";

export function SharePurchaseOrdersView({
  openBuyOrders,
  openSellOrders,
  corpId,
  corpCurrencyCode,
  onSuccess,
}: {
  openBuyOrders: MyShareOrder[];
  openSellOrders: MyShareOrder[];
  corpId: string;
  corpCurrencyCode: CurrencyCode | undefined;
  onSuccess: () => void;
}) {
  const { formatAmount, formatPriceOrder, toInternalFrom } = useCurrency();
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const hasOrders = openBuyOrders.length > 0 || openSellOrders.length > 0;

  async function handleCancelOrder(orderId: string) {
    setCancellingId(orderId);
    setError(null);
    try {
      const res = await fetch(`/api/corporations/${corpId}/shares/orders/${orderId}`, {
        method: "DELETE",
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Failed to cancel order");
        return;
      }
      onSuccess();
      requestCharacterStatsRefetch();
    } catch {
      setError("Network error");
    } finally {
      setCancellingId(null);
    }
  }

  return (
    <div className="space-y-5">
      {!hasOrders ? (
        <p className="py-4 text-center text-sm text-muted">No open orders.</p>
      ) : (
        <>
          {openBuyOrders.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-success">
                Buy Orders
              </p>
              <div className="divide-y divide-card-border/50 overflow-hidden rounded-lg border border-card-border">
                {openBuyOrders.map((o) => (
                  <div
                    key={o._id}
                    className="flex items-center justify-between bg-card-elevated/30 px-4 py-3"
                  >
                    <div className="space-y-0.5">
                      <div className="text-sm font-medium text-foreground">
                        {o.sharesRemaining.toLocaleString("en-US")} shares
                        <span className="ml-2 font-normal text-muted">
                          @{" "}
                          {formatPriceOrder(
                            corpCurrencyCode
                              ? toInternalFrom(o.pricePerShare, corpCurrencyCode)
                              : o.pricePerShare,
                            corpCurrencyCode
                          )}
                        </span>
                      </div>
                      <div className="text-xs text-muted">
                        {formatAmount(
                          Math.round(
                            corpCurrencyCode
                              ? toInternalFrom(o.escrowAmount, corpCurrencyCode)
                              : o.escrowAmount
                          )
                        )}{" "}
                        in escrow
                      </div>
                    </div>
                    <button
                      onClick={() => handleCancelOrder(o._id)}
                      disabled={cancellingId === o._id}
                      className="ml-4 text-xs text-error transition-colors hover:text-error/80 disabled:opacity-50"
                    >
                      {cancellingId === o._id ? "Cancelling…" : "Cancel"}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {openSellOrders.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-error">
                Sell Orders
              </p>
              <div className="divide-y divide-card-border/50 overflow-hidden rounded-lg border border-card-border">
                {openSellOrders.map((o) => (
                  <div
                    key={o._id}
                    className="flex items-center justify-between bg-card-elevated/30 px-4 py-3"
                  >
                    <div className="space-y-0.5">
                      <div className="text-sm font-medium text-foreground">
                        {o.sharesRemaining.toLocaleString("en-US")} shares
                        <span className="ml-2 font-normal text-muted">
                          @{" "}
                          {formatPriceOrder(
                            corpCurrencyCode
                              ? toInternalFrom(o.pricePerShare, corpCurrencyCode)
                              : o.pricePerShare,
                            corpCurrencyCode
                          )}
                        </span>
                      </div>
                      <div className="text-xs text-muted">
                        {formatAmount(
                          Math.round(
                            corpCurrencyCode
                              ? toInternalFrom(
                                  o.sharesRemaining * o.pricePerShare,
                                  corpCurrencyCode
                                )
                              : o.sharesRemaining * o.pricePerShare
                          )
                        )}{" "}
                        proceeds on fill
                      </div>
                    </div>
                    <button
                      onClick={() => handleCancelOrder(o._id)}
                      disabled={cancellingId === o._id}
                      className="ml-4 text-xs text-error transition-colors hover:text-error/80 disabled:opacity-50"
                    >
                      {cancellingId === o._id ? "Cancelling…" : "Cancel"}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
      {error && <p className="text-xs text-error">{error}</p>}
    </div>
  );
}
