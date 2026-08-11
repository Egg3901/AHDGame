"use client";

// Follows one correlation `traceId` end-to-end. Renders every audit row that
// shares the trace, in `seq` order, as a vertical causal timeline — the full
// chain of one request or turn phase. Each node is clickable to open the
// record inspector.

import { useCallback, useEffect, useState } from "react";
import { FlagChips } from "./FlagChips";
import {
  type ActionAuditRecord,
  type AuditTraceResponse,
  categoryMeta,
  describeParty,
  formatAmount,
  formatTimestamp,
  humanizeAction,
  isFiniteNumber,
  OUTCOME_META,
  summarizeRecord,
} from "./types";

interface TraceTimelineProps {
  traceId: string;
  apiBase: string;
  onSelectRecord: (record: ActionAuditRecord) => void;
  onBack: () => void;
  /** Id of the record the user arrived from, highlighted in the chain. */
  focusRecordId?: string;
}

function TraceNode({
  record,
  isLast,
  focused,
  onSelect,
}: {
  record: ActionAuditRecord;
  isLast: boolean;
  focused: boolean;
  onSelect: () => void;
}) {
  const cat = categoryMeta(record.category);
  return (
    <li className="relative flex gap-4">
      {/* Rail: a vertical connector (except after the last node) with a
          category-colored node dot. */}
      <div className="relative flex w-3 flex-shrink-0 justify-center">
        {!isLast && <span className="absolute bottom-0 top-3 w-px bg-card-border/80" aria-hidden />}
        <span
          className={`z-10 mt-3 h-3 w-3 flex-shrink-0 rounded-full ring-4 ring-background ${cat.dot}`}
        />
      </div>

      {/* Card */}
      <button
        type="button"
        onClick={onSelect}
        className={`mb-3 flex-1 rounded-xl border px-4 py-3 text-left shadow-card transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 motion-reduce:transition-none ${
          focused
            ? "border-primary/50 bg-primary/[0.06] ring-1 ring-primary/25"
            : "border-card-border bg-card hover:bg-card-elevated/60"
        }`}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-md bg-card-muted px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-muted">
            #{record.seq ?? "—"}
          </span>
          <span
            className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cat.badge}`}
          >
            {cat.label}
          </span>
          <span className="font-mono text-xs">{record.action}</span>
          <span
            className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${OUTCOME_META[record.outcome].badge}`}
          >
            {OUTCOME_META[record.outcome].label}
          </span>
          <span className="ml-auto text-[11px] tabular-nums text-muted">
            {formatTimestamp(record.ts)}
          </span>
        </div>
        <p className="mt-1.5 text-sm">{summarizeRecord(record)}</p>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
          <span>{humanizeAction(record.action)}</span>
          {record.subject && <span>· {describeParty(record.subject)}</span>}
          {isFiniteNumber(record.amount) && (
            <span
              className={`font-mono tabular-nums ${record.amount < 0 ? "text-red-400" : "text-green-400"}`}
            >
              · {formatAmount(record.amount, record.currencyCode)}
            </span>
          )}
        </div>
        {record.flags && record.flags.length > 0 && (
          <div className="mt-2">
            <FlagChips flags={record.flags} />
          </div>
        )}
      </button>
    </li>
  );
}

export function TraceTimeline({
  traceId,
  apiBase,
  onSelectRecord,
  onBack,
  focusRecordId,
}: TraceTimelineProps) {
  const [rows, setRows] = useState<ActionAuditRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${apiBase}/audit/trace/${encodeURIComponent(traceId)}`);
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
      const data: AuditTraceResponse = await res.json();
      const sorted = [...(data.rows ?? [])].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
      setRows(sorted);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load trace");
    } finally {
      setLoading(false);
    }
  }, [apiBase, traceId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <button
          type="button"
          onClick={onBack}
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
          Back to results
        </button>
        <div className="min-w-0">
          <h2 className="text-lg font-semibold tracking-tight">Trace timeline</h2>
          <p
            className="mt-0.5 max-w-full truncate rounded-md border border-card-border/60 bg-card-muted px-1.5 py-0.5 font-mono text-[11px] text-muted"
            title={traceId}
          >
            {traceId}
          </p>
        </div>
        {!loading && rows.length > 0 && (
          <span className="ml-auto rounded-md border border-card-border/70 bg-card-elevated/60 px-2 py-1 text-xs tabular-nums text-muted">
            {rows.length} step{rows.length === 1 ? "" : "s"} · turn {rows[0].turn}
          </span>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm text-red-400">
          <p>{error}</p>
          <button onClick={load} className="mt-1 text-xs underline hover:text-red-300">
            Retry
          </button>
        </div>
      )}

      {loading ? (
        <div className="space-y-3" aria-hidden>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex gap-4">
              <div className="mt-3 h-3 w-3 flex-shrink-0 animate-pulse rounded-full bg-card-elevated motion-reduce:animate-none" />
              <div className="h-20 flex-1 animate-pulse rounded-xl border border-card-border bg-card motion-reduce:animate-none" />
            </div>
          ))}
        </div>
      ) : rows.length === 0 && !error ? (
        <div className="rounded-xl border border-card-border bg-card px-4 py-10 text-center text-sm text-muted shadow-card">
          No records found for this trace. It may have expired out of the audit window.
        </div>
      ) : (
        <ol className="mt-1">
          {rows.map((r, i) => (
            <TraceNode
              key={r._id}
              record={r}
              isLast={i === rows.length - 1}
              focused={r._id === focusRecordId}
              onSelect={() => onSelectRecord(r)}
            />
          ))}
        </ol>
      )}
    </div>
  );
}
