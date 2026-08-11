"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { Avatar } from "@/components/Avatar";
import { CountryFlag } from "@/components/CountryFlag";
import { useCurrency } from "@/contexts/CurrencyContext";
import { getCountryIdByName } from "@/lib/constants/countries";
import type { WealthEntry, WealthSortField, WealthSortDir } from "../types";

const WEALTH_SORT_OPTIONS: { field: WealthSortField; label: string }[] = [
  { field: "totalWealth", label: "Net Worth" },
  { field: "stockValue", label: "Stocks" },
  { field: "bondValue", label: "Bonds" },
  { field: "portfolioValue", label: "Portfolio" },
  { field: "cashValue", label: "Cash" },
];

function getRankColor(index: number): string {
  if (index === 0) return "text-amber-500";
  if (index === 1) return "text-slate-400";
  if (index === 2) return "text-orange-600";
  return "text-muted";
}

function RankChange({ value }: { value: number | null }) {
  if (value == null || value === 0) return <span className="text-muted text-xs">—</span>;
  if (value > 0) return <span className="text-success text-xs font-medium">▲{value}</span>;
  return <span className="text-error text-xs font-medium">▼{Math.abs(value)}</span>;
}

function WealthChange({
  value,
  formatAmount,
}: {
  value: number | null;
  formatAmount: (v: number) => string;
}) {
  if (value == null) return <span className="text-muted">—</span>;
  if (value === 0) return <span className="text-muted">{formatAmount(0)}</span>;
  const color = value > 0 ? "text-success" : "text-error";
  const prefix = value > 0 ? "+" : "";
  return (
    <span className={color}>
      {prefix}
      {formatAmount(value)}
    </span>
  );
}

const PAGE_SIZE = 25;

