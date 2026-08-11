"use client";

// Forensic / Audit-Log Explorer (UI-1). Self-contained: the coordinator renders
// this inside the admin Players → "Forensics" sub-tab. It reads the frozen
// /api/admin/audit contract (§4.9) and lets a moderator go from a player name to
// their recent high-value actions in ≤2 interactions, follow any action to its
// full causal trace, see what changed without reading raw JSON, and pivot to
// related records / the Alts view without re-typing filters.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AuditFilters } from "./AuditFilters";
import { AuditTable } from "./AuditTable";
import { RecordDetail } from "./RecordDetail";
import { TraceTimeline } from "./TraceTimeline";
import {
  type ActionAuditRecord,
  type AuditFilterState,
  type AuditQueryResponse,
  EMPTY_FILTERS,
} from "./types";

interface AuditExplorerProps {
  /** Mirrors sibling admin sub-tabs; drives role-scoped affordances. */
  context?: "admin" | "moderator";
  /** Route-pivot into the separately-built Alts view for an actor. */
  onPivotToAlts?: (userId: string) => void;
  /** Route-pivot into a linked domain log (financial tx, ledger, bill, …). */
  onRefPivot?: (refKey: string, refId: string) => void;
}

const PAGE_LIMIT = 50;
const URL_PREFIX = "au_";

const FILTER_KEYS: (keyof AuditFilterState)[] = [
  "actorUserId",
  "actorCharacterId",
  "actorLabel",
  "subjectType",
  "subjectId",
  "action",
  "category",
  "turnFrom",
  "turnTo",
  "tsFrom",
  "tsTo",
  "outcome",
  "flag",
];

/** Build the query string sent to /api/admin/audit from the filter state. */
function buildApiParams(filters: AuditFilterState, cursor: string | null): URLSearchParams {
  const p = new URLSearchParams();
  const put = (k: string, v: string) => {
    if (v) p.set(k, v);
  };
  put("actorUserId", filters.actorUserId);
  put("actorCharacterId", filters.actorCharacterId);
  put("subjectType", filters.subjectType);
  put("subjectId", filters.subjectId);
  put("action", filters.action);
  put("category", filters.category);
  put("turnFrom", filters.turnFrom);
  put("turnTo", filters.turnTo);
  put("tsFrom", filters.tsFrom);
  put("tsTo", filters.tsTo);
  put("outcome", filters.outcome);
  put("flag", filters.flag);
  if (filters.flaggedOnly) p.set("flaggedOnly", "true");
  p.set("limit", String(PAGE_LIMIT));
  if (cursor) p.set("cursor", cursor);
  return p;
}

/** Read persisted filters from the URL (scoped keys) on first mount. */
function readFiltersFromUrl(): AuditFilterState {
  if (typeof window === "undefined") return EMPTY_FILTERS;
  const sp = new URLSearchParams(window.location.search);
  const next: AuditFilterState = { ...EMPTY_FILTERS };
  for (const k of FILTER_KEYS) {
    const v = sp.get(URL_PREFIX + k);
    if (v != null) (next[k] as string) = v;
  }
  if (sp.get(URL_PREFIX + "flaggedOnly") === "true") next.flaggedOnly = true;
  return next;
}

/** Reflect the current filters into the URL without a navigation. */
function writeFiltersToUrl(filters: AuditFilterState) {
  if (typeof window === "undefined") return;
  const sp = new URLSearchParams(window.location.search);
  for (const k of FILTER_KEYS) sp.delete(URL_PREFIX + k);
  sp.delete(URL_PREFIX + "flaggedOnly");
  for (const k of FILTER_KEYS) {
    const v = filters[k] as string;
    if (v) sp.set(URL_PREFIX + k, v);
  }
  if (filters.flaggedOnly) sp.set(URL_PREFIX + "flaggedOnly", "true");
  const qs = sp.toString();
  const url = `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`;
  window.history.replaceState(null, "", url);
}

