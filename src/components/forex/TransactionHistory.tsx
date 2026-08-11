"use client";

import { useEffect, useState } from "react";
import { Skeleton } from "@/components/ui";
import { useCurrency } from "@/contexts/CurrencyContext";
import { formatCurrencyFull } from "@/lib/utils/formatters";
import { CURRENCY_SYMBOLS } from "@/lib/constants/currencies";
import type { CurrencyCode } from "@/lib/constants/currencies";

type TradeSourceUI =
  "manual" | "direct" | "limit_order" | "auto_purchase" | "auto_dividend" | "auto_coupon";

interface RowItem {
  kind: "row";
  _id: string;
  turn: number;
  createdAt: string;
  fromCurrency: CurrencyCode;
  toCurrency: CurrencyCode;
  amount: number;
  rate: number;
  spread: number;
  source: TradeSourceUI;
  sourceRef: string | null;
  isBuyer: boolean;
  traderName: string | null;
  traderSequentialId: number | null;
}
interface SummaryItem {
  kind: "summary";
  turn: number;
  source: "auto_dividend" | "auto_coupon";
  fromCurrency: CurrencyCode;
  toCurrency: CurrencyCode;
  totalAmount: number;
  totalSpread: number;
  avgRate: number;
  participantCount: number;
}
type Item = RowItem | SummaryItem;

interface TurnBucket {
  turn: number;
  items: Item[];
}

type SourceFilterUI = "" | "manual" | "direct" | "limit_order" | "auto_purchase" | "auto_income";

interface Props {
  currency?: CurrencyCode;
}

const SOURCE_LABEL: Record<TradeSourceUI, string> = {
  manual: "Manual",
  direct: "Direct",
  limit_order: "Limit",
  auto_purchase: "Auto purchase",
  auto_dividend: "Dividend",
  auto_coupon: "Coupon",
};
const SOURCE_COLOR: Record<TradeSourceUI, string> = {
  manual: "bg-primary/10 text-primary border-primary/20",
  direct: "bg-success/10 text-success border-success/20",
  limit_order: "bg-warning/10 text-warning border-warning/20",
  auto_purchase: "bg-muted/20 text-muted border-card-border",
  auto_dividend: "bg-info/10 text-info border-info/20",
  auto_coupon: "bg-info/10 text-info border-info/20",
};