export function WealthList({ entries }: { entries: WealthEntry[] }) {
  const { formatAmount } = useCurrency();
  const [sortField, setSortField] = useState<WealthSortField>("totalWealth");
  const [sortDir, setSortDir] = useState<WealthSortDir>("desc");
  const [filterText, setFilterText] = useState("");
  const [filterCountry, setFilterCountry] = useState("");
  const [page, setPage] = useState(0);

  const countries = useMemo(() => [...new Set(entries.map((e) => e.country))].sort(), [entries]);

  const sortedEntries = useMemo(() => {
    let list = [...entries];
    if (filterText.trim()) {
      const q = filterText.trim().toLowerCase();
      list = list.filter(
        (e) =>
          e.name.toLowerCase().includes(q) ||
          e.state.toLowerCase().includes(q) ||
          (e.corporation ?? "").toLowerCase().includes(q)
      );
    }
    if (filterCountry) {
      list = list.filter((e) => e.country === filterCountry);
    }
    list.sort((a, b) => {
      const cmp = (a[sortField] ?? 0) - (b[sortField] ?? 0);
      if (cmp !== 0) return sortDir === "desc" ? -cmp : cmp;
      return a.name.localeCompare(b.name);
    });
    return list;
  }, [entries, filterText, filterCountry, sortField, sortDir]);

  const pagedEntries = useMemo(
    () => sortedEntries.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE),
    [sortedEntries, page]
  );
  const totalPages = Math.ceil(sortedEntries.length / PAGE_SIZE);

  const handleSort = (field: WealthSortField) => {
    setPage(0);
    if (field === sortField) {
      setSortDir(sortDir === "desc" ? "asc" : "desc");
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <h2 className="text-xl font-bold text-foreground">Wealth Leaderboard</h2>
          <div className="flex items-center gap-2 overflow-x-auto w-full sm:w-auto pb-2 sm:pb-0">
            {WEALTH_SORT_OPTIONS.map((opt) => (
              <button
                key={opt.field}
                onClick={() => handleSort(opt.field)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                  sortField === opt.field
                    ? "bg-primary/10 text-primary border border-primary/20"
                    : "bg-card border border-card-border text-muted hover:text-foreground hover:bg-card-elevated"
                }`}
              >
                {opt.label} {sortField === opt.field && (sortDir === "desc" ? "↓" : "↑")}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1 max-w-xs">
            <input
              type="search"
              placeholder="Search player, state, corp…"
              value={filterText}
              onChange={(e) => {
                setFilterText(e.target.value);
                setPage(0);
              }}
              className="w-full rounded-lg border border-card-border bg-card px-3 py-2 text-sm pl-9 focus:border-primary/60 focus:outline-none focus:ring-1 focus:ring-primary/20 transition-all"
            />
            <svg
              className="absolute left-3 top-2.5 h-4 w-4 text-muted"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
          </div>
          {countries.length > 1 && (
            <select
              value={filterCountry}
              onChange={(e) => {
                setFilterCountry(e.target.value);
                setPage(0);
              }}
              className="rounded-lg border border-card-border bg-card px-3 py-2 text-sm text-foreground focus:border-primary/60 focus:outline-none"
            >
              <option value="">All countries</option>
              {countries.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          )}
          {(filterText || filterCountry) && (
            <button
              type="button"
              onClick={() => {
                setFilterText("");
                setFilterCountry("");
                setPage(0);
              }}
              className="rounded-lg border border-card-border bg-card px-3 py-2 text-xs font-medium text-muted hover:text-foreground transition-colors whitespace-nowrap"
            >
              Clear · {sortedEntries.length}/{entries.length}
            </button>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-card-border bg-card overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-card-elevated border-b border-card-border">
              <tr>
                <th className="px-4 py-3 font-semibold text-muted uppercase text-[10px] tracking-wider w-10">
                  #
                </th>
                <th className="px-4 py-3 font-semibold text-muted uppercase text-[10px] tracking-wider">
                  Player
                </th>
                {WEALTH_SORT_OPTIONS.map((opt, i) => {
                  const hidden =
                    i >= 1 && i <= 2
                      ? "hidden sm:table-cell"
                      : i >= 3
                        ? "hidden md:table-cell"
                        : "";
                  return (
                    <th
                      key={opt.field}
                      onClick={() => handleSort(opt.field)}
                      className={`px-4 py-3 font-semibold uppercase text-[10px] tracking-wider text-right cursor-pointer select-none ${hidden} ${
                        sortField === opt.field
                          ? "text-primary"
                          : "text-muted hover:text-foreground"
                      }`}
                    >
                      {opt.label} {sortField === opt.field && (sortDir === "desc" ? "↓" : "↑")}
                    </th>
                  );
                })}
                <th className="px-4 py-3 font-semibold text-muted uppercase text-[10px] tracking-wider text-right hidden sm:table-cell">
                  24h Change
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-card-border">
              {sortedEntries.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-muted">
                    No players found.
                  </td>
                </tr>
              ) : (
                pagedEntries.map((entry, i) => {
                  const rank = page * PAGE_SIZE + i;
                  return (
                    <tr
                      key={entry.characterId}
                      className="group hover:bg-card-elevated/50 transition-colors"
                    >
                      <td className="px-4 py-3">
                        <div className="flex flex-col items-center gap-0.5">
                          <span className={`font-bold ${getRankColor(rank)}`}>{rank + 1}</span>
                          <RankChange value={entry.rankChange24h} />
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/character/${entry.sequentialId ?? entry.characterId}`}
                          className="flex items-center gap-3"
                        >
                          <Avatar
                            url={entry.avatarUrl}
                            name={entry.name}
                            size="h-9 w-9 sm:h-10 sm:w-10"
                            borderKey={entry.borderKey}
                            tintColor={entry.tintColor}
                          />
                          <div className="flex flex-col min-w-0">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <CountryFlag
                                country={getCountryIdByName(entry.country) ?? entry.country}
                                size="sm"
                              />
                              <span className="font-bold text-foreground truncate group-hover:text-primary transition-colors">
                                {entry.name}
                              </span>
                            </div>
                            <div className="flex items-center gap-1 text-xs text-muted">
                              <span className="truncate">{entry.state}</span>
                              {entry.corporation && (
                                <>
                                  <span>•</span>
                                  <span className="truncate text-primary/80 font-medium">
                                    {entry.corporation}
                                  </span>
                                </>
                              )}
                            </div>
                          </div>
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-bold tabular-nums text-foreground">
                        {formatAmount(entry.totalWealth)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-muted hidden sm:table-cell">
                        {formatAmount(entry.stockValue)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-muted hidden sm:table-cell">
                        {formatAmount(entry.bondValue)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-muted hidden md:table-cell">
                        {formatAmount(entry.portfolioValue)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-muted hidden md:table-cell">
                        {formatAmount(entry.cashValue)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums hidden sm:table-cell">
                        <WealthChange value={entry.wealthChange24h} formatAmount={formatAmount} />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between gap-2 pt-1">
          <span className="text-xs text-muted">
            {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, sortedEntries.length)} of{" "}
            {sortedEntries.length}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(page - 1)}
              disabled={page === 0}
              className="px-3 py-1.5 rounded-md text-xs font-medium border border-card-border bg-card text-muted hover:text-foreground hover:bg-card-elevated transition-colors disabled:opacity-40 disabled:pointer-events-none"
            >
              ← Prev
            </button>
            <span className="px-3 py-1.5 text-xs text-muted">
              {page + 1} / {totalPages}
            </span>
            <button
              onClick={() => setPage(page + 1)}
              disabled={page >= totalPages - 1}
              className="px-3 py-1.5 rounded-md text-xs font-medium border border-card-border bg-card text-muted hover:text-foreground hover:bg-card-elevated transition-colors disabled:opacity-40 disabled:pointer-events-none"
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
