"use client";

import { useCallback, useEffect, useState } from "react";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { formatCurrencyFaceAmount } from "@/lib/currency/formatCurrencyFaceAmount";
import { Skeleton } from "@/components/ui";

type HolderType = "user" | "corp" | "reserve";

interface HolderRow {
  rank: number;
  name: string;
  type: HolderType;
  amount: number;
}

interface HoldersResponse {
  currency: CurrencyCode;
  page: number;
  pageSize: number;
  total: number;
  rows: HolderRow[];
  byType: Partial<Record<HolderType, { total: number; count: number }>>;
  grandTotal: number;
}

const TYPE_META: Record<HolderType, { label: string; color: string; chip: string }> = {
  user: {
    label: "Users",
    color: "#3b82f6",
    chip: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  },
  corp: {
    label: "Corporations",
    color: "#8b5cf6",
    chip: "bg-violet-500/15 text-violet-600 dark:text-violet-400",
  },
  reserve: {
    label: "National reserves",
    color: "#f59e0b",
    chip: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  },
};

const TYPE_ORDER: HolderType[] = ["user", "corp", "reserve"];

function buildPie(byType: HoldersResponse["byType"], grand: number): string {
  if (grand <= 0) return "var(--card-border)";
  let cursor = 0;
  const segs: string[] = [];
  for (const t of TYPE_ORDER) {
    const total = byType[t]?.total ?? 0;
    if (total <= 0) continue;
    const start = (cursor / grand) * 100;
    cursor += total;
    const end = (cursor / grand) * 100;
    segs.push(`${TYPE_META[t].color} ${start.toFixed(2)}% ${end.toFixed(2)}%`);
  }
  return segs.length ? `conic-gradient(${segs.join(", ")})` : "var(--card-border)";
}

export function CurrencyHolders({ currency }: { currency: CurrencyCode }) {
  const [page, setPage] = useState(0);
  const [data, setData] = useState<HoldersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchPage = useCallback(
    async (p: number) => {
      setLoading(true);
      setError("");
      try {
        const res = await fetch(`/api/forex/${currency}/holders?page=${p}`);
        if (!res.ok) {
          setError("Could not load holders");
          setData(null);
        } else {
          setData((await res.json()) as HoldersResponse);
        }
      } catch {
        setError("Network error");
      } finally {
        setLoading(false);
      }
    },
    [currency]
  );

  useEffect(() => {
    fetchPage(page);
  }, [fetchPage, page]);

  if (loading && !data) return <Skeleton className="h-96 w-full rounded-xl" />;
  if (error)
    return (
      <div className="rounded-xl border border-card-border bg-card p-6 text-center text-sm text-muted">
        {error}
      </div>
    );
  if (!data || data.total === 0)
    return (
      <div className="rounded-xl border border-card-border bg-card p-6 text-center text-sm text-muted">
        No recorded holders of {currency} yet.
      </div>
    );

  const grand = data.grandTotal || 1;
  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));

  return (
    <div className="rounded-xl border border-card-border bg-card shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-card-border">
        <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">
          Largest Holders of {currency}
        </h2>
        <p className="text-xs text-muted mt-0.5">
          Who holds {currency} across the world — player wallets, corporate treasuries, and national
          central-bank reserves. {data.total.toLocaleString("en-US")} holders ·{" "}
          {formatCurrencyFaceAmount(data.grandTotal, currency)} total.
        </p>
      </div>

      <div className="grid gap-5 p-5 lg:grid-cols-[220px_1fr]">
        {/* Pie + legend */}
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-card-border bg-card-elevated/30 p-4">
          <div
            className="h-36 w-36 rounded-full border border-card-border shadow-inner"
            style={{ background: buildPie(data.byType, grand) }}
            aria-label={`${currency} holder mix`}
          />
          <ul className="w-full space-y-1">
            {TYPE_ORDER.map((t) => {
              const total = data.byType[t]?.total ?? 0;
              const count = data.byType[t]?.count ?? 0;
              const pct = grand > 0 ? Math.round((total / grand) * 100) : 0;
              return (
                <li key={t} className="flex items-center justify-between gap-2 text-xs">
                  <span className="flex items-center gap-1.5 text-muted">
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-full"
                      style={{ background: TYPE_META[t].color }}
                    />
                    {TYPE_META[t].label} ({count})
                  </span>
                  <span className="font-mono tabular-nums text-foreground/80">{pct}%</span>
                </li>
              );
            })}
          </ul>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-card-border text-left">
                <th className="pb-2 pr-3 text-xs font-medium uppercase tracking-wider text-muted">
                  #
                </th>
                <th className="pb-2 pr-3 text-xs font-medium uppercase tracking-wider text-muted">
                  Holder
                </th>
                <th className="pb-2 pr-3 text-right text-xs font-medium uppercase tracking-wider text-muted">
                  Balance
                </th>
                <th className="pb-2 text-right text-xs font-medium uppercase tracking-wider text-muted">
                  Share
                </th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr
                  key={`${r.type}-${r.rank}-${r.name}`}
                  className="border-b border-card-border/50 last:border-0"
                >
                  <td className="py-2 pr-3 font-mono tabular-nums text-muted">{r.rank}</td>
                  <td className="py-2 pr-3">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium text-foreground">{r.name}</span>
                      <span
                        className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${TYPE_META[r.type].chip}`}
                      >
                        {r.type === "reserve" ? "Reserve" : r.type === "corp" ? "Corp" : "User"}
                      </span>
                    </div>
                  </td>
                  <td className="py-2 pr-3 text-right font-mono tabular-nums text-foreground">
                    {formatCurrencyFaceAmount(r.amount, currency)}
                  </td>
                  <td className="py-2 text-right font-mono tabular-nums text-muted">
                    {grand > 0 ? `${((r.amount / grand) * 100).toFixed(1)}%` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Pagination */}
          <div className="mt-3 flex items-center justify-between text-xs text-muted">
            <span>
              Page {data.page + 1} of {totalPages}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={data.page <= 0 || loading}
                className="rounded-md border border-card-border px-3 py-1 font-medium text-foreground transition-colors enabled:hover:bg-card-elevated disabled:opacity-40"
              >
                Prev
              </button>
              <button
                onClick={() => setPage((p) => (p + 1 < totalPages ? p + 1 : p))}
                disabled={data.page + 1 >= totalPages || loading}
                className="rounded-md border border-card-border px-3 py-1 font-medium text-foreground transition-colors enabled:hover:bg-card-elevated disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
