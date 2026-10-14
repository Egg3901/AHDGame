"use client";

import { apiErrorText } from "@/lib/errors/catalog";
import { Suspense, useCallback, useEffect, useState, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { FeedbackModal } from "@/components/FeedbackModal";
import {
  SUGGESTION_CATEGORY_LABELS,
  SUGGESTION_GAME_SYSTEM_LABELS,
} from "@/components/FeedbackModal/constants";
import { Button, Skeleton } from "@/components/ui";
import { HeroImage } from "@/components/HeroImage";
import { CDN_HERO_ACTIONS_URL } from "@/lib/images/staticCdnAssets";
import {
  SuggestionThreadRow,
  THREAD_GRID,
  type SuggestionThreadItem,
} from "@/components/suggestions/SuggestionThreadRow";
import { SelectionBar } from "@/components/suggestions/SelectionBar";

type ListItem = SuggestionThreadItem;

/** Board tabs: '' = all statuses */
const STATUS_TABS: { key: string; label: string }[] = [
  { key: "", label: "All" },
  { key: "not_reviewed", label: "Not reviewed" },
  { key: "planned", label: "Planned" },
  { key: "in_progress", label: "In progress" },
  { key: "completed", label: "Completed" },
  { key: "not_implementing", label: "Not implementing" },
];

const CATEGORY_OPTIONS = Object.entries(SUGGESTION_CATEGORY_LABELS).map(([k, v]) => ({
  value: k,
  label: v,
}));

const GAME_SYSTEM_OPTIONS = Object.entries(SUGGESTION_GAME_SYSTEM_LABELS).map(([k, v]) => ({
  value: k,
  label: v,
}));

function FeedbackBoardInner() {
  const searchParams = useSearchParams();
  const composeFromUrlRef = useRef(false);

  const [composeOpen, setComposeOpen] = useState(false);

  const [items, setItems] = useState<ListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({});
  const [totalAll, setTotalAll] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sort, setSort] = useState("recent");
  const [statusTab, setStatusTab] = useState("");
  const [categoryFilter, setCategoryFilter] = useState(() => {
    const fromUrl = searchParams.get("category") ?? "";
    return fromUrl in SUGGESTION_CATEGORY_LABELS ? fromUrl : "";
  });
  const [gameSystemFilter, setGameSystemFilter] = useState("");
  const [offset, setOffset] = useState(0);
  const limit = 24;

  // Selection state (admin merge / delete)
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isAdmin, setIsAdmin] = useState(false);

  const fetchTabCounts = useCallback(async () => {
    try {
      const res = await fetch("/api/suggestions/public/counts");
      const data = await res.json();
      if (!res.ok) return;
      setStatusCounts(data.counts ?? {});
      setTotalAll(typeof data.total === "number" ? data.total : 0);
    } catch {
      /* ignore */
    }
  }, []);

  const fetchList = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        sort,
        limit: String(limit),
        offset: String(offset),
      });
      if (statusTab) params.set("status", statusTab);
      if (categoryFilter) params.set("category", categoryFilter);
      if (gameSystemFilter) params.set("gameSystem", gameSystemFilter);
      const res = await fetch(`/api/suggestions/public?${params}`);
      const data = await res.json();
      if (!res.ok) {
        setError(apiErrorText(data, "Failed to load"));
        setItems([]);
        return;
      }
      setItems(data.items ?? []);
      setTotal(data.total ?? 0);
      void fetchTabCounts();
    } catch {
      setError("Network error");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [sort, statusTab, categoryFilter, gameSystemFilter, offset, fetchTabCounts]);

  useEffect(() => {
    void fetchList();
  }, [fetchList]);

  // Check admin status on mount
  useEffect(() => {
    async function checkAdmin() {
      try {
        const res = await fetch("/api/auth/me");
        const data = await res.json();
        if (res.ok && data?.user?.isAdmin) setIsAdmin(true);
      } catch {
        /* ignore */
      }
    }
    void checkAdmin();
  }, []);

  const openCompose = useCallback(() => {
    setComposeOpen(true);
  }, []);

  const closeCompose = useCallback(() => {
    setComposeOpen(false);
  }, []);

  useEffect(() => {
    if (searchParams.get("compose") !== "1" || composeFromUrlRef.current) return;
    composeFromUrlRef.current = true;
    void openCompose();
  }, [searchParams, openCompose]);

  // Selection handlers
  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const cancelSelection = useCallback(() => {
    setSelectedIds(new Set());
    setSelectMode(false);
  }, []);

  const handleMerge = useCallback(async () => {
    const selected = items.filter((i) => selectedIds.has(i.id));
    if (selected.length < 2) return;

    const target = selected[0];
    const sources = selected.slice(1);

    try {
      const res = await fetch("/api/admin/suggestions/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetIssueNumber: target.issueNumber,
          sourceIssueNumbers: sources.map((s) => s.issueNumber),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(apiErrorText(data, "Merge failed"));
        return;
      }
      setSelectedIds(new Set());
      void fetchList();
    } catch {
      setError("Network error during merge");
    }
  }, [items, selectedIds, fetchList]);

  const handleBulkDelete = useCallback(async () => {
    const selected = items.filter((i) => selectedIds.has(i.id));
    if (selected.length === 0) return;

    const confirmed = window.confirm(
      `Delete ${selected.length} suggestion${selected.length === 1 ? "" : "s"}? This cannot be undone.`
    );
    if (!confirmed) return;

    try {
      const res = await fetch("/api/admin/suggestions/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          issueNumbers: selected.map((s) => s.issueNumber),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(apiErrorText(data, "Delete failed"));
        return;
      }
      setSelectedIds(new Set());
      void fetchList();
    } catch {
      setError("Network error during delete");
    }
  }, [items, selectedIds, fetchList]);

  const _handleStatusChange = useCallback(
    async (issueNumber: number, newStatus: string) => {
      try {
        const res = await fetch(`/api/admin/suggestions/${issueNumber}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: newStatus }),
        });
        if (!res.ok) {
          const data = await res.json();
          setError(apiErrorText(data, "Update failed"));
          return;
        }
        setItems((prev) =>
          prev.map((item) =>
            item.issueNumber === issueNumber ? { ...item, status: newStatus } : item
          )
        );
        void fetchTabCounts();
      } catch {
        setError("Network error");
      }
    },
    [fetchTabCounts]
  );

  return (
    <div className="min-h-screen bg-background pb-16">
      {/* Hero */}
      <div className="mx-auto max-w-6xl px-4 sm:px-6 pt-6">
        <header className="relative overflow-hidden rounded-2xl border border-card-border bg-card shadow-lg">
          <div className="relative h-[150px] w-full sm:h-[180px]">
            <HeroImage
              src={CDN_HERO_ACTIONS_URL}
              alt="Community suggestions"
              fill
              className="object-cover object-center"
              sizes="(max-width: 1280px) 100vw, 1280px"
              priority
            />
            <div
              className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent"
              aria-hidden
            />
            <div className="absolute top-4 right-4 sm:top-5 sm:right-5">
              <button
                onClick={openCompose}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium transition-colors hover:bg-primary/90"
              >
                New suggestion
              </button>
            </div>
            <div className="pointer-events-none absolute inset-0 flex flex-col justify-end px-6 pb-5 sm:px-8 sm:pb-7">
              <h1 className="text-2xl font-bold tracking-tight text-white drop-shadow-md sm:text-3xl">
                Suggestions
              </h1>
              <p className="mt-1.5 text-sm text-white/80 drop-shadow max-w-xl">
                Start a thread, vote and reply. Every suggestion is also posted on Discord, and
                votes there count here.
              </p>
            </div>
          </div>
        </header>
      </div>

      <div className="mx-auto max-w-6xl px-4 sm:px-6 py-6 space-y-5">
        {/* Status tabs */}
        <div className="flex flex-wrap gap-1.5 border-b border-card-border pb-3">
          {STATUS_TABS.map((t) => {
            const count = t.key === "" ? totalAll : (statusCounts[t.key] ?? 0);
            const active = statusTab === t.key;
            return (
              <button
                key={t.key || "all"}
                type="button"
                onClick={() => {
                  setStatusTab(t.key);
                  setOffset(0);
                }}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  active
                    ? "bg-primary/15 text-primary ring-1 ring-primary/30"
                    : "text-muted hover:bg-card-elevated hover:text-foreground"
                }`}
              >
                {t.label}
                {typeof count === "number" ? (
                  <span className="ml-1.5 tabular-nums text-xs opacity-80">({count})</span>
                ) : null}
              </button>
            );
          })}
        </div>

        {/* Inline filter toolbar */}
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-muted">Sort</label>
            <select
              value={sort}
              onChange={(e) => {
                setSort(e.target.value);
                setOffset(0);
              }}
              className="rounded-lg border border-card-border bg-card px-2.5 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none"
            >
              <option value="recent">Newest</option>
              <option value="top">Top voted</option>
              <option value="oldest">Oldest</option>
              <option value="comments">Most comments</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-muted">Category</label>
            <select
              value={categoryFilter}
              onChange={(e) => {
                setCategoryFilter(e.target.value);
                setOffset(0);
              }}
              className="rounded-lg border border-card-border bg-card px-2.5 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none"
            >
              <option value="">All</option>
              {CATEGORY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-muted">Area</label>
            <select
              value={gameSystemFilter}
              onChange={(e) => {
                setGameSystemFilter(e.target.value);
                setOffset(0);
              }}
              className="rounded-lg border border-card-border bg-card px-2.5 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none"
            >
              <option value="">All</option>
              {GAME_SYSTEM_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          {isAdmin && (
            <button
              type="button"
              onClick={() => (selectMode ? cancelSelection() : setSelectMode(true))}
              className={`ml-auto rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                selectMode
                  ? "border-primary/40 bg-primary/15 text-primary"
                  : "border-card-border text-muted hover:text-foreground"
              }`}
            >
              {selectMode ? "Done selecting" : "Select to merge"}
            </button>
          )}
        </div>

        {error && (
          <div className="rounded-lg border border-error/30 bg-error/10 px-4 py-2 text-sm text-error">
            {error}
          </div>
        )}

        <section className="overflow-hidden rounded-xl border border-card-border bg-card shadow-md">
          <div
            className={`${THREAD_GRID} hidden border-b border-card-border bg-card-muted px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted md:grid`}
          >
            <span className="col-span-2">Thread</span>
            <span className="text-center">Votes</span>
            <span className="text-center">Replies</span>
            <span className="text-right">Status</span>
          </div>
          {loading ? (
            <ul className="divide-y divide-card-border">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <li key={i} className="flex items-center gap-4 px-4 py-4">
                  <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                </li>
              ))}
            </ul>
          ) : items.length === 0 ? (
            <p className="px-4 py-12 text-center text-sm text-muted">
              No suggestions in this view yet.
            </p>
          ) : (
            <ul className="divide-y divide-card-border">
              {items.map((item) => (
                <SuggestionThreadRow
                  key={item.id}
                  item={item}
                  selectMode={isAdmin && selectMode}
                  selected={selectedIds.has(item.id)}
                  onToggleSelect={toggleSelect}
                />
              ))}
            </ul>
          )}
          {!loading && total > limit && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-card-border bg-card-muted/60 px-4 py-2.5">
              <span className="text-xs tabular-nums text-muted">
                {offset + 1} to {Math.min(offset + limit, total)} of {total}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  disabled={offset === 0}
                  onClick={() => setOffset((o) => Math.max(0, o - limit))}
                  className="px-3 py-1 text-xs"
                >
                  Previous
                </Button>
                <Button
                  variant="secondary"
                  disabled={offset + limit >= total}
                  onClick={() => setOffset((o) => o + limit)}
                  className="px-3 py-1 text-xs"
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </section>

        {selectedIds.size > 0 && isAdmin && (
          <SelectionBar
            selectedCount={selectedIds.size}
            onMerge={handleMerge}
            onDelete={handleBulkDelete}
            onCancel={cancelSelection}
          />
        )}
      </div>

      <FeedbackModal isOpen={composeOpen} onClose={closeCompose} />
    </div>
  );
}

export default function FeedbackPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto min-h-[60vh] max-w-6xl space-y-5 px-4 py-6 sm:px-6">
          <div className="flex gap-1.5 border-b border-card-border pb-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-8 w-20" />
            ))}
          </div>
          <Skeleton className="h-96 w-full rounded-xl" />
        </div>
      }
    >
      <FeedbackBoardInner />
    </Suspense>
  );
}
