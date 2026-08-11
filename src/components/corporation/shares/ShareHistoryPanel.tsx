"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { ListRowSkeleton, Skeleton } from "@/components/ui";
import {
  useShareHistory,
  type ShareHistoryEntry,
  type ShareHistoryStructureChangeHolder,
} from "./hooks";

interface ShareHistoryPanelProps {
  corpId: string;
}

const PAGE_SIZE = 25;

// Short human-readable labels for every `ShareTradeKind`. Keep in sync with
// `src/lib/db/types/shareTradeHistory.ts`.
const KIND_LABELS: Record<ShareHistoryEntry["kind"], string> = {
  issuance: "Issued to Public Float",
  market_buy: "Market Buy",
  market_sell: "Market Sell",
  limit_fill: "Limit Order Filled",
  peer_fill: "Peer Order Filled",
  listing_fill: "Private Listing Filled",
  takeover_buyout: "Hostile Takeover Payout",
  correction: "Admin Correction",
  stock_split: "Stock Split",
  reverse_split: "Reverse Split",
};

const KIND_BADGE_CLASS: Record<ShareHistoryEntry["kind"], string> = {
  issuance: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  market_buy: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  market_sell: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  limit_fill: "bg-emerald-500/10 text-emerald-200 border-emerald-500/25",
  peer_fill: "bg-indigo-500/15 text-indigo-300 border-indigo-500/30",
  listing_fill: "bg-purple-500/15 text-purple-300 border-purple-500/30",
  takeover_buyout: "bg-rose-500/15 text-rose-300 border-rose-500/30",
  correction: "bg-slate-500/20 text-slate-300 border-slate-500/40",
  stock_split: "bg-cyan-500/15 text-cyan-300 border-cyan-500/30",
  reverse_split: "bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30",
};

