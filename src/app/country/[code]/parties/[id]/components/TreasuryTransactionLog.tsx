"use client";

import { useCallback, useEffect, useState } from "react";
import { Skeleton } from "@/components/ui";
import { LocalTime } from "@/components/time/LocalTime";
import { CURRENCY_SYMBOLS, type CurrencyCode } from "@/lib/constants/currencies";

/**
 * Append-only audit log of treasury inflows and outflows for a party. Reads
 * from `GET /api/country/[code]/parties/[id]/treasury/transactions`. Paginates
 * by `createdAt` cursor with no offset-based jumpiness.
 */

interface TransactionRow {
  id: string;
  holderType: "party" | "caucus" | "state_party";
  holderId: string;
  category: string;
  direction: "credit" | "debit";
  amount: number;
  currencyCode?: CurrencyCode;
  memo: string;
  counterparty: { type: string; id: string; label?: string } | null;
  initiatedBy: { type: string; id: string; label?: string } | null;
  turn: number;
  createdAt: string;
}

interface TransactionsResponse {
  items: TransactionRow[];
  nextBefore: string | null;
}

const CATEGORY_LABEL: Record<string, string> = {
  donations: "Donations",
  caucus_tax: "Caucus tax",
  transfers: "Transfers",
  slate: "Slate",
  gotv: "GOTV",
  suppression: "Suppression",
  whip_ops: "Whip ops",
  recruitment: "Recruitment",
  operations: "Operations",
  fund_generation: "Fund generation",
  ps_investment: "PS investment",
  campaign_donation: "Campaign donation",
};

const HOLDER_LABEL: Record<string, string> = {
  party: "National party",
  state_party: "State party",
  caucus: "Caucus",
};

const ALL_CATEGORIES: string[] = Object.keys(CATEGORY_LABEL);

interface Props {
  countryCode: string;
  partyId: string;
}

export function TreasuryTransactionLog({ countryCode, partyId }: Props) {
  const [items, setItems] = useState<TransactionRow[]>([]);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<string>("all");
  const [direction, setDirection] = useState<"all" | "credit" | "debit">("all");

  const buildUrl = useCallback(
    (before?: string) => {
      const url = new URL(
        `/api/country/${countryCode}/parties/${partyId}/treasury/transactions`,
        typeof window !== "undefined" ? window.location.origin : "http://localhost"
      );
      if (before) url.searchParams.set("before", before);
      if (category !== "all") url.searchParams.set("category", category);
      if (direction !== "all") url.searchParams.set("direction", direction);
      url.searchParams.set("limit", "50");
      return url.pathname + url.search;
    },
    [countryCode, partyId, category, direction]
  );

  const fetchFirstPage = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(buildUrl(), { cache: "no-store" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Failed to load transactions (${res.status})`);
      }
      const json = (await res.json()) as TransactionsResponse;
      setItems(json.items);
      setNextBefore(json.nextBefore);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load transactions");
    } finally {
      setLoading(false);
    }
  }, [buildUrl]);

  const fetchNextPage = useCallback(async () => {
    if (!nextBefore) return;
    setLoadingMore(true);
    try {
      const res = await fetch(buildUrl(nextBefore), { cache: "no-store" });
      if (!res.ok) return;
      const json = (await res.json()) as TransactionsResponse;
      setItems((prev) => [...prev, ...json.items]);
      setNextBefore(json.nextBefore);
    } finally {
      setLoadingMore(false);
    }
  }, [buildUrl, nextBefore]);

  useEffect(() => {
    void fetchFirstPage();
  }, [fetchFirstPage]);

  return (
    <div className="rounded-xl border border-card-border bg-card p-5 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-sm font-semibold">Treasury transaction log</h3>
          <p
            className="mt-0.5 text-[11px] text-muted"
            title="National treasury transactions only. State party and caucus treasury activity appears on their own pages."
          >
            Per-event audit trail of national party treasury inflows and outflows only. State party
            and caucus treasury activity appears on their own pages.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <select
            className="rounded-md border border-card-border bg-background px-2 py-1 text-xs"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="all">All categories</option>
            {ALL_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
          <select
            className="rounded-md border border-card-border bg-background px-2 py-1 text-xs"
            value={direction}
            onChange={(e) => setDirection(e.target.value as "all" | "credit" | "debit")}
          >
            <option value="all">All directions</option>
            <option value="credit">Credit (inflow)</option>
            <option value="debit">Debit (outflow)</option>
          </select>
        </div>
      </div>

      {loading && (
        <div className="min-h-[12rem] divide-y divide-card-border/40">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex items-start justify-between gap-3 py-2">
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-5 w-6 rounded-full" />
                  <Skeleton className="h-5 w-20 rounded-full" />
                  <Skeleton className="h-3.5 w-40" />
                </div>
                <Skeleton className="h-3 w-56" />
              </div>
              <Skeleton className="h-4 w-16 shrink-0" />
            </div>
          ))}
        </div>
      )}
      {error && <p className="text-xs text-error">{error}</p>}

      {!loading && !error && items.length === 0 && (
        <p className="text-xs text-muted">
          No transactions yet - events will appear here as the party makes or receives funds.
        </p>
      )}

      {items.length > 0 && (
        <ul className="divide-y divide-card-border/40">
          {items.map((row) => (
            <li key={row.id} className="flex items-start justify-between gap-3 py-2 text-xs">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                      row.direction === "credit"
                        ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-300"
                        : "bg-red-500/15 border-red-500/40 text-red-300"
                    }`}
                  >
                    {row.direction === "credit" ? "+" : "-"}
                  </span>
                  <span className="rounded-full border border-card-border px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted">
                    {CATEGORY_LABEL[row.category] ?? row.category}
                  </span>
                  <span className="rounded-full border border-card-border/60 px-2 py-0.5 text-[10px] text-muted">
                    {HOLDER_LABEL[row.holderType] ?? row.holderType}
                  </span>
                  <span className="text-foreground font-medium truncate">{row.memo}</span>
                </div>
                <div className="text-[11px] text-muted mt-0.5 flex flex-wrap items-center gap-2">
                  <span>turn {row.turn}</span>
                  <span>|</span>
                  <span>
                    <LocalTime value={row.createdAt} />
                  </span>
                  {row.counterparty?.label && (
                    <>
                      <span>|</span>
                      <span className="truncate">to {row.counterparty.label}</span>
                    </>
                  )}
                  {row.initiatedBy?.label && (
                    <>
                      <span>|</span>
                      <span className="truncate">by {row.initiatedBy.label}</span>
                    </>
                  )}
                </div>
              </div>
              <div
                className={`shrink-0 tabular-nums font-semibold ${
                  row.direction === "credit" ? "text-emerald-300" : "text-red-300"
                }`}
              >
                {row.direction === "credit" ? "+" : "-"}
                {row.currencyCode ? CURRENCY_SYMBOLS[row.currencyCode] : "₳"}
                {row.amount.toLocaleString("en-US")}
              </div>
            </li>
          ))}
        </ul>
      )}

      {nextBefore && (
        <button
          type="button"
          disabled={loadingMore}
          onClick={fetchNextPage}
          className="w-full rounded-md border border-card-border bg-background py-2 text-xs text-muted hover:text-foreground transition-colors disabled:opacity-50"
        >
          {loadingMore ? "Loading..." : "Load more"}
        </button>
      )}
    </div>
  );
}
