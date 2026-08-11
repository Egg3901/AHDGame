"use client";

import React, { useState, useEffect, useCallback } from "react";
import { ALL_TX_TYPES, TX_TYPE_LABELS } from "@/lib/financialTxLog/types-extended";
import type { FinancialTxType } from "@/lib/db/types/financialTxLog";

// ─── Types ───────────────────────────────────────────────────────────────────

interface SuspectFlag {
  type: string;
  severity: "low" | "medium" | "high";
  detail: string;
  detectedAt: string;
  dismissed?: boolean;
}

interface TxEntry {
  _id: string;
  type: string;
  turn: number;
  createdAt: string;
  subjectType: string;
  subjectId?: string;
  countryId?: string;
  subjectName: string;
  amount: number;
  currencyCode: string;
  balanceAfter?: number;
  counterpartyType?: string;
  counterpartyName?: string;
  meta?: Record<string, unknown>;
  suspectFlags?: SuspectFlag[];
  flagged: boolean;
  // Phase 4: deletion-tracking fields. Set when the subject / counterparty
  // entity has been retired / dissolved / deleted; subjectName remains
  // captured at emit time so the row stays renderable.
  subjectDeletedAt?: string;
  subjectSequentialId?: number;
  counterpartyDeletedAt?: string;
  counterpartySequentialId?: number;
}

interface AlertGroup {
  entityKey: string;
  subjectType: string;
  subjectId?: string;
  countryId?: string;
  subjectName: string;
  flagCount: number;
  highestSeverity: "low" | "medium" | "high";
  mostRecentAt: string;
  sampleDocIds: string[];
  flagTypes: string[];
}

// ─── Constants ───────────────────────────────────────────────────────────────

// Pre-Phase-5 this was a hardcoded 24-item array that drifted out of sync with
// the FinancialTxType union the moment Phase 2 expanded the domain to 51 types.
// Source of truth now lives in `types-extended.ts`; this file just re-exports.
const TX_TYPES: readonly FinancialTxType[] = ALL_TX_TYPES;

const SEVERITY_COLOR: Record<string, string> = {
  high: "text-red-400",
  medium: "text-amber-400",
  low: "text-blue-400",
};
const SEVERITY_BG: Record<string, string> = {
  high: "bg-red-500/10 border-red-500/20",
  medium: "bg-amber-500/10 border-amber-500/20",
  low: "bg-blue-500/10 border-blue-500/20",
};
const SEVERITY_DOT: Record<string, string> = {
  high: "bg-red-500",
  medium: "bg-amber-500",
  low: "bg-blue-500",
};

const FLAG_TYPE_LABEL: Record<string, string> = {
  large_transaction: "Large Transaction",
  velocity: "Velocity (pair)",
  round_trip: "Round Trip",
  admin_transfer: "Admin Transfer",
  wash_trade: "Wash Trade",
  // Phase 6 finer-grained detectors. The dashboard sorts by severity so
  // "high"-severity time-velocity / cash-mismatch float to the top of the
  // alerts list immediately.
  time_velocity: "Velocity (rapid-fire)",
  same_price_wash: "Same-Price Wash",
  cash_mismatch: "Cash Mismatch",
};

const INPUT_CLS =
  "min-h-[36px] rounded border border-card-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary";

