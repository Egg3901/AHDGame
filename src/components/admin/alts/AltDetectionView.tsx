"use client";

// AltDetectionView (plan §4.8, Phase 8 UI-2) — the Alt-Detection
// Moderator/Admin view. Ranked, explainable alt-ring triage: most-suspicious
// ring first → drill into the confidence breakdown / ring graph / per-pair
// evidence → act (ban / dismiss / note / mark reviewed; admin: confirm /
// tune weights / export). Self-contained; accepts the same `context` prop
// sibling Players sub-tabs receive. The coordinator wires it into a new
// "Alts" sub-tab (this file does not touch AdminTabsConfig/AdminPlayersTab).
//
// Data (frozen §4.9): GET /api/admin/alts/clusters | /cluster/[id] |
// /config. Actions reuse the existing ban/mod-note endpoints (see
// ModeratorActions). The `/api/admin/alts/*` routes authorize moderators too
// (requireModerator), so both contexts read from the same base.

import { useCallback, useEffect, useState } from "react";
import { ClusterList, type ClusterFilters } from "./ClusterList";
import { ClusterDetailView } from "./ClusterDetail";
import { DetectionHealthPanel } from "./DetectionHealthPanel";
import type { ToastKind } from "./ModeratorActions";
import type {
  AltClusterStatus,
  AltConfig,
  AltContext,
  ClusterDetail,
  ClusterListItem,
  ClustersResponse,
} from "./altTypes";

interface AltDetectionViewProps {
  /** Same prop the sibling Players sub-tabs receive. Admin unlocks the
   * progressive depth (confirm, scoring config, export, un-redacted
   * evidence); moderator is the default fast-triage flow. */
  context?: AltContext;
}

interface Toast {
  id: number;
  msg: string;
  kind: ToastKind;
}

const DEFAULT_FILTERS: ClusterFilters = {
  minConfidence: 0,
  status: "open",
  signal: "",
  hasBanned: false,
};

const PAGE_LIMIT = 25;

