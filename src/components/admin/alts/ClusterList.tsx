"use client";

// ClusterList: bounty-board triage queue. Each cluster is a wanted poster of
// the suspected alts (PFP + hyperlinked in-game name + Discord), ranked by
// confidence. Filters: min-confidence, status, has-banned-member, signal-type.

import { ConfidenceMeter } from "./ConfidenceMeter";
import { DiscordContact } from "./DiscordContact";
import { SuspectMugshot } from "./SuspectPortrait";
import { SuspectNameButton } from "./SuspectPeek";
import {
  confidenceHex,
  ROLE_LABEL,
  signalMeta,
  SIGNAL_META,
  STATUS_LABEL,
  type AltClusterStatus,
  type AltSignal,
  type ClusterListItem,
} from "./altTypes";

export interface ClusterFilters {
  minConfidence: number;
  status: "" | AltClusterStatus;
  signal: "" | AltSignal;
  hasBanned: boolean;
}

interface ClusterListProps {
  clusters: ClusterListItem[];
  filters: ClusterFilters;
  onFiltersChange: (f: ClusterFilters) => void;
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  onLoadMore: () => void;
  onSelect: (id: string) => void;
  selectedId: string | null;
  onRefresh: () => void;
}

const SIGNAL_ORDER = Object.keys(SIGNAL_META) as AltSignal[];
const STATUSES: AltClusterStatus[] = ["open", "reviewed", "confirmed", "dismissed"];
const MIN_CONF_OPTIONS = [0, 0.4, 0.6, 0.7, 0.8, 0.9];

const STATUS_STYLE: Record<AltClusterStatus, string> = {
  open: "border border-blue-400/25 bg-blue-500/10 text-blue-400",
  reviewed: "border border-purple-400/25 bg-purple-500/10 text-purple-400",
  confirmed: "border border-red-400/25 bg-red-500/10 text-red-400",
  dismissed: "border border-gray-400/20 bg-gray-500/10 text-gray-400",
};

const SELECT_CLS =
  "h-9 rounded-lg border border-card-border bg-card px-2.5 text-sm transition-colors hover:border-muted/50 focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/25 motion-reduce:transition-none";

export function ClusterList({
  clusters,
  filters,
  onFiltersChange,
  loading,
  error,
  hasMore,
  onLoadMore,
  onSelect,
  selectedId,
  onRefresh,
}: ClusterListProps) {
  // has-banned-member is a client-side refinement over the loaded page
  // (the ranked API doesn't filter on ban state; memberPreview carries it).
  const shown = filters.hasBanned
    ? clusters.filter((c) => c.memberPreview.some((m) => m.banned))
    : clusters;

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-xs font-medium text-muted">
          Min confidence
          <select
            value={String(filters.minConfidence)}
            onChange={(e) => onFiltersChange({ ...filters, minConfidence: Number(e.target.value) })}
            className={SELECT_CLS}
          >
            {MIN_CONF_OPTIONS.map((v) => (
              <option key={v} value={v}>
                {v === 0 ? "All" : `${Math.round(v * 100)}%+`}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-1.5 text-xs font-medium text-muted">
          Status
          <select
            value={filters.status}
            onChange={(e) =>
              onFiltersChange({ ...filters, status: e.target.value as "" | AltClusterStatus })
            }
            className={SELECT_CLS}
          >
            <option value="">All</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-1.5 text-xs font-medium text-muted">
          Signal
          <select
            value={filters.signal}
            onChange={(e) =>
              onFiltersChange({ ...filters, signal: e.target.value as "" | AltSignal })
            }
            className={SELECT_CLS}
          >
            <option value="">Any</option>
            {SIGNAL_ORDER.map((s) => (
              <option key={s} value={s}>
                {signalMeta(s).label}
              </option>
            ))}
          </select>
        </label>

        <button
          onClick={() => onFiltersChange({ ...filters, hasBanned: !filters.hasBanned })}
          className={`h-9 rounded-lg border px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 motion-reduce:transition-none ${
            filters.hasBanned
              ? "border-red-400/40 bg-red-500/15 text-red-400"
              : "border-card-border text-muted hover:border-muted/50 hover:text-foreground"
          }`}
          aria-pressed={filters.hasBanned}
        >
          Has banned member
        </button>

        <button
          onClick={onRefresh}
          disabled={loading}
          className="ml-auto h-9 rounded-lg border border-card-border px-3 text-sm transition-colors hover:bg-card-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 disabled:opacity-50 motion-reduce:transition-none"
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && shown.length === 0 && (
        <div className="rounded-xl border border-card-border bg-card px-4 py-14 text-center shadow-card">
          <svg
            className="mx-auto mb-3 h-8 w-8 text-muted/60"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
            aria-hidden
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
            />
          </svg>
          <p className="text-sm font-medium">No suspected rings above threshold</p>
          <p className="mx-auto mt-1 max-w-sm text-xs text-muted">
            {filters.minConfidence > 0 || filters.status || filters.signal || filters.hasBanned
              ? "Try relaxing the filters."
              : "Nothing has scored above the auto-open threshold this compute pass."}
          </p>
        </div>
      )}

      {/* Bounty board */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {shown.map((cluster) => (
          <ClusterCard
            key={cluster.id}
            cluster={cluster}
            selected={selectedId === cluster.id}
            onSelect={() => onSelect(cluster.id)}
          />
        ))}
      </div>

      {loading && shown.length === 0 && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-hidden>
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="flex animate-pulse flex-col gap-3 rounded-xl border border-card-border bg-card p-4 motion-reduce:animate-none"
            >
              <div className="h-3 w-20 rounded bg-card-elevated" />
              <div className="flex gap-3">
                <div className="h-16 w-16 rounded-lg bg-card-elevated" />
                <div className="h-16 w-16 rounded-lg bg-card-elevated/80" />
              </div>
              <div className="h-3 w-2/3 rounded bg-card-elevated/60" />
            </div>
          ))}
        </div>
      )}

      {hasMore && !loading && (
        <button
          onClick={onLoadMore}
          className="h-10 w-full rounded-lg border border-card-border text-sm text-muted transition-colors hover:bg-card-elevated hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 motion-reduce:transition-none"
        >
          Load more
        </button>
      )}
    </div>
  );
}

