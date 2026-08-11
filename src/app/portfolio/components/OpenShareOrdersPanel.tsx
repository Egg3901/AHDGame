"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CURRENCY_SYMBOLS } from "@/lib/constants/currencies";
import { formatStableUtc } from "@/lib/time/localTime";
import type { MyOpenShareOrder } from "@/lib/corporations/queries/myOpenShareOrders";

function symbolFor(code: string): string {
  return CURRENCY_SYMBOLS[code as keyof typeof CURRENCY_SYMBOLS] ?? code;
}

function formatShares(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function formatPrice(currency: string, price: number): string {
  return `${symbolFor(currency)}${price.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDate(d: string | Date): string {
  // Deterministic UTC so SSR and client agree (avoids hydration mismatch).
  return formatStableUtc(d, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function corpHref(order: MyOpenShareOrder): string {
  return `/portfolio/corporation/${order.corporationSequentialId ?? order.corporationId}`;
}

interface CorpGroup {
  corporationId: string;
  corporationName: string;
  tickerSymbol?: string;
  href: string;
  orders: MyOpenShareOrder[];
}

export function OpenShareOrdersPanel() {
  const [orders, setOrders] = useState<MyOpenShareOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [cancelling, setCancelling] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/character/share-orders", { cache: "no-store" });
      if (!res.ok) {
        setError("Could not load your orders. Please try again.");
        return;
      }
      const data = (await res.json()) as { orders: MyOpenShareOrder[] };
      setOrders(data.orders ?? []);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCancel = useCallback(async (order: MyOpenShareOrder) => {
    setCancelling(order._id);
    setError("");
    try {
      const res = await fetch(
        `/api/corporations/${order.corporationId}/shares/orders/${order._id}`,
        { method: "DELETE" }
      );
      if (res.ok) {
        setOrders((prev) => prev.filter((o) => o._id !== order._id));
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Failed to cancel order.");
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setCancelling(null);
    }
  }, []);

  const groups = useMemo<CorpGroup[]>(() => {
    const map = new Map<string, CorpGroup>();
    for (const order of orders) {
      let group = map.get(order.corporationId);
      if (!group) {
        group = {
          corporationId: order.corporationId,
          corporationName: order.corporationName,
          tickerSymbol: order.tickerSymbol,
          href: corpHref(order),
          orders: [],
        };
        map.set(order.corporationId, group);
      }
      group.orders.push(order);
    }
    const list = Array.from(map.values());
    list.sort((a, b) => a.corporationName.localeCompare(b.corporationName));
    for (const group of list) {
      group.orders.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
    }
    return list;
  }, [orders]);

  return (
    <div className="rounded-xl border border-card-border bg-card shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-card-border flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">My Orders</h2>
          <p className="text-xs text-muted mt-0.5">
            Open buy and sell share orders across every corporation
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="text-xs font-semibold text-primary hover:underline"
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="mx-5 mt-4 rounded-lg border border-error/20 bg-error/5 px-4 py-2 text-sm text-error">
          {error}
        </div>
      )}

      {loading ? (
        <div className="px-5 py-10 text-center text-sm text-muted">Loading your orders...</div>
      ) : groups.length === 0 ? (
        <div className="px-5 py-10 text-center text-sm text-muted">
          You have no open share orders. Place a buy or sell order from any corporation to see it
          here.
        </div>
      ) : (
        <div className="divide-y divide-card-border">
          {groups.map((group) => (
            <div key={group.corporationId} className="px-5 py-4">
              <div className="flex items-center justify-between gap-3 mb-3">
                <Link
                  href={group.href}
                  className="text-sm font-semibold text-foreground hover:text-primary"
                >
                  {group.corporationName}
                  {group.tickerSymbol ? (
                    <span className="ml-2 text-xs font-mono text-muted">{group.tickerSymbol}</span>
                  ) : null}
                </Link>
                <Link
                  href={group.href}
                  className="text-xs font-semibold text-primary hover:underline"
                >
                  View corporation
                </Link>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wider text-muted">
                      <th className="py-1 pr-4 font-medium">Side</th>
                      <th className="py-1 pr-4 font-medium">Shares</th>
                      <th className="py-1 pr-4 font-medium">Price</th>
                      <th className="py-1 pr-4 font-medium">Placed</th>
                      <th className="py-1 pr-4 font-medium">Status</th>
                      <th className="py-1 font-medium text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.orders.map((order) => (
                      <tr key={order._id} className="border-t border-card-border/60">
                        <td className="py-2 pr-4">
                          <span
                            className={
                              order.type === "buy"
                                ? "font-semibold text-success"
                                : "font-semibold text-error"
                            }
                          >
                            {order.type === "buy" ? "Buy" : "Sell"}
                          </span>
                        </td>
                        <td className="py-2 pr-4">
                          {formatShares(order.sharesRemaining)}
                          {order.sharesRemaining !== order.shares ? (
                            <span className="text-xs text-muted">
                              {" "}
                              / {formatShares(order.shares)}
                            </span>
                          ) : null}
                        </td>
                        <td className="py-2 pr-4">
                          {formatPrice(order.currencyCode, order.pricePerShare)}
                        </td>
                        <td className="py-2 pr-4 text-muted">{formatDate(order.createdAt)}</td>
                        <td className="py-2 pr-4">
                          <span className="rounded bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                            Open
                          </span>
                        </td>
                        <td className="py-2 text-right">
                          <button
                            type="button"
                            onClick={() => void handleCancel(order)}
                            disabled={cancelling === order._id}
                            className="text-xs font-semibold text-error hover:underline disabled:opacity-50"
                          >
                            {cancelling === order._id ? "Cancelling..." : "Cancel"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
