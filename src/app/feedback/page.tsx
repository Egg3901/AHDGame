"use client";

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
import { SuggestionCard } from "@/components/suggestions/SuggestionCard";
import { SelectionBar } from "@/components/suggestions/SelectionBar";
import type { CountryId } from "@/lib/constants/countries";

interface ListItem {
  id: string;
  issueNumber: number;
  category: string;
  gameSystem: string;
  title: string;
  descriptionPreview?: string;
  impactPreview?: string | null;
  status: string;
  screenshotUrl: string | null;
  commentCount: number;
  unreadCommentCount?: number;
  reactions?: { like: number; dislike: number };
  userReaction?: "like" | "dislike" | null;
  reporterCharacterName?: string | null;
  reporterDiscordUsername?: string | null;
  reporterUsername?: string | null;
  reporterAvatarUrl?: string | null;
  reporterPartyAbbrev?: string | null;
  reporterStateCode?: string | null;
  reporterCountryId?: CountryId | null;
  createdAt: string;
  mergedInto?: string | null;
}

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
  const [categoryFilter, setCategoryFilter] = useState("");
  const [gameSystemFilter, setGameSystemFilter] = useState("");
  const [offset, setOffset] = useState(0);
  const limit = 24;

  // Selection state
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
        setError(data.error ?? "Failed to load");
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
        setError(data.error ?? "Merge failed");
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
        setError(data.error ?? "Delete failed");
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
          setError(data.error ?? "Update failed");
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
          <div className="relative h-[175px] w-full sm:h-[220px]">
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
                Share ideas and vote on what comes next. One new post per 30 minutes.
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
              <option value="recent">Recent</option>
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
        </div>

        {error && (
          <div className="rounded-lg border border-error/30 bg-error/10 px-4 py-2 text-sm text-error">
            {error}
          </div>
        )}

        {loading ? (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <li key={i}>
                <Skeleton className="h-44 rounded-xl" />
              </li>
            ))}
          </ul>
        ) : items.length === 0 ? (
          <p className="py-10 text-center text-muted">No suggestions in this view yet.</p>
        ) : (
          <>
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((item) => (
                <li key={item.id}>
                  <SuggestionCard
                    id={item.id}
                    issueNumber={item.issueNumber}
                    category={item.category}
                    gameSystem={item.gameSystem}
                    title={item.title}
                    descriptionPreview={item.descriptionPreview}
                    impactPreview={item.impactPreview}
                    status={item.status}
                    screenshotUrl={item.screenshotUrl}
                    commentCount={item.commentCount}
                    unreadCommentCount={item.unreadCommentCount}
                    reactions={item.reactions}
                    userReaction={item.userReaction}
                    reporterCharacterName={item.reporterCharacterName}
                    reporterAvatarUrl={item.reporterAvatarUrl}
                    reporterPartyAbbrev={item.reporterPartyAbbrev}
                    reporterStateCode={item.reporterStateCode}
                    reporterCountryId={item.reporterCountryId}
                    createdAt={item.createdAt}
                    mergedInto={item.mergedInto}
                    selectable={isAdmin}
                    selected={selectedIds.has(item.id)}
                    onToggleSelect={toggleSelect}
                  />
                </li>
              ))}
            </ul>

            {total > limit && (
              <div className="flex justify-center gap-2">
                <Button
                  variant="secondary"
                  disabled={offset === 0}
                  onClick={() => setOffset((o) => Math.max(0, o - limit))}
                >
                  Previous
                </Button>
                <Button
                  variant="secondary"
                  disabled={offset + limit >= total}
                  onClick={() => setOffset((o) => o + limit)}
                >
                  Next
                </Button>
              </div>
            )}
          </>
        )}

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
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <li key={i}>
                <Skeleton className="h-44 rounded-xl" />
              </li>
            ))}
          </ul>
        </div>
      }
    >
      <FeedbackBoardInner />
    </Suspense>
  );
}
