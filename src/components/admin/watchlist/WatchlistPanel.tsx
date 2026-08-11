"use client";

// WatchlistPanel (forensics v2, Wave 2 "watchlist + alerts") — a moderator's
// pinned-accounts board: add/remove a suspicious account, see its recent
// activity at a glance, and get an alerts strip surfacing anything new
// (an action taken, or a fresh alt link) since the account was last
// reviewed. Self-contained: fetches/mutates `/api/admin/watchlist` itself
// and matches the surface/overline/severity-color language of
// `src/components/admin/alts/*` (ClusterList/EvidencePanel) so it reads as
// the same product. The coordinator wires this into a tab; it does not
// touch AdminTabsConfig itself.
//
// Data contract (`src/app/api/admin/watchlist/route.ts`,
// `src/lib/audit/watchlist.ts`):
//   GET    /api/admin/watchlist        -> { entries: WatchlistEntryView[], currentTurn }
//   POST   /api/admin/watchlist        <- { userId, reason? }  -> { entry } (201)
//   DELETE /api/admin/watchlist/:userId -> { ok: true }
//
// "Alerts" = activity/links whose `turn` is strictly after the entry's
// `lastNotifiedTurn` baseline (`0` for a never-reviewed entry — see the
// server module's doc comment for the exact logic). This component only
// renders that computed state; it does not itself decide what counts as new.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ConfidenceBar } from "../alts/ConfidenceMeter";
import { confidenceHex, formatRelativeTime, memberDisplayName } from "../alts/altTypes";

// ─── API response shapes (mirrors the frozen contract; see module header) ──

interface WatchlistActivityAction {
  id: string;
  ts: string;
  turn: number;
  action: string;
  category: string;
  outcome: string;
}

interface WatchlistActivitySummary {
  totalActions: number;
  lastActionAt: string | null;
  lastActionTurn: number | null;
  recentActions: WatchlistActivityAction[];
}

interface WatchlistNewLink {
  userId: string;
  username: string | null;
  confidence: number;
  turn: number;
}

interface WatchlistAlerts {
  sinceTurn: number;
  newActivityCount: number;
  hasNewActivity: boolean;
  newLinks: WatchlistNewLink[];
  hasNewLinks: boolean;
}

interface WatchlistEntryView {
  id: string;
  userId: string;
  username: string | null;
  banned: boolean;
  addedBy: string;
  addedByName: string | null;
  reason: string | null;
  createdAt: string;
  lastNotifiedTurn: number | null;
  activity: WatchlistActivitySummary;
  alerts: WatchlistAlerts;
}

interface WatchlistListResponse {
  entries: WatchlistEntryView[];
  currentTurn: number;
}

// ─── Component ───────────────────────────────────────────────────────────

export interface WatchlistPanelProps {
  /** Optional deep-link hooks — wired up by the coordinator once the
   * dossier/alts drill-in views exist. Omitted callbacks degrade
   * gracefully: the pivot buttons still render (copy-id always works). */
  onOpenDossier?: (userId: string) => void;
  onOpenAltLink?: (userId: string) => void;
}

const OBJECT_ID_RE = /^[0-9a-f]{24}$/i;

const CARD_CLS = "rounded-xl border border-card-border bg-card p-4 shadow-card";
const OVERLINE_CLS = "text-[11px] font-semibold uppercase tracking-[0.14em] text-muted";
const BTN_CLS =
  "inline-flex h-9 items-center justify-center rounded-lg border px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 disabled:opacity-50 motion-reduce:transition-none";