export function TransactionHistory({ currency }: Props) {
  const { displayCurrencyPreference } = useCurrency();
  const [turns, setTurns] = useState<TurnBucket[]>([]);
  const [offset, setOffset] = useState(0);
  const TURNS_PER_PAGE = 2;
  const MAX_OFFSET = 6; // show up to 4 pages of 2 turns
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sourceFilter, setSourceFilter] = useState<SourceFilterUI>("");
  const [scope, setScope] = useState<"all" | "mine">("all");

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      const params = new URLSearchParams({
        turns: String(TURNS_PER_PAGE),
        offset: String(offset),
        scope,
      });
      // "Mine" = trades that affect the player, across every currency pair.
      // "All" = public feed scoped to the currency page you're viewing.
      if (currency && scope === "all") params.set("currency", currency);
      if (sourceFilter) params.set("source", sourceFilter);
      try {
        const res = await fetch(`/api/forex/transactions?${params.toString()}`, {
          credentials: "same-origin",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!cancelled) {
          setTurns(data.turns);
          setHasMore(!!data.hasMore);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [offset, currency, sourceFilter, scope]);

  const formatInCurrency = (amount: number, code: CurrencyCode) => {
    const symbol = CURRENCY_SYMBOLS[code] ?? "$";
    return formatCurrencyFull(Math.round(amount), symbol);
  };

  return (
    <div className="rounded-xl border border-card-border bg-card shadow-sm overflow-hidden">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-6 py-4 border-b border-card-border">
        <div>
          <h3 className="text-sm font-semibold">Transaction History</h3>
          <p className="text-xs text-muted mt-0.5">
            {scope === "mine"
              ? "Currency trades each turn that affect your character, across every pair, not just this page."
              : `Currency trades each turn involving ${currency ?? "any currency"}. Dividend and coupon conversions are rolled up into a single line for each pair each turn, instead of one line per player.`}
            {displayCurrencyPreference === "internal" &&
              " Amounts shown in the native pair currency."}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center rounded-lg bg-card-elevated p-1 border border-card-border text-xs">
            {(
              [
                { key: "all", label: "All" },
                { key: "mine", label: "Mine" },
              ] as const
            ).map((s) => (
              <button
                key={s.key}
                onClick={() => {
                  setOffset(0);
                  setScope(s.key);
                }}
                className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                  scope === s.key
                    ? "bg-primary text-white shadow-sm"
                    : "text-muted hover:text-foreground"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
          <select
            aria-label="Filter by source"
            value={sourceFilter}
            onChange={(e) => {
              setOffset(0);
              setSourceFilter(e.target.value as SourceFilterUI);
            }}
            className="rounded-md border border-card-border bg-card-elevated px-2 py-1 text-xs"
          >
            <option value="">All types</option>
            <option value="manual">Manual</option>
            <option value="direct">Direct</option>
            <option value="limit_order">Limit order</option>
            <option value="auto_purchase">Auto purchase</option>
            <option value="auto_income">Auto income (div + coupon)</option>
          </select>
        </div>
      </div>

      {loading && turns.length === 0 ? (
        <div className="min-h-[240px]">
          {[1, 2].map((b) => (
            <div key={b} className="border-b border-card-border last:border-b-0">
              <div className="flex items-center bg-card-elevated px-6 py-2.5">
                <Skeleton className="h-3 w-16" />
              </div>
              <div className="divide-y divide-card-border">
                {[1, 2, 3].map((r) => (
                  <div key={r} className="flex items-center gap-4 px-6 py-3">
                    <Skeleton className="h-5 w-16 rounded-full" />
                    <Skeleton className="h-3 w-24" />
                    <Skeleton className="ml-auto h-3 w-20" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : turns.length === 0 || turns.every((t) => t.items.length === 0) ? (
        <div className="p-6 text-center text-sm text-muted">No transactions in this window.</div>
      ) : (
        <div>
          {turns.map((bucket) => (
            <section key={bucket.turn} className="border-b border-card-border last:border-b-0">
              <header className="flex items-center justify-between bg-card-elevated px-6 py-2 text-xs font-semibold uppercase tracking-wider text-muted">
                <span>Turn {bucket.turn}</span>
                <span className="text-[10px] font-normal normal-case">
                  {bucket.items.length === 0
                    ? "No activity"
                    : `${bucket.items.length} ${bucket.items.length === 1 ? "entry" : "entries"}`}
                </span>
              </header>
              {bucket.items.length === 0 ? (
                <div className="px-6 py-4 text-xs text-muted">No trades this turn.</div>
              ) : (
                <ul className="divide-y divide-card-border">
                  {bucket.items.map((item, idx) => {
                    if (item.kind === "summary") {
                      const toAmount = (item.totalAmount - item.totalSpread) * item.avgRate;
                      return (
                        <li
                          key={`sum-${bucket.turn}-${item.source}-${item.fromCurrency}-${item.toCurrency}`}
                          className="flex flex-wrap items-center gap-x-4 gap-y-1 px-6 py-3 bg-info/5"
                        >
                          <span
                            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${SOURCE_COLOR[item.source]}`}
                          >
                            Σ {SOURCE_LABEL[item.source]}
                          </span>
                          <span className="font-mono text-xs">
                            {item.fromCurrency} → {item.toCurrency}
                          </span>
                          <span className="font-mono text-xs tabular-nums">
                            {formatInCurrency(item.totalAmount, item.fromCurrency)}
                            <span className="mx-1 text-muted">→</span>
                            {formatInCurrency(toAmount, item.toCurrency)}
                          </span>
                          <span className="ml-auto text-[11px] text-muted">
                            {item.participantCount}{" "}
                            {item.participantCount === 1 ? "holder" : "holders"} · avg rate{" "}
                            {item.avgRate.toFixed(4)}
                          </span>
                        </li>
                      );
                    }
                    const toAmount = (item.amount - item.spread) * item.rate;
                    const traderLabel = item.isBuyer
                      ? "You"
                      : item.traderName
                        ? `${item.traderName}${item.traderSequentialId ? ` #${item.traderSequentialId}` : ""}`
                        : "—";
                    return (
                      <li
                        key={`${item._id}-${idx}`}
                        className="flex flex-wrap items-center gap-x-4 gap-y-1 px-6 py-3"
                      >
                        <span
                          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${SOURCE_COLOR[item.source]}`}
                        >
                          {SOURCE_LABEL[item.source]}
                        </span>
                        <span
                          className={`text-xs ${item.isBuyer ? "font-semibold" : "text-muted"}`}
                        >
                          {traderLabel}
                        </span>
                        <span className="font-mono text-xs">
                          {item.fromCurrency} → {item.toCurrency}
                        </span>
                        <span className="font-mono text-xs tabular-nums">
                          {formatInCurrency(item.amount, item.fromCurrency)}
                          <span className="mx-1 text-muted">→</span>
                          {formatInCurrency(toAmount, item.toCurrency)}
                        </span>
                        <span className="ml-auto text-[11px] text-muted">
                          rate {item.rate.toFixed(4)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between px-6 py-3 border-t border-card-border text-xs text-muted">
        <span>Showing last {turns.length} turn(s)</span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setOffset((o) => Math.max(0, o - TURNS_PER_PAGE))}
            disabled={offset === 0 || loading}
            className="rounded-md border border-card-border px-3 py-1 text-xs hover:bg-card-elevated disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Newer
          </button>
          <button
            onClick={() => setOffset((o) => Math.min(MAX_OFFSET, o + TURNS_PER_PAGE))}
            disabled={!hasMore || offset >= MAX_OFFSET || loading}
            className="rounded-md border border-card-border px-3 py-1 text-xs hover:bg-card-elevated disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Older
          </button>
        </div>
      </div>
    </div>
  );
}