function fmtAmount(amount: number, currency: string) {
  const sign = amount >= 0 ? "+" : "";
  return `${sign}${amount.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ${currency}`;
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getSuspectFlags(value: TxEntry["suspectFlags"] | unknown): SuspectFlag[] {
  return Array.isArray(value) ? value : [];
}

// ─── Timeline sub-component ───────────────────────────────────────────────────

interface TimelineFilters {
  subjectType: string;
  subjectName: string;
  type: string;
  flaggedOnly: boolean;
  turnMin: string;
  turnMax: string;
}

type FinancialLedgerApiBase = "/api/admin/financial-logs" | "/api/moderator/financial-logs";

interface TimelineProps {
  apiBase: FinancialLedgerApiBase;
  prefilterSubjectId?: string;
  prefilterSubjectName?: string;
}

// Phase 5: turn-window presets surface the 168-turn retention window default
// so admins don't have to manually compute "now − 168" each time. The values
// are turn counts; the dropdown's label flips them into IRL durations at the
// default 60-min cadence.
const WINDOW_PRESETS: { label: string; turns: number }[] = [
  { label: "Last 24 turns (~24h)", turns: 24 },
  { label: "Last 72 turns (~3d)", turns: 72 },
  { label: "Last 168 turns (~7d)", turns: 168 },
  { label: "All available", turns: 0 },
];

function TransactionTimeline({ apiBase, prefilterSubjectId, prefilterSubjectName }: TimelineProps) {
  const [filters, setFilters] = useState<TimelineFilters>({
    subjectType: "",
    subjectName: prefilterSubjectName ?? "",
    type: "",
    flaggedOnly: false,
    turnMin: "",
    turnMax: "",
  });
  // Default window: 168 turns. Resolved against current turn at apply time.
  // The /financial-logs endpoint embeds currentTurn in its response so we
  // never need a separate fetch — see route.ts. Initial value is null until
  // the first list-fetch returns.
  const [windowTurns, setWindowTurns] = useState<number>(168);
  const [currentTurn, setCurrentTurn] = useState<number | null>(null);
  const [entries, setEntries] = useState<TxEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [dismissing, setDismissing] = useState<string | null>(null);

  const buildUrl = useCallback(
    (cursor?: string) => {
      const params = new URLSearchParams();
      if (prefilterSubjectId) params.set("subjectId", prefilterSubjectId);
      if (filters.subjectType) params.set("subjectType", filters.subjectType);
      if (filters.subjectName.trim()) params.set("subjectName", filters.subjectName.trim());
      if (filters.type) params.set("types", filters.type);
      if (filters.flaggedOnly) params.set("flagged", "true");
      // Window preset overrides explicit turnMin when both are set, since the
      // preset is a UX shortcut; explicit turnMax still composes.
      const effectiveTurnMin =
        filters.turnMin ||
        (windowTurns > 0 && currentTurn !== null
          ? String(Math.max(0, currentTurn - windowTurns))
          : "");
      if (effectiveTurnMin) params.set("turnMin", effectiveTurnMin);
      if (filters.turnMax) params.set("turnMax", filters.turnMax);
      if (cursor) params.set("cursor", cursor);
      return `${apiBase}?${params.toString()}`;
    },
    [apiBase, prefilterSubjectId, filters, windowTurns, currentTurn]
  );

  const load = useCallback(
    async (cursor?: string) => {
      setLoading(true);
      try {
        const res = await fetch(buildUrl(cursor));
        if (!res.ok) return;
        const data = await res.json();
        if (cursor) {
          setEntries((prev) => [...prev, ...data.entries]);
        } else {
          setEntries(data.entries);
        }
        setNextCursor(data.nextCursor);
        setHasMore(data.hasMore);
        // currentTurn is embedded in the response (Phase 5) so the window
        // preset dropdown can resolve "Last 168 turns" → turnMin without an
        // extra fetch. We only set it once — turn ticks during a session
        // are fine to ignore for filter purposes.
        if (typeof data.currentTurn === "number" && currentTurn === null) {
          setCurrentTurn(data.currentTurn);
        }
      } finally {
        setLoading(false);
      }
    },
    [buildUrl, currentTurn]
  );

  useEffect(() => {
    load();
  }, [load]);

  const dismissFlag = async (entryId: string, flagIndex: number, dismissed: boolean) => {
    const key = `${entryId}:${flagIndex}`;
    setDismissing(key);
    try {
      const res = await fetch(`${apiBase}/${entryId}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flagIndex, dismissed }),
      });
      if (!res.ok) return;
      setEntries((prev) =>
        prev.map((e) => {
          if (e._id !== entryId) return e;
          const newFlags = getSuspectFlags(e.suspectFlags).map((f, i) =>
            i === flagIndex ? { ...f, dismissed } : f
          );
          return { ...e, suspectFlags: newFlags, flagged: newFlags.some((f) => !f.dismissed) };
        })
      );
    } finally {
      setDismissing(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <select
          className={INPUT_CLS}
          value={filters.subjectType}
          onChange={(e) => setFilters((f) => ({ ...f, subjectType: e.target.value }))}
        >
          <option value="">All entity types</option>
          <option value="character">Character</option>
          <option value="corporation">Corporation</option>
          <option value="party">Party</option>
          <option value="government">Government</option>
        </select>

        {!prefilterSubjectId && (
          <input
            className={INPUT_CLS}
            placeholder="Entity name…"
            value={filters.subjectName}
            onChange={(e) => setFilters((f) => ({ ...f, subjectName: e.target.value }))}
          />
        )}

        <select
          className={INPUT_CLS}
          value={filters.type}
          onChange={(e) => setFilters((f) => ({ ...f, type: e.target.value }))}
        >
          <option value="">All types</option>
          {TX_TYPES.map((t) => (
            <option key={t} value={t}>
              {TX_TYPE_LABELS[t] ?? t.replace(/_/g, " ")}
            </option>
          ))}
        </select>

        <select
          className={INPUT_CLS}
          value={String(windowTurns)}
          onChange={(e) => setWindowTurns(parseInt(e.target.value, 10))}
          title="Quick window — overrides Turn ≥ when set"
        >
          {WINDOW_PRESETS.map((p) => (
            <option key={p.label} value={p.turns}>
              {p.label}
            </option>
          ))}
        </select>
        <input
          className={`${INPUT_CLS} w-24`}
          placeholder="Turn ≥"
          value={filters.turnMin}
          onChange={(e) => setFilters((f) => ({ ...f, turnMin: e.target.value }))}
          title="Explicit turnMin overrides the window preset"
        />
        <input
          className={`${INPUT_CLS} w-24`}
          placeholder="Turn ≤"
          value={filters.turnMax}
          onChange={(e) => setFilters((f) => ({ ...f, turnMax: e.target.value }))}
        />

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={filters.flaggedOnly}
            onChange={(e) => setFilters((f) => ({ ...f, flaggedOnly: e.target.checked }))}
            className="h-4 w-4"
          />
          Flagged only
        </label>

        <button
          onClick={() => load()}
          disabled={loading}
          className="min-h-[36px] rounded border border-primary bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary hover:bg-primary/20 disabled:opacity-50"
        >
          {loading ? "Loading…" : "Apply"}
        </button>

        {apiBase === "/api/admin/financial-logs" && (
          <a
            href={`${apiBase}/export?${(() => {
              const p = new URLSearchParams();
              if (prefilterSubjectId) p.set("subjectId", prefilterSubjectId);
              if (filters.subjectType) p.set("subjectType", filters.subjectType);
              if (filters.subjectName.trim()) p.set("subjectName", filters.subjectName.trim());
              if (filters.type) p.set("types", filters.type);
              if (filters.flaggedOnly) p.set("flagged", "true");
              const effMin =
                filters.turnMin ||
                (windowTurns > 0 && currentTurn !== null
                  ? String(Math.max(0, currentTurn - windowTurns))
                  : "");
              if (effMin) p.set("turnMin", effMin);
              if (filters.turnMax) p.set("turnMax", filters.turnMax);
              return p.toString();
            })()}`}
            className="min-h-[36px] inline-flex items-center rounded border border-card-border bg-card px-3 py-1.5 text-sm font-medium text-foreground hover:bg-card/60"
            title="Export current filter as CSV (max 50,000 rows)"
          >
            Export CSV
          </a>
        )}
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded border border-card-border">
        <table className="w-full text-sm">
          <thead className="bg-card">
            <tr className="text-left text-xs font-medium text-muted">
              <th className="px-3 py-2">Turn</th>
              <th className="px-3 py-2">Time</th>
              <th className="px-3 py-2">Subject</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2 text-right">Amount</th>
              <th className="px-3 py-2">Currency</th>
              <th className="px-3 py-2">Counterparty</th>
              <th className="px-3 py-2">Flags</th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 && !loading && (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-muted">
                  No transactions found
                </td>
              </tr>
            )}
            {entries.map((entry) => {
              const isExpanded = expandedId === entry._id;
              const activeFlags = getSuspectFlags(entry.suspectFlags).filter((f) => !f.dismissed);
              return (
                <React.Fragment key={entry._id}>
                  <tr
                    onClick={() => setExpandedId(isExpanded ? null : entry._id)}
                    className={`cursor-pointer border-t border-card-border transition-colors hover:bg-card/60 ${
                      entry.flagged ? "border-l-2 border-l-red-500" : ""
                    }`}
                  >
                    <td className="px-3 py-2 font-mono text-xs">{entry.turn}</td>
                    <td className="px-3 py-2 text-xs text-muted whitespace-nowrap">
                      {fmtTime(entry.createdAt)}
                    </td>
                    <td className="px-3 py-2">
                      <div
                        className={`font-medium ${
                          entry.subjectDeletedAt ? "text-muted line-through" : ""
                        }`}
                        title={
                          entry.subjectDeletedAt
                            ? `Deleted ${fmtTime(entry.subjectDeletedAt)}`
                            : undefined
                        }
                      >
                        {entry.subjectName}
                        {entry.subjectDeletedAt && (
                          <span className="ml-1 rounded bg-muted/20 px-1 py-0.5 text-[10px] font-semibold uppercase text-muted">
                            deleted
                          </span>
                        )}
                        {entry.subjectSequentialId !== undefined && (
                          <span className="ml-1 text-[10px] text-muted">
                            #{entry.subjectSequentialId}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted">{entry.subjectType}</div>
                    </td>
                    <td
                      className="px-3 py-2 font-mono text-xs"
                      title={TX_TYPE_LABELS[entry.type as FinancialTxType] ?? entry.type}
                    >
                      {TX_TYPE_LABELS[entry.type as FinancialTxType] ?? entry.type}
                    </td>
                    <td
                      className={`px-3 py-2 text-right font-mono text-xs ${
                        entry.amount >= 0 ? "text-green-400" : "text-red-400"
                      }`}
                    >
                      {fmtAmount(entry.amount, "")}
                    </td>
                    <td className="px-3 py-2 text-xs">{entry.currencyCode}</td>
                    <td className="px-3 py-2 text-xs text-muted">
                      <span
                        className={entry.counterpartyDeletedAt ? "line-through" : ""}
                        title={
                          entry.counterpartyDeletedAt
                            ? `Deleted ${fmtTime(entry.counterpartyDeletedAt)}`
                            : undefined
                        }
                      >
                        {entry.counterpartyName ?? "—"}
                      </span>
                      {entry.counterpartyDeletedAt && (
                        <span className="ml-1 rounded bg-muted/20 px-1 py-0.5 text-[10px] font-semibold uppercase text-muted">
                          deleted
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {activeFlags.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {activeFlags.map((f, i) => (
                            <span
                              key={i}
                              className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${SEVERITY_COLOR[f.severity]}`}
                            >
                              {f.type}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs text-muted">—</span>
                      )}
                    </td>
                  </tr>

                  {/* Expanded detail drawer */}
                  {isExpanded && (
                    <tr className="bg-card/40">
                      <td colSpan={8} className="px-4 py-4">
                        <div className="grid gap-4 md:grid-cols-2">
                          {/* Meta */}
                          {entry.meta && Object.keys(entry.meta).length > 0 && (
                            <div>
                              <div className="mb-1 text-xs font-semibold text-muted uppercase tracking-wider">
                                Meta
                              </div>
                              <dl className="space-y-0.5">
                                {Object.entries(entry.meta).map(([k, v]) => (
                                  <div key={k} className="flex gap-2 text-xs">
                                    <dt className="text-muted min-w-[120px]">{k}</dt>
                                    <dd className="font-mono text-foreground break-all">
                                      {String(v)}
                                    </dd>
                                  </div>
                                ))}
                              </dl>
                            </div>
                          )}

                          {/* Flags */}
                          {getSuspectFlags(entry.suspectFlags).length > 0 && (
                            <div>
                              <div className="mb-1 text-xs font-semibold text-muted uppercase tracking-wider">
                                Suspect Flags
                              </div>
                              <div className="space-y-2">
                                {getSuspectFlags(entry.suspectFlags).map((flag, idx) => (
                                  <div
                                    key={idx}
                                    className={`flex items-start justify-between gap-2 rounded border p-2 ${
                                      flag.dismissed
                                        ? "border-card-border opacity-50"
                                        : SEVERITY_BG[flag.severity]
                                    }`}
                                  >
                                    <div className="space-y-0.5">
                                      <div className="flex items-center gap-1.5">
                                        <span
                                          className={`h-1.5 w-1.5 rounded-full ${
                                            flag.dismissed
                                              ? "bg-muted"
                                              : SEVERITY_DOT[flag.severity]
                                          }`}
                                        />
                                        <span className="text-xs font-semibold">
                                          {flag.type}
                                          {flag.dismissed && (
                                            <span className="ml-1 text-muted">(dismissed)</span>
                                          )}
                                        </span>
                                      </div>
                                      <p className="text-xs text-muted">{flag.detail}</p>
                                    </div>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        dismissFlag(entry._id, idx, !flag.dismissed);
                                      }}
                                      disabled={dismissing === `${entry._id}:${idx}`}
                                      className="shrink-0 rounded border border-card-border bg-background px-2 py-1 text-xs hover:bg-card disabled:opacity-50"
                                    >
                                      {flag.dismissed ? "Un-dismiss" : "Dismiss"}
                                    </button>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {entry.balanceAfter !== undefined && (
                            <div className="text-xs">
                              <span className="text-muted">Balance after: </span>
                              <span className="font-mono">
                                {entry.balanceAfter.toLocaleString("en-US", {
                                  minimumFractionDigits: 2,
                                })}{" "}
                                {entry.currencyCode}
                              </span>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {hasMore && (
        <button
          onClick={() => load(nextCursor ?? undefined)}
          disabled={loading}
          className="w-full rounded border border-card-border py-2 text-sm text-muted hover:bg-card disabled:opacity-50"
        >
          {loading ? "Loading…" : "Load more"}
        </button>
      )}
    </div>
  );
}

// ─── Alerts sub-component ─────────────────────────────────────────────────────

interface AlertsProps {
  apiBase: FinancialLedgerApiBase;
  onDrillIn: (subjectId: string | undefined, subjectName: string) => void;
}

// Phase 5: reconcile-result shape returned by /api/admin/financial-logs/reconcile.
interface ReconcileResult {
  reconcilable: boolean;
  windowTurnsActual?: number;
  loggedNetAnchor: number;
  actualCashDeltaAnchor?: number;
  unaccountedAnchor?: number;
  txCount?: number;
  perType?: { type: string; count: number; netAnchor: number }[];
  message?: string;
}

function SuspectAlerts({ apiBase, onDrillIn }: AlertsProps) {
  const [alerts, setAlerts] = useState<AlertGroup[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  // Per-entity reconcile state. Phase 5 lets admins click "Reconcile" on any
  // alert and see the same logged-net-vs-actual delta we computed by hand
  // when surfacing the bond-buy bug.
  const [reconciling, setReconciling] = useState<string | null>(null);
  const [reconcileResults, setReconcileResults] = useState<Record<string, ReconcileResult>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/alerts`);
      if (!res.ok) return;
      const data = await res.json();
      setAlerts(data.alerts);
      setTotal(data.total);
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  const runReconcile = useCallback(async (group: AlertGroup) => {
    // Reconcile only meaningful for character/corporation subjects (those
    // are the ones with portfolioHistory snapshots). Skip parties/govt.
    if (
      !group.subjectId ||
      (group.subjectType !== "character" && group.subjectType !== "corporation")
    ) {
      return;
    }
    setReconciling(group.entityKey);
    try {
      const params = new URLSearchParams({
        subjectId: group.subjectId,
        subjectType: group.subjectType,
        turns: "168",
      });
      const res = await fetch(`/api/admin/financial-logs/reconcile?${params.toString()}`);
      if (!res.ok) return;
      const data: ReconcileResult = await res.json();
      setReconcileResults((prev) => ({ ...prev, [group.entityKey]: data }));
    } finally {
      setReconciling(null);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (alerts.length === 0) {
    return <div className="py-12 text-center text-muted">No active suspect alerts</div>;
  }

  return (
    <div className="space-y-4">
      <div className="text-sm text-muted">
        {total} entity group{total !== 1 ? "s" : ""} with active flags
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {alerts.map((group) => {
          const reconciled = reconcileResults[group.entityKey];
          const canReconcile =
            !!group.subjectId &&
            (group.subjectType === "character" || group.subjectType === "corporation");
          return (
            <div
              key={group.entityKey}
              className={`flex flex-col gap-2 rounded border p-3 text-left ${SEVERITY_BG[group.highestSeverity]}`}
            >
              <button
                onClick={() => onDrillIn(group.subjectId, group.subjectName)}
                className="flex items-start justify-between gap-2 text-left"
              >
                <div>
                  <div className="font-medium text-sm">{group.subjectName}</div>
                  <div className="text-xs text-muted capitalize">{group.subjectType}</div>
                </div>
                <div className="flex items-center gap-1">
                  <span className={`h-2 w-2 rounded-full ${SEVERITY_DOT[group.highestSeverity]}`} />
                  <span
                    className={`text-xs font-semibold ${SEVERITY_COLOR[group.highestSeverity]}`}
                  >
                    {group.highestSeverity}
                  </span>
                </div>
              </button>
              <div className="flex flex-wrap gap-1">
                {group.flagTypes.map((ft) => (
                  <span
                    key={ft}
                    className="rounded bg-card-border px-1.5 py-0.5 text-[10px] font-medium text-muted"
                  >
                    {FLAG_TYPE_LABEL[ft] ?? ft}
                  </span>
                ))}
              </div>
              <div className="flex items-center justify-between text-xs text-muted">
                <span>
                  {group.flagCount} active flag{group.flagCount !== 1 ? "s" : ""}
                </span>
                <span>
                  {new Date(group.mostRecentAt).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })}
                </span>
              </div>
              {canReconcile && (
                <div className="flex items-center justify-between gap-2 border-t border-card-border pt-2">
                  <button
                    onClick={() => runReconcile(group)}
                    disabled={reconciling === group.entityKey}
                    className="rounded border border-card-border bg-background px-2 py-1 text-[11px] font-medium hover:bg-card disabled:opacity-50"
                  >
                    {reconciling === group.entityKey
                      ? "Reconciling…"
                      : reconciled
                        ? "Re-run reconcile"
                        : "Reconcile"}
                  </button>
                  <button
                    onClick={() => onDrillIn(group.subjectId, group.subjectName)}
                    className="rounded border border-card-border bg-background px-2 py-1 text-[11px] font-medium hover:bg-card"
                  >
                    Open timeline →
                  </button>
                </div>
              )}
              {reconciled && (
                <div className="rounded border border-card-border bg-background/50 p-2 text-[11px]">
                  {reconciled.reconcilable ? (
                    <>
                      <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
                        <span className="text-muted">Window:</span>
                        <span>{reconciled.windowTurnsActual} turns</span>
                        <span className="text-muted">Tx logged:</span>
                        <span>{reconciled.txCount}</span>
                        <span className="text-muted">Logged net (₳):</span>
                        <span className="font-mono">
                          {reconciled.loggedNetAnchor.toLocaleString("en-US", {
                            maximumFractionDigits: 0,
                          })}
                        </span>
                        <span className="text-muted">Actual cash Δ (₳):</span>
                        <span className="font-mono">
                          {reconciled.actualCashDeltaAnchor?.toLocaleString("en-US", {
                            maximumFractionDigits: 0,
                          })}
                        </span>
                        <span className="text-muted font-semibold">Unaccounted:</span>
                        <span
                          className={`font-mono font-semibold ${
                            Math.abs(reconciled.unaccountedAnchor ?? 0) > 1_000_000
                              ? "text-red-400"
                              : "text-foreground"
                          }`}
                        >
                          {(reconciled.unaccountedAnchor ?? 0).toLocaleString("en-US", {
                            maximumFractionDigits: 0,
                          })}
                        </span>
                      </div>
                      {Math.abs(reconciled.unaccountedAnchor ?? 0) > 1_000_000 && (
                        <div className="mt-1 text-red-400">
                          ⚠ Significant gap between logged tx and actual balance change. See
                          per-type breakdown for hint.
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="text-muted">{reconciled.message ?? "Not reconcilable"}</div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

type InnerTab = "timeline" | "alerts";

interface FinancialLedgerAdminPanelProps {
  apiBase?: FinancialLedgerApiBase;
}

export function FinancialLedgerAdminPanel({
  apiBase = "/api/admin/financial-logs",
}: FinancialLedgerAdminPanelProps) {
  const [innerTab, setInnerTab] = useState<InnerTab>("timeline");
  const [drillSubjectId, setDrillSubjectId] = useState<string | undefined>(undefined);
  const [drillSubjectName, setDrillSubjectName] = useState<string | undefined>(undefined);

  const handleDrillIn = (subjectId: string | undefined, subjectName: string) => {
    setDrillSubjectId(subjectId);
    setDrillSubjectName(subjectName);
    setInnerTab("timeline");
  };

  const clearDrill = () => {
    setDrillSubjectId(undefined);
    setDrillSubjectName(undefined);
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-semibold">Financial Ledger</h2>
        <p className="mt-0.5 text-xs text-muted">
          96-hour rolling audit log — all financial transactions across characters, corporations,
          parties, and government.
        </p>
      </div>

      {/* Inner tab bar */}
      <div className="flex gap-1 border-b border-card-border">
        {(["timeline", "alerts"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => {
              setInnerTab(tab);
              if (tab !== "timeline") clearDrill();
            }}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              innerTab === tab
                ? "border-b-2 border-primary text-primary"
                : "text-muted hover:text-foreground"
            }`}
          >
            {tab === "timeline" ? "Transaction Timeline" : "Suspect Alerts"}
          </button>
        ))}
      </div>

      {/* Drill-in breadcrumb */}
      {innerTab === "timeline" && drillSubjectId && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted">Filtered to:</span>
          <span className="font-medium">{drillSubjectName}</span>
          <button
            onClick={clearDrill}
            className="ml-auto text-xs text-muted underline hover:text-foreground"
          >
            Clear filter
          </button>
        </div>
      )}

      {innerTab === "timeline" && (
        <TransactionTimeline
          apiBase={apiBase}
          prefilterSubjectId={drillSubjectId}
          prefilterSubjectName={drillSubjectName}
        />
      )}
      {innerTab === "alerts" && <SuspectAlerts apiBase={apiBase} onDrillIn={handleDrillIn} />}
    </div>
  );
}