export default function WatchlistPanel({ onOpenDossier, onOpenAltLink }: WatchlistPanelProps) {
  const [entries, setEntries] = useState<WatchlistEntryView[]>([]);
  const [currentTurn, setCurrentTurn] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [userIdInput, setUserIdInput] = useState("");
  const [reasonInput, setReasonInput] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const [removingId, setRemovingId] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [highlighted, setHighlighted] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/watchlist", { cache: "no-store" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Failed to load watchlist (${res.status})`);
      }
      const data: WatchlistListResponse = await res.json();
      setEntries(data.entries);
      setCurrentTurn(data.currentTurn);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load watchlist");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const alertedEntries = useMemo(
    () => entries.filter((e) => e.alerts.hasNewActivity || e.alerts.hasNewLinks),
    [entries]
  );

  function jumpTo(id: string) {
    const node = rowRefs.current.get(id);
    node?.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlighted(id);
    setTimeout(() => setHighlighted((cur) => (cur === id ? null : cur)), 1800);
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setAddError(null);
    const userId = userIdInput.trim();
    if (!OBJECT_ID_RE.test(userId)) {
      setAddError("Enter a valid 24-character user id.");
      return;
    }
    setAdding(true);
    try {
      const res = await fetch("/api/admin/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, reason: reasonInput.trim() || undefined }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error ?? `Failed to add (${res.status})`);
      }
      setEntries((prev) => [body.entry as WatchlistEntryView, ...prev]);
      setUserIdInput("");
      setReasonInput("");
      setFlash(`Pinned ${body.entry?.username ?? "account"} to the watchlist.`);
      setTimeout(() => setFlash(null), 3500);
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Failed to add");
    } finally {
      setAdding(false);
    }
  }

  async function handleRemove(userId: string) {
    setRemovingId(userId);
    try {
      const res = await fetch(`/api/admin/watchlist/${userId}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Failed to remove (${res.status})`);
      }
      setEntries((prev) => prev.filter((e) => e.userId !== userId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove");
    } finally {
      setRemovingId(null);
    }
  }

  function copyId(userId: string) {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(userId).catch(() => {});
    }
    setFlash("Copied user id to clipboard.");
    setTimeout(() => setFlash(null), 2000);
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className={OVERLINE_CLS}>Watchlist</h3>
          <p className="mt-0.5 text-sm text-muted">
            {entries.length} pinned account{entries.length === 1 ? "" : "s"}
            {currentTurn > 0 ? ` · turn ${currentTurn}` : ""}
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className={`${BTN_CLS} border-card-border text-muted hover:bg-card-elevated hover:text-foreground`}
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {/* Add form */}
      <form onSubmit={handleAdd} className={`${CARD_CLS} flex flex-wrap items-end gap-2`}>
        <label className="flex min-w-[220px] flex-1 flex-col gap-1 text-xs font-medium text-muted">
          User id
          <input
            value={userIdInput}
            onChange={(e) => setUserIdInput(e.target.value)}
            placeholder="24-character user id"
            className="h-9 rounded-lg border border-card-border bg-card px-2.5 text-sm text-foreground transition-colors placeholder:text-muted/60 hover:border-muted/50 focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/25 motion-reduce:transition-none"
          />
        </label>
        <label className="flex min-w-[220px] flex-[2] flex-col gap-1 text-xs font-medium text-muted">
          Reason (optional)
          <input
            value={reasonInput}
            onChange={(e) => setReasonInput(e.target.value)}
            placeholder="Why is this account being watched?"
            className="h-9 rounded-lg border border-card-border bg-card px-2.5 text-sm text-foreground transition-colors placeholder:text-muted/60 hover:border-muted/50 focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/25 motion-reduce:transition-none"
          />
        </label>
        <button
          type="submit"
          disabled={adding || !userIdInput.trim()}
          className={`${BTN_CLS} border-primary/40 bg-primary/10 text-primary hover:bg-primary/20`}
        >
          {adding ? "Adding…" : "Add to watchlist"}
        </button>
        {addError && <p className="w-full text-xs text-red-400">{addError}</p>}
      </form>

      {flash && (
        <div className="rounded-lg border border-emerald-400/25 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-300">
          {flash}
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Alerts strip */}
      {alertedEntries.length > 0 && (
        <div className="rounded-xl border border-orange-400/25 bg-orange-500/10 p-3">
          <div className="mb-2 flex items-center gap-2">
            <svg
              className="h-4 w-4 flex-shrink-0 text-orange-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
              />
            </svg>
            <span className="text-sm font-semibold text-orange-300">
              {alertedEntries.length} watched account{alertedEntries.length === 1 ? "" : "s"} have
              new activity since review
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {alertedEntries.map((e) => (
              <button
                key={e.id}
                onClick={() => jumpTo(e.id)}
                className="rounded-md border border-orange-400/30 bg-orange-500/10 px-2 py-1 text-xs font-medium text-orange-200 transition-colors hover:bg-orange-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 motion-reduce:transition-none"
              >
                {memberDisplayName(e.username, e.userId)}
                {e.alerts.hasNewActivity && (
                  <span className="ml-1 text-orange-300">
                    · {e.alerts.newActivityCount} action{e.alerts.newActivityCount === 1 ? "" : "s"}
                  </span>
                )}
                {e.alerts.hasNewLinks && (
                  <span className="ml-1 text-orange-300">
                    · {e.alerts.newLinks.length} link{e.alerts.newLinks.length === 1 ? "" : "s"}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && entries.length === 0 && (
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
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z"
            />
          </svg>
          <p className="text-sm font-medium">Nothing pinned yet</p>
          <p className="mx-auto mt-1 max-w-sm text-xs text-muted">
            Add a suspicious account above to start tracking its activity and alt links.
          </p>
        </div>
      )}

      {/* Loading skeleton */}
      {loading && entries.length === 0 && (
        <div className="space-y-3" aria-hidden>
          {[0, 1].map((i) => (
            <div
              key={i}
              className="flex animate-pulse items-center gap-4 rounded-xl border border-card-border bg-card p-4 motion-reduce:animate-none"
            >
              <div className="h-10 w-10 flex-shrink-0 rounded-full bg-card-elevated" />
              <div className="flex-1 space-y-2.5">
                <div className="h-3.5 w-1/3 rounded bg-card-elevated" />
                <div className="h-3 w-2/3 rounded bg-card-elevated/80" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Entries */}
      <div className="space-y-3">
        {entries.map((entry) => (
          <WatchlistRow
            key={entry.id}
            entry={entry}
            highlighted={highlighted === entry.id}
            removing={removingId === entry.userId}
            onRemove={() => handleRemove(entry.userId)}
            onCopyId={() => copyId(entry.userId)}
            onOpenDossier={onOpenDossier}
            onOpenAltLink={onOpenAltLink}
            registerRef={(node) => {
              if (node) rowRefs.current.set(entry.id, node);
              else rowRefs.current.delete(entry.id);
            }}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Row ─────────────────────────────────────────────────────────────────

function WatchlistRow({
  entry,
  highlighted,
  removing,
  onRemove,
  onCopyId,
  onOpenDossier,
  onOpenAltLink,
  registerRef,
}: {
  entry: WatchlistEntryView;
  highlighted: boolean;
  removing: boolean;
  onRemove: () => void;
  onCopyId: () => void;
  onOpenDossier?: (userId: string) => void;
  onOpenAltLink?: (userId: string) => void;
  registerRef: (node: HTMLDivElement | null) => void;
}) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  const hasAlert = entry.alerts.hasNewActivity || entry.alerts.hasNewLinks;
  const topNewLink = entry.alerts.newLinks[0] ?? null;

  return (
    <div
      ref={registerRef}
      className={`relative overflow-hidden rounded-xl border bg-card p-4 shadow-card transition-colors ${
        highlighted
          ? "border-primary/60 ring-2 ring-primary/40"
          : hasAlert
            ? "border-orange-400/30"
            : "border-card-border"
      }`}
    >
      {hasAlert && (
        <span aria-hidden className="absolute inset-y-3 left-0 w-1 rounded-r-full bg-orange-400" />
      )}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold tracking-tight">
              {memberDisplayName(entry.username, entry.userId)}
            </span>
            {entry.banned && (
              <span className="rounded-md border border-red-400/25 bg-red-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-400">
                Banned
              </span>
            )}
            {entry.alerts.hasNewActivity && (
              <span className="rounded-md border border-orange-400/25 bg-orange-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-orange-300">
                {entry.alerts.newActivityCount} new action
                {entry.alerts.newActivityCount === 1 ? "" : "s"}
              </span>
            )}
            {entry.alerts.hasNewLinks && (
              <span className="rounded-md border border-purple-400/25 bg-purple-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-purple-300">
                {entry.alerts.newLinks.length} new link
                {entry.alerts.newLinks.length === 1 ? "" : "s"}
              </span>
            )}
          </div>

          {entry.reason && <p className="text-xs text-muted">{entry.reason}</p>}

          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted">
            <span>
              Pinned {formatRelativeTime(entry.createdAt)}
              {entry.addedByName ? ` by ${entry.addedByName}` : ""}
            </span>
            <span>
              {entry.activity.totalActions} action{entry.activity.totalActions === 1 ? "" : "s"} on
              record
            </span>
            {entry.activity.lastActionAt && (
              <span>last active {formatRelativeTime(entry.activity.lastActionAt)}</span>
            )}
          </div>

          {entry.activity.recentActions.length > 0 && (
            <ul className="flex flex-wrap gap-1">
              {entry.activity.recentActions.slice(0, 5).map((a) => (
                <li
                  key={a.id}
                  title={`turn ${a.turn} · ${a.outcome}`}
                  className={`rounded-md border px-1.5 py-0.5 text-[10px] ${
                    a.outcome === "ok"
                      ? "border-card-border/60 bg-card-elevated/60 text-muted"
                      : "border-red-400/25 bg-red-500/10 text-red-300"
                  }`}
                >
                  {a.action}
                </li>
              ))}
            </ul>
          )}

          {topNewLink && (
            <div className="flex items-center gap-2 rounded-lg border border-purple-400/20 bg-purple-500/5 px-2.5 py-1.5">
              <span
                aria-hidden
                className="inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full"
                style={{ backgroundColor: confidenceHex(topNewLink.confidence) }}
              />
              <span className="text-xs text-muted">
                New alt link to{" "}
                <button
                  onClick={() => onOpenAltLink?.(topNewLink.userId)}
                  className="font-medium text-foreground underline decoration-dotted underline-offset-2 hover:text-primary"
                >
                  {memberDisplayName(topNewLink.username, topNewLink.userId)}
                </button>
              </span>
              <ConfidenceBar value={topNewLink.confidence} widthClass="w-16" />
            </div>
          )}
        </div>

        {/* Pivots + remove */}
        <div className="flex flex-shrink-0 items-center gap-1.5">
          <button
            onClick={() => onOpenDossier?.(entry.userId)}
            title="Open dossier"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-card-border text-muted transition-colors hover:bg-card-elevated hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 motion-reduce:transition-none"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
              />
            </svg>
          </button>
          <button
            onClick={onCopyId}
            title="Copy user id"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-card-border text-muted transition-colors hover:bg-card-elevated hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 motion-reduce:transition-none"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
              />
            </svg>
          </button>
          {confirmRemove ? (
            <div className="flex items-center gap-1">
              <button
                onClick={onRemove}
                disabled={removing}
                className={`${BTN_CLS} h-8 border-red-400/40 bg-red-500/15 px-2 text-xs text-red-400 hover:bg-red-500/25`}
              >
                {removing ? "Removing…" : "Confirm"}
              </button>
              <button
                onClick={() => setConfirmRemove(false)}
                className="inline-flex h-8 items-center rounded-lg border border-card-border px-2 text-xs text-muted transition-colors hover:bg-card-elevated motion-reduce:transition-none"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmRemove(true)}
              title="Remove from watchlist"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-card-border text-muted transition-colors hover:border-red-400/40 hover:bg-red-500/10 hover:text-red-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 motion-reduce:transition-none"
            >
              <svg
                className="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