function ClusterCard({
  cluster,
  selected,
  onSelect,
}: {
  cluster: ClusterListItem;
  selected: boolean;
  onSelect: () => void;
}) {
  const bannedCount = cluster.memberPreview.filter((m) => m.banned).length;
  const top = cluster.topSignal ? signalMeta(cluster.topSignal) : null;
  const accent = confidenceHex(cluster.confidence);

  return (
    <article
      onClick={onSelect}
      className={`group relative flex cursor-pointer flex-col gap-3 overflow-hidden rounded-xl border bg-card p-4 text-left shadow-card transition-colors hover:bg-card-elevated/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 motion-reduce:transition-none ${
        selected ? "border-primary/50 ring-1 ring-primary/30" : "border-card-border"
      }`}
    >
      <span
        aria-hidden
        className="absolute inset-y-3 left-0 w-1 rounded-r-full"
        style={{ backgroundColor: accent }}
      />

      <div className="flex items-start justify-between gap-3 pl-1">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted">
            Wanted
          </div>
          <div className="mt-0.5 text-sm font-semibold tracking-tight">
            {cluster.size} account{cluster.size === 1 ? "" : "s"}
          </div>
        </div>
        <ConfidenceMeter value={cluster.confidence} size="sm" showBand />
      </div>

      <div className="flex flex-wrap items-center gap-1.5 pl-1">
        <span
          className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${STATUS_STYLE[cluster.status]}`}
        >
          {STATUS_LABEL[cluster.status]}
        </span>
        {bannedCount > 0 && (
          <span className="rounded-md border border-red-400/25 bg-red-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-400">
            {bannedCount} banned
          </span>
        )}
        {top && (
          <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
            {top.label}
          </span>
        )}
      </div>

      <ul className="grid grid-cols-1 gap-2 pl-1 sm:grid-cols-2">
        {cluster.memberPreview.map((m) => (
          <li
            key={m.userId}
            className="flex min-w-0 items-center gap-2.5 rounded-lg border border-card-border/60 bg-card-elevated/40 p-2"
          >
            <SuspectMugshot member={m} size="h-12 w-12" />
            <div className="min-w-0 flex-1">
              <SuspectNameButton member={m} />
              {m.role && (
                <div className="text-[10px] font-medium uppercase tracking-wide text-muted">
                  {ROLE_LABEL[m.role]}
                </div>
              )}
              <DiscordContact
                discordId={m.discordId}
                discordUsername={m.discordUsername}
                discordCreatedAt={m.discordCreatedAt}
                compact
              />
            </div>
          </li>
        ))}
        {cluster.size > cluster.memberPreview.length && (
          <li className="flex items-center justify-center rounded-lg border border-dashed border-card-border/60 px-2 py-3 text-[11px] text-muted">
            +{cluster.size - cluster.memberPreview.length} more
          </li>
        )}
      </ul>
    </article>
  );
}