function fmtAnchor(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  // Date + time, compact. Respects locale for display order.
  return d.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtPercent(frac: number): string {
  return `${(frac * 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}%`;
}

function HolderRow({ holder }: { holder: ShareHistoryStructureChangeHolder }) {
  const kindLabel =
    holder.kind === "public_float"
      ? "Float"
      : holder.kind === "imperial"
        ? "Imperial"
        : holder.kind === "corporation"
          ? "Corp"
          : holder.kind === "fund"
            ? "Fund"
            : "Character";
  return (
    <tr className="border-b border-card-border/30 last:border-0">
      <td className="py-1 pr-3 text-xs text-muted">{kindLabel}</td>
      <td className="py-1 pr-3 text-sm">{holder.name}</td>
      <td className="py-1 pr-3 text-right font-mono text-sm">
        {holder.shares.toLocaleString("en-US")}
      </td>
      <td className="py-1 text-right font-mono text-sm">{fmtPercent(holder.percent)}</td>
    </tr>
  );
}

function StructureChangeDetail({ entry }: { entry: ShareHistoryEntry }) {
  const sc = entry.structureChange;
  if (!sc) return null;
  const ccy = entry.corpCurrencyCode ?? "";
  return (
    <div className="mt-3 grid gap-4 rounded-md border border-card-border/50 bg-card-elevated/40 p-3 md:grid-cols-2">
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
          Before — {sc.oldTotalShares.toLocaleString("en-US")} shares
          {ccy && ` @ ${sc.oldSharePriceLocal.toLocaleString("en-US")} ${ccy}`}
        </p>
        <table className="w-full border-collapse">
          <tbody>
            {sc.before.map((h, i) => (
              <HolderRow key={`before-${h.kind}-${h.ownerId ?? "float"}-${i}`} holder={h} />
            ))}
          </tbody>
        </table>
      </div>
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
          After — {sc.newTotalShares.toLocaleString("en-US")} shares
          {ccy && ` @ ${sc.newSharePriceLocal.toLocaleString("en-US")} ${ccy}`}
        </p>
        <table className="w-full border-collapse">
          <tbody>
            {sc.after.map((h, i) => (
              <HolderRow key={`after-${h.kind}-${h.ownerId ?? "float"}-${i}`} holder={h} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PartyLink({ party }: { party: ShareHistoryEntry["from"] }) {
  if (!party) return <span className="text-muted italic">Public Float</span>;
  if (party.characterId) {
    return (
      <Link
        href={`/character/${party.characterId}`}
        className="text-foreground hover:text-primary hover:underline"
      >
        {party.name}
      </Link>
    );
  }
  if (party.corporationId) {
    return (
      <Link
        href={`/corporation/${party.corporationId}`}
        className="text-foreground hover:text-primary hover:underline"
      >
        {party.name}
      </Link>
    );
  }
  // Imperial characters don't currently have public profile pages — plain text.
  return <span className="text-foreground">{party.name}</span>;
}

export default function ShareHistoryPanel({ corpId }: ShareHistoryPanelProps) {
  const [page, setPage] = useState(1);
  const { entries, total, pageCount, loading, error } = useShareHistory(corpId, page, PAGE_SIZE);

  const rangeStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * PAGE_SIZE, total);

  return (
    <div className="rounded-lg border border-card-border bg-card p-6">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-semibold">Share History</h3>
        {loading ? (
          <Skeleton className="h-4 w-44" />
        ) : (
          <p className="text-xs text-muted">
            {total === 0
              ? "No share activity yet."
              : `Showing ${rangeStart.toLocaleString("en-US")}–${rangeEnd.toLocaleString("en-US")} of ${total.toLocaleString("en-US")}`}
          </p>
        )}
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-error/30 bg-error/10 p-3 text-sm text-error">
          {error}
        </div>
      )}

      {loading && entries.length === 0 && !error && (
        <div className="min-h-[280px]">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <ListRowSkeleton key={i} lines={2} withBadge />
          ))}
        </div>
      )}

      {!loading && entries.length === 0 && !error && (
        <div className="rounded-md border border-dashed border-card-border p-8 text-center text-sm text-muted">
          No share movements recorded yet. Issuances, buys, sells, fills, and corrections will
          appear here once they occur.
        </div>
      )}

      {entries.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-card-border text-left text-xs uppercase text-muted">
                <th className="py-2 pr-3 font-medium">Date</th>
                <th className="py-2 pr-3 font-medium">Event</th>
                <th className="py-2 pr-3 font-medium">From</th>
                <th className="py-2 pr-3 font-medium">To</th>
                <th className="py-2 pr-3 text-right font-medium">Shares</th>
                <th className="py-2 pr-3 text-right font-medium">Price (₳)</th>
                <th className="py-2 text-right font-medium">Total (₳)</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => {
                const isStructureChange = e.kind === "stock_split" || e.kind === "reverse_split";
                return (
                  <Fragment key={e.id}>
                    <tr
                      className="border-b border-card-border/60 align-top hover:bg-card-elevated/40"
                      title={e.note ?? undefined}
                    >
                      <td className="py-2 pr-3 whitespace-nowrap text-muted">
                        <div>{fmtDate(e.createdAt)}</div>
                        <div className="text-xs text-muted/70">Turn {e.turn}</div>
                      </td>
                      <td className="py-2 pr-3">
                        <span
                          className={`inline-flex items-center rounded border px-2 py-0.5 text-xs font-medium ${KIND_BADGE_CLASS[e.kind]}`}
                        >
                          {KIND_LABELS[e.kind]}
                        </span>
                        {e.note && (
                          <div className="mt-1 text-xs text-muted max-w-md line-clamp-2">
                            {e.note}
                          </div>
                        )}
                      </td>
                      <td className="py-2 pr-3">
                        <PartyLink party={e.from} />
                      </td>
                      <td className="py-2 pr-3">
                        <PartyLink party={e.to} />
                      </td>
                      <td className="py-2 pr-3 text-right font-mono">
                        {isStructureChange
                          ? `${e.shares >= 0 ? "+" : ""}${e.shares.toLocaleString("en-US")}`
                          : e.shares.toLocaleString("en-US")}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono text-muted">
                        {isStructureChange ? "—" : fmtAnchor(e.pricePerShareAnchor)}
                      </td>
                      <td className="py-2 text-right font-mono">
                        {isStructureChange ? "—" : fmtAnchor(e.totalAnchor)}
                      </td>
                    </tr>
                    {isStructureChange && e.structureChange && (
                      <tr>
                        <td colSpan={7} className="px-3 pb-4">
                          <StructureChangeDetail entry={e} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {pageCount > 1 && (
        <div className="mt-4 flex items-center justify-between">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1 || loading}
            className="rounded-md border border-card-border px-3 py-1.5 text-sm hover:bg-card-elevated disabled:cursor-not-allowed disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-sm text-muted">
            Page {page} of {pageCount}
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
            disabled={page >= pageCount || loading}
            className="rounded-md border border-card-border px-3 py-1.5 text-sm hover:bg-card-elevated disabled:cursor-not-allowed disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