export default function AuditExplorer({
  context = "admin",
  onPivotToAlts,
  onRefPivot,
}: AuditExplorerProps) {
  const apiBase = context === "moderator" ? "/api/moderator" : "/api/admin";
  const isAdmin = context === "admin";

  const [filters, setFilters] = useState<AuditFilterState>(EMPTY_FILTERS);
  const [rows, setRows] = useState<ActionAuditRecord[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [selected, setSelected] = useState<ActionAuditRecord | null>(null);
  const [trace, setTrace] = useState<{ traceId: string; focusRecordId?: string } | null>(null);

  const reqId = useRef(0);
  const cursorRef = useRef<string | null>(null);
  const loadingRef = useRef(false);

  // Hydrate filters from the URL once.
  useEffect(() => {
    setFilters(readFiltersFromUrl());
  }, []);

  const runQuery = useCallback(
    async (append: boolean) => {
      const myReq = ++reqId.current;
      loadingRef.current = true;
      setLoading(true);
      setError("");
      try {
        const params = buildApiParams(filters, append ? cursorRef.current : null);
        const res = await fetch(`${apiBase}/audit?${params}`);
        if (!res.ok) throw new Error(`Request failed: ${res.status}`);
        const data: AuditQueryResponse = await res.json();
        if (myReq !== reqId.current) return; // superseded
        const next = data.nextCursor ?? null;
        cursorRef.current = next;
        setCursor(next);
        setHasMore(Boolean(next));
        setTruncated(Boolean(data.truncated));
        setRows((prev) => (append ? [...prev, ...data.rows] : data.rows));
      } catch (e) {
        if (myReq === reqId.current) {
          setError(e instanceof Error ? e.message : "Failed to load audit records");
        }
      } finally {
        if (myReq === reqId.current) {
          loadingRef.current = false;
          setLoading(false);
        }
      }
    },
    [apiBase, filters]
  );

  // Debounced reset-fetch whenever filters change; also mirror to the URL.
  useEffect(() => {
    writeFiltersToUrl(filters);
    const t = setTimeout(() => {
      cursorRef.current = null;
      runQuery(false);
    }, 300);
    return () => clearTimeout(t);
  }, [filters, runQuery]);

  const loadMore = useCallback(() => {
    if (loadingRef.current || !cursorRef.current) return;
    runQuery(true);
  }, [runQuery]);

  const knownFlags = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) for (const f of r.flags ?? []) s.add(f);
    return Array.from(s);
  }, [rows]);

  // ---- Pivots -------------------------------------------------------------
  const openRecord = (r: ActionAuditRecord) => {
    setSelected(r);
    setTrace(null);
  };

  const followTrace = (traceId: string, focusRecordId?: string) => {
    setTrace({ traceId, focusRecordId });
    setSelected(null);
  };

  const pivotActor = (r: ActionAuditRecord) => {
    setSelected(null);
    setTrace(null);
    setFilters({
      ...EMPTY_FILTERS,
      actorUserId: r.actor.userId ?? "",
      actorCharacterId: r.actor.userId ? "" : (r.actor.characterId ?? ""),
      actorLabel: r.actor.name ?? "",
    });
  };

  const pivotSubject = (r: ActionAuditRecord) => {
    setSelected(null);
    setTrace(null);
    setFilters({
      ...EMPTY_FILTERS,
      subjectType: r.subject.type ?? "",
      subjectId: r.subject.id ? String(r.subject.id) : "",
    });
  };

  const pivotCounterparty = (r: ActionAuditRecord) => {
    if (!r.counterparty) return;
    setSelected(null);
    setTrace(null);
    setFilters({
      ...EMPTY_FILTERS,
      subjectType: r.counterparty.type ?? "",
      subjectId: r.counterparty.id ? String(r.counterparty.id) : "",
    });
  };

  const pivotToAlts = (userId: string) => {
    if (onPivotToAlts) {
      onPivotToAlts(userId);
    } else if (typeof window !== "undefined") {
      window.location.assign(`?tab=players&sub=alts&focusUser=${encodeURIComponent(userId)}`);
    }
  };

  const handleRefPivot = (refKey: string, refId: string) => {
    if (onRefPivot) onRefPivot(refKey, refId);
  };

  const exportHref = useMemo(() => {
    const params = buildApiParams(filters, null);
    params.delete("limit");
    return `${apiBase}/audit/export?${params}`;
  }, [apiBase, filters]);

  // ---- Trace view ---------------------------------------------------------
  if (trace) {
    return (
      <div className="flex flex-col gap-4 lg:flex-row">
        <div className="min-w-0 flex-1">
          <TraceTimeline
            traceId={trace.traceId}
            apiBase={apiBase}
            focusRecordId={trace.focusRecordId}
            onBack={() => setTrace(null)}
            onSelectRecord={(r) => {
              setSelected(r);
            }}
          />
        </div>
        {selected && (
          <RecordDetailPanel>
            <RecordDetail
              recordId={selected._id}
              apiBase={apiBase}
              isAdmin={isAdmin}
              initialRecord={selected}
              onClose={() => setSelected(null)}
              onFollowTrace={(tid) => followTrace(tid, selected._id)}
              onSelectRecord={(r) => setSelected(r)}
              onPivotActor={pivotActor}
              onPivotSubject={pivotSubject}
              onPivotCounterparty={pivotCounterparty}
              onPivotToAlts={pivotToAlts}
              onRefPivot={handleRefPivot}
            />
          </RecordDetailPanel>
        )}
      </div>
    );
  }

  // ---- List view ----------------------------------------------------------
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Forensic Explorer</h2>
          <p className="mt-0.5 text-xs text-muted">
            Search the unified action-audit spine — follow any action to its full trace.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              cursorRef.current = null;
              runQuery(false);
            }}
            disabled={loading}
            className="inline-flex h-9 items-center rounded-lg border border-card-border px-3 text-sm transition-colors hover:bg-card-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 disabled:opacity-50 motion-reduce:transition-none"
          >
            Refresh
          </button>
          {isAdmin && (
            <a
              href={exportHref}
              className="inline-flex h-9 items-center rounded-lg border border-card-border px-3 text-sm transition-colors hover:bg-card-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 motion-reduce:transition-none"
            >
              Export
            </a>
          )}
        </div>
      </div>

      {!isAdmin && (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-300/90">
          Moderator view — privileged (admin-category) rows, raw metadata/network details, and
          export are hidden.
        </div>
      )}

      <AuditFilters
        filters={filters}
        onChange={setFilters}
        onReset={() => setFilters(EMPTY_FILTERS)}
        apiBase={apiBase}
        knownFlags={knownFlags}
      />

      {truncated && (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-300/90">
          Showing a capped result set — narrow your filters (actor, category, or time range) to see
          everything.
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2.5 text-sm text-red-400">
          <p>{error}</p>
          <button
            onClick={() => {
              cursorRef.current = null;
              runQuery(false);
            }}
            className="mt-1.5 rounded text-xs underline underline-offset-2 transition-colors hover:text-red-300 motion-reduce:transition-none"
          >
            Retry
          </button>
        </div>
      )}

      <div className="flex flex-col gap-4 lg:flex-row">
        <div className="min-w-0 flex-1 space-y-3">
          <AuditTable
            rows={rows}
            loading={loading}
            hasMore={hasMore}
            selectedId={selected?._id}
            activeFlag={filters.flag}
            onSelect={openRecord}
            onFollowTrace={(tid) => followTrace(tid)}
            onFlagSelect={(flag) =>
              setFilters((f) => ({ ...f, flag: f.flag === flag ? "" : flag }))
            }
            onLoadMore={loadMore}
          />

          {!loading && rows.length === 0 && !error && (
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
                  d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
                />
              </svg>
              <p className="text-sm font-medium">No matching actions</p>
              <p className="mt-1 text-xs text-muted">
                Loosen or clear the filters to widen the net.
              </p>
              <button
                type="button"
                onClick={() => setFilters(EMPTY_FILTERS)}
                className="mt-3 rounded text-xs text-primary underline underline-offset-2 transition-colors hover:text-primary-dark motion-reduce:transition-none"
              >
                Reset filters
              </button>
            </div>
          )}
        </div>

        {selected && (
          <RecordDetailPanel>
            <RecordDetail
              recordId={selected._id}
              apiBase={apiBase}
              isAdmin={isAdmin}
              initialRecord={selected}
              onClose={() => setSelected(null)}
              onFollowTrace={(tid) => followTrace(tid, selected._id)}
              onSelectRecord={(r) => setSelected(r)}
              onPivotActor={pivotActor}
              onPivotSubject={pivotSubject}
              onPivotCounterparty={pivotCounterparty}
              onPivotToAlts={pivotToAlts}
              onRefPivot={handleRefPivot}
            />
          </RecordDetailPanel>
        )}
      </div>
    </div>
  );
}

/**
 * Responsive shell for the record inspector: a right-hand column on large
 * screens, a slide-over sheet on small screens.
 */
function RecordDetailPanel({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-y-0 right-0 z-50 w-full max-w-md border-l border-card-border bg-background shadow-modal lg:static lg:z-auto lg:w-[26rem] lg:max-w-none lg:rounded-xl lg:border lg:shadow-card">
      {children}
    </div>
  );
}