export default function AltDetectionView({ context = "admin" }: AltDetectionViewProps) {
  const isAdmin = context === "admin";

  const [clusters, setClusters] = useState<ClusterListItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingList, setLoadingList] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [filters, setFilters] = useState<ClusterFilters>(DEFAULT_FILTERS);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ClusterDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [config, setConfig] = useState<AltConfig | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  /** Admin-only detection-health view (calibration + pipeline telemetry).
   * Off by default — triage is the primary job; this is the "should I trust
   * these numbers, and is the detector even running" check. */
  const [showHealth, setShowHealth] = useState(false);

  const notify = useCallback((msg: string, kind: ToastKind) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);

  // ─── Clusters list ─────────────────────────────────────────────────────
  const fetchClusters = useCallback(
    async (cursorParam: string | null, append: boolean) => {
      setLoadingList(true);
      setListError(null);
      try {
        const params = new URLSearchParams();
        if (filters.minConfidence > 0) params.set("minConfidence", String(filters.minConfidence));
        if (filters.status) params.set("status", filters.status);
        if (filters.signal) params.set("signal", filters.signal);
        if (cursorParam) params.set("cursor", cursorParam);
        params.set("limit", String(PAGE_LIMIT));

        const res = await fetch(`/api/admin/alts/clusters?${params}`);
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error ?? `Request failed (${res.status})`);
        }
        const data: ClustersResponse = await res.json();
        setClusters((prev) => (append ? [...prev, ...data.clusters] : data.clusters));
        setCursor(data.nextCursor ?? null);
        setHasMore(Boolean(data.nextCursor));
      } catch (e) {
        setListError(e instanceof Error ? e.message : "Failed to load clusters");
      } finally {
        setLoadingList(false);
      }
    },
    [filters.minConfidence, filters.status, filters.signal]
  );

  useEffect(() => {
    fetchClusters(null, false);
  }, [fetchClusters]);

  // ─── Config (admin only) ───────────────────────────────────────────────
  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/alts/config");
        if (!res.ok) return;
        const data: AltConfig = await res.json();
        if (!cancelled) setConfig(data);
      } catch {
        /* config is optional depth — silent */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  // ─── Cluster detail ────────────────────────────────────────────────────
  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setLoadingDetail(true);
    setDetailError(null);
    (async () => {
      try {
        const res = await fetch(`/api/admin/alts/cluster/${selectedId}`);
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error ?? `Request failed (${res.status})`);
        }
        const data: ClusterDetail = await res.json();
        if (!cancelled) setDetail(data);
      } catch (e) {
        if (!cancelled) setDetailError(e instanceof Error ? e.message : "Failed to load cluster");
      } finally {
        if (!cancelled) setLoadingDetail(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  // ─── Mutations reflected into both detail + list ──────────────────────
  const handleStatusChange = useCallback(
    (status: AltClusterStatus) => {
      setDetail((d) => (d ? { ...d, status } : d));
      setClusters((cs) => cs.map((c) => (c.id === selectedId ? { ...c, status } : c)));
    },
    [selectedId]
  );

  const handleMemberBanned = useCallback((userId: string) => {
    setDetail((d) =>
      d
        ? {
            ...d,
            members: d.members.map((m) => (m.userId === userId ? { ...m, banned: true } : m)),
          }
        : d
    );
    setClusters((cs) =>
      cs.map((c) => ({
        ...c,
        memberPreview: c.memberPreview.map((m) =>
          m.userId === userId ? { ...m, banned: true } : m
        ),
      }))
    );
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold tracking-tight">Alt Detection</h2>
        <span className="rounded-md border border-card-border/70 bg-card-elevated/60 px-2 py-0.5 text-[11px] font-medium text-muted">
          Ranked by confidence
        </span>
        {!isAdmin && (
          <span
            className="rounded-md border border-blue-400/25 bg-blue-500/10 px-2 py-0.5 text-[11px] font-medium text-blue-400"
            title="Moderator view: scoring config, un-redacted network details, and confirm are admin-only."
          >
            Moderator view
          </span>
        )}
        {isAdmin && (
          <button
            onClick={() => setShowHealth((v) => !v)}
            aria-pressed={showHealth}
            className="ml-auto inline-flex h-8 items-center rounded-lg border border-card-border px-3 text-xs text-foreground transition-colors hover:bg-card-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 motion-reduce:transition-none"
            title="Confidence calibration against moderator dispositions, plus scoring-pipeline health."
          >
            {showHealth ? "Back to triage" : "Detection health"}
          </button>
        )}
      </div>

      {/* Staleness caveat. This view reads `altClusters`/`altLinks`, which are
          upserted every run but NEVER pruned — a pair that stops being scored
          keeps whatever confidence it last had, indefinitely. That is the
          opposite of the Users tab's duplicate groups, which drop evidence
          older than 30 days, so the two surfaces must not be read the same way.
          Remove this note when the pruning work lands. */}
      <p className="text-sm text-muted">
        Rings persist until a moderator dispositions them — there is no staleness cutoff on this
        view yet, so a cluster&apos;s evidence may be months old. Check each link&apos;s date before
        acting. (The duplicate-account groups on the Users tab work differently: those drop evidence
        older than 30 days.)
      </p>

      {isAdmin && showHealth ? (
        <DetectionHealthPanel notify={notify} />
      ) : selectedId ? (
        detailError ? (
          <div className="space-y-3">
            <button
              onClick={() => setSelectedId(null)}
              className="flex items-center gap-1.5 rounded-md text-sm text-muted transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 motion-reduce:transition-none"
            >
              <svg
                className="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                aria-hidden
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 19l-7-7 7-7"
                />
              </svg>
              Back to ranked list
            </button>
            <div className="rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-8 text-center text-sm text-red-400">
              {detailError}
              <div>
                <button
                  onClick={() => {
                    // Force a refetch by re-triggering the selection effect.
                    const id = selectedId;
                    setSelectedId(null);
                    setTimeout(() => setSelectedId(id), 0);
                  }}
                  className="mt-3 inline-flex h-9 items-center rounded-lg border border-card-border px-3 text-xs text-foreground transition-colors hover:bg-card-elevated motion-reduce:transition-none"
                >
                  Retry
                </button>
              </div>
            </div>
          </div>
        ) : detail ? (
          <ClusterDetailView
            detail={detail}
            config={config}
            context={context}
            loading={loadingDetail}
            onBack={() => setSelectedId(null)}
            onStatusChange={handleStatusChange}
            onMemberBanned={handleMemberBanned}
            onConfigSaved={setConfig}
            notify={notify}
          />
        ) : (
          <div className="space-y-4" aria-hidden>
            <div className="flex animate-pulse items-center gap-6 rounded-xl border border-card-border bg-card p-5 motion-reduce:animate-none">
              <div className="h-[136px] w-[136px] flex-shrink-0 rounded-full bg-card-elevated" />
              <div className="flex-1 space-y-3">
                <div className="h-3 w-24 rounded bg-card-elevated/80" />
                <div className="h-5 w-40 rounded bg-card-elevated" />
                <div className="h-3 w-2/3 rounded bg-card-elevated/60" />
              </div>
            </div>
            <div className="h-64 animate-pulse rounded-xl border border-card-border bg-card motion-reduce:animate-none" />
          </div>
        )
      ) : (
        <ClusterList
          clusters={clusters}
          filters={filters}
          onFiltersChange={setFilters}
          loading={loadingList}
          error={listError}
          hasMore={hasMore}
          onLoadMore={() => fetchClusters(cursor, true)}
          onSelect={setSelectedId}
          selectedId={selectedId}
          onRefresh={() => fetchClusters(null, false)}
        />
      )}

      {/* Toasts */}
      {toasts.length > 0 && (
        <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2">
          {toasts.map((t) => (
            <div
              key={t.id}
              className={`animate-fade-in rounded-lg border px-4 py-2.5 text-sm shadow-modal backdrop-blur-sm motion-reduce:animate-none ${
                t.kind === "success"
                  ? "border-green-500/40 bg-green-500/15 text-green-300"
                  : t.kind === "error"
                    ? "border-red-500/40 bg-red-500/15 text-red-300"
                    : "border-card-border bg-card text-foreground"
              }`}
              role="status"
            >
              {t.msg}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
