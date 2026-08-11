"use client";

/**
 * InboxClient — Desktop inbox shell.
 * Composes useInboxData + useReducer(inboxReducer) with the rail, reading pane,
 * segment chips, and grouping into "This turn / Earlier".
 */

import { useReducer, useMemo, useEffect, useState, useCallback } from "react";
import { useInboxData } from "./useInboxData";
import { inboxReducer, initialInboxState } from "./inboxReducer";
import { RailItem } from "./RailItem";
import { NotifDetail } from "./NotifDetail";
import { MailThreadView } from "./MailThreadView";
import { InboxEmpty } from "./InboxEmpty";
import { PriorityLane } from "./PriorityLane";
import type { InboxItem } from "@/lib/inbox";
import { fetchJson } from "@/lib/observability/fetchJson";
import { Skeleton, ListRowSkeleton } from "@/components/ui";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EyebrowInfo {
  name: string;
  seat: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function segmentLabel(seg: "all" | "action" | "notifs" | "mail"): string {
  switch (seg) {
    case "all":
      return "All";
    case "action":
      return "Priority";
    case "notifs":
      return "Notifications";
    case "mail":
      return "Mail";
  }
}

function groupItems(items: InboxItem[]): { thisTurn: InboxItem[]; earlier: InboxItem[] } {
  // Items with time === "now" or ending in "m" or "h" are considered "this turn".
  // Items ending in "d" are "earlier". This is a display heuristic — the exact
  // cutoff doesn't need to be precise.
  const thisTurn: InboxItem[] = [];
  const earlier: InboxItem[] = [];
  for (const item of items) {
    const t = item.time;
    if (t === "now" || t.endsWith("m") || t.endsWith("h")) {
      thisTurn.push(item);
    } else {
      earlier.push(item);
    }
  }
  return { thisTurn, earlier };
}

// ---------------------------------------------------------------------------
// MonoCount chip
// ---------------------------------------------------------------------------

function MonoCount({ n }: { n: number }) {
  return (
    <span className="ml-1.5 inline-block min-w-[1.25rem] rounded bg-card-elevated px-1 text-center font-mono text-[10px] tabular-nums text-muted">
      {n}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function InboxClient() {
  const { items, loading, error, refetch, counts } = useInboxData();
  const [state, dispatch] = useReducer(inboxReducer, initialInboxState);
  const [eyebrow, setEyebrow] = useState<EyebrowInfo | null>(null);
  // Mobile: false = rail visible, true = reading pane visible (full-screen).
  // Ignored at lg+ where both columns always show.
  const [mobileReader, setMobileReader] = useState(false);

  // Fetch character eyebrow info from /api/auth/me
  useEffect(() => {
    fetchJson<{
      username?: string;
      character?: { name?: string; officeName?: string; partyName?: string };
    }>("/api/auth/me", { feature: "inbox-eyebrow" })
      .then((data) => {
        if (!data) return;
        const name: string = data.character?.name ?? data.username ?? "";
        const seat: string = data.character?.officeName ?? data.character?.partyName ?? "";
        if (name) setEyebrow({ name, seat });
      })
      .catch(() => {
        // Non-blocking; eyebrow is decorative
      });
  }, []);

  // Derive visible items for the active segment, hiding archived
  const visibleItems = useMemo(() => {
    const base = items.filter((i) => !state.archivedIds.has(i.id));
    if (state.seg === "notifs") return base.filter((i) => i.kind === "notif");
    if (state.seg === "mail") return base.filter((i) => i.kind === "mail");
    if (state.seg === "action") {
      return base.filter((i) => {
        const effectivelyUnread = i.unread && !state.readIds.has(i.id);
        return i.action && effectivelyUnread;
      });
    }
    return base;
  }, [items, state.seg, state.archivedIds, state.readIds]);

  // Derive effective selected item (default to first if none selected)
  const selId = state.selId ?? visibleItems[0]?.id ?? null;
  const sel = visibleItems.find((i) => i.id === selId) ?? null;

  // Apply optimistic read state
  const itemsWithReadState = useMemo(
    () => visibleItems.map((i) => (state.readIds.has(i.id) ? { ...i, unread: false } : i)),
    [visibleItems, state.readIds]
  );

  const { thisTurn, earlier } = useMemo(() => groupItems(itemsWithReadState), [itemsWithReadState]);

  // Select + mark read
  const handleSelect = useCallback(
    async (item: InboxItem) => {
      dispatch({ type: "SELECT", id: item.id });
      setMobileReader(true);
      if (item.unread && !state.readIds.has(item.id)) {
        dispatch({ type: "MARK_READ", id: item.id });
        try {
          if (item.kind === "notif") {
            await fetch("/api/notifications", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id: item.id, action: "read" }),
            });
          } else {
            await fetch(`/api/mail/${item.id}`, { method: "PATCH" });
          }
        } catch {
          // Best-effort — UI is already updated optimistically
        }
      }
    },
    [state.readIds]
  );

  // Archive
  const handleArchive = useCallback(async (item: InboxItem) => {
    dispatch({ type: "ARCHIVE", id: item.id });
    try {
      await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id, action: "archive" }),
      });
    } catch {
      // Best-effort
    }
  }, []);

  // Snooze
  const handleSnooze = useCallback(async (item: InboxItem) => {
    dispatch({ type: "SNOOZE", id: item.id });
    try {
      await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id, action: "snooze" }),
      });
    } catch {
      // Best-effort
    }
  }, []);

  // Mark all read
  const handleMarkAllRead = useCallback(async () => {
    const unreadIds = visibleItems.filter((i) => i.unread).map((i) => i.id);
    if (unreadIds.length === 0) return;
    dispatch({ type: "MARK_ALL_READ", ids: unreadIds });
    // Best-effort batch — fire and forget
    for (const id of unreadIds) {
      fetchJson("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action: "read" }),
        feature: "inbox-mark-all-read",
      }).catch(() => {});
    }
  }, [visibleItems]);

  // Loading state — mirrors header + segment chips + rail/reading-pane grid
  if (loading) {
    return (
      <div className="mx-auto min-h-[50vh] max-w-7xl px-4 pb-16 sm:px-6">
        <div className="mb-6 mt-6 space-y-2">
          <Skeleton className="h-8 w-28" />
          <Skeleton className="h-4 w-44" />
        </div>
        <div className="mb-5 flex flex-wrap gap-1.5">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-24 rounded-full" />
          ))}
        </div>
        <div className="grid gap-6 lg:grid-cols-[352px_1fr]">
          <div className="rounded-xl border border-card-border bg-card px-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <ListRowSkeleton key={i} lines={2} />
            ))}
          </div>
          <div className="hidden min-h-[480px] space-y-3 rounded-xl border border-card-border bg-card p-6 lg:block">
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="mt-6 h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3">
        <p className="text-sm text-error">{error}</p>
        <button
          type="button"
          onClick={refetch}
          className="text-sm text-primary underline underline-offset-2"
        >
          Try again
        </button>
      </div>
    );
  }

  const compact = state.density === "compact";

  return (
    <div className="mx-auto max-w-7xl px-4 pb-16 sm:px-6">
      {/* Page header */}
      <div className="mb-6 mt-6 flex items-start justify-between gap-4">
        <div>
          {/* Eyebrow */}
          {eyebrow && (
            <p className="mb-0.5 text-[11px] font-semibold uppercase tracking-widest text-muted">
              {eyebrow.name}
              {eyebrow.seat ? <span className="mx-1.5 opacity-40">·</span> : null}
              {eyebrow.seat}
            </p>
          )}
          <h1 className="text-2xl font-bold text-foreground">Inbox</h1>
          <p className="mt-1 text-sm text-muted">
            {state.seg === "action" ? (
              <>
                <span className="font-mono tabular-nums">{counts.action}</span>
                {counts.action === 1 ? " item needs" : " items need"} your input
              </>
            ) : (
              <>
                <span className="font-mono tabular-nums">{counts.all}</span> unread
                {counts.action > 0 && (
                  <>
                    {" · "}
                    <button
                      type="button"
                      onClick={() => dispatch({ type: "SET_SEG", seg: "action" })}
                      className="font-mono tabular-nums text-error underline-offset-2 hover:underline"
                    >
                      {counts.action} priority
                    </button>
                  </>
                )}
              </>
            )}
          </p>
        </div>

        {/* Mark all read */}
        <button
          type="button"
          onClick={handleMarkAllRead}
          disabled={counts.all === 0}
          className="shrink-0 rounded-lg border border-card-border bg-card px-3.5 py-1.5 text-sm font-medium text-muted transition-colors hover:border-primary/30 hover:text-foreground disabled:pointer-events-none disabled:opacity-40 motion-reduce:transition-none"
        >
          Mark all read
        </button>
      </div>

      {/* Priority lane — active event needing inline input (renders null when none) */}
      <PriorityLane onResolved={refetch} />

      {/* Segment chips */}
      <div role="tablist" aria-label="Inbox segment" className="mb-5 flex flex-wrap gap-1.5">
        {(["action", "all", "notifs", "mail"] as const).map((seg) => {
          const active = state.seg === seg;
          const count =
            seg === "all"
              ? counts.all
              : seg === "action"
                ? counts.action
                : seg === "notifs"
                  ? counts.notifs
                  : counts.mail;
          return (
            <button
              key={seg}
              role="tab"
              type="button"
              aria-selected={active}
              onClick={() => {
                dispatch({ type: "SET_SEG", seg });
                setMobileReader(false);
              }}
              className={[
                "flex items-center rounded-full border px-3.5 py-1 text-sm font-medium transition-colors motion-reduce:transition-none",
                active
                  ? seg === "action"
                    ? "border-error/30 bg-error/10 text-error"
                    : "border-primary/30 bg-primary/10 text-primary"
                  : seg === "action"
                    ? "border-card-border bg-card text-muted hover:border-error/20 hover:text-error"
                    : "border-card-border bg-card text-muted hover:border-primary/20 hover:text-foreground",
              ].join(" ")}
            >
              {segmentLabel(seg)}
              <MonoCount n={count} />
            </button>
          );
        })}
      </div>

      {/* Empty state */}
      {visibleItems.length === 0 && (
        <InboxEmpty
          filterLabel={segmentLabel(state.seg)}
          variant={state.seg === "action" ? "priority" : "default"}
        />
      )}

      {/* Two-column grid: 352px rail | 1fr reading pane */}
      {visibleItems.length > 0 && (
        <div className="grid gap-6 lg:grid-cols-[352px_1fr] lg:h-[calc(100vh-240px)]">
          {/* Rail */}
          <div
            className={`min-h-0 overflow-y-auto rounded-xl border border-card-border bg-card lg:block ${mobileReader ? "hidden" : "block"}`}
          >
            {thisTurn.length > 0 && (
              <>
                <div className="border-b border-card-border px-4 py-2">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-muted">
                    This turn
                  </p>
                </div>
                {thisTurn.map((item) => (
                  <RailItem
                    key={item.id}
                    item={item}
                    selected={item.id === selId}
                    compact={compact}
                    onSelect={() => void handleSelect(item)}
                  />
                ))}
              </>
            )}

            {earlier.length > 0 && (
              <>
                <div className="border-b border-card-border px-4 py-2">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-muted">
                    Earlier
                  </p>
                </div>
                {earlier.map((item) => (
                  <RailItem
                    key={item.id}
                    item={item}
                    selected={item.id === selId}
                    compact={compact}
                    onSelect={() => void handleSelect(item)}
                  />
                ))}
              </>
            )}
          </div>

          {/* Reading pane */}
          <div
            className={`min-h-[480px] overflow-hidden rounded-xl border border-card-border bg-card lg:block ${mobileReader ? "block" : "hidden"}`}
          >
            {/* Mobile back-to-list */}
            <button
              type="button"
              onClick={() => setMobileReader(false)}
              className="flex w-full items-center gap-1.5 border-b border-card-border px-4 py-2.5 text-sm font-medium text-muted hover:text-foreground lg:hidden"
            >
              <span aria-hidden>←</span> Back to inbox
            </button>
            {sel == null ? (
              <InboxEmpty />
            ) : sel.kind === "mail" ? (
              <MailThreadView
                key={sel.id}
                item={sel}
                onArchive={() => void handleArchive(sel)}
                onSent={refetch}
              />
            ) : (
              <NotifDetail
                item={sel}
                onArchive={() => void handleArchive(sel)}
                onSnooze={() => void handleSnooze(sel)}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
