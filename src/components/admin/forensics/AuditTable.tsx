"use client";

// Reverse-chronological, virtualized result stream. Rows are a fixed height so
// we can window them cheaply (only the visible slice + overscan is mounted),
// which keeps the stream smooth at thousands of rows without a virtualization
// dependency. Nearing the bottom triggers cursor-based load-more.

import { useCallback, useRef, useState } from "react";
import { FlagChips } from "./FlagChips";
import {
  type ActionAuditRecord,
  categoryMeta,
  formatAmount,
  formatRelative,
  formatTimestamp,
  isFiniteNumber,
  OUTCOME_META,
  summarizeRecord,
} from "./types";

const ROW_H = 64;
const OVERSCAN = 6;
const VIEWPORT_H = 560;
const LOAD_MORE_PX = 400; // trigger load-more when this close to the bottom

interface AuditTableProps {
  rows: ActionAuditRecord[];
  loading: boolean;
  hasMore: boolean;
  selectedId?: string;
  activeFlag?: string;
  onSelect: (record: ActionAuditRecord) => void;
  onFollowTrace: (traceId: string) => void;
  onFlagSelect: (flag: string) => void;
  onLoadMore: () => void;
}

function Row({
  record,
  selected,
  activeFlag,
  onSelect,
  onFollowTrace,
  onFlagSelect,
}: {
  record: ActionAuditRecord;
  selected: boolean;
  activeFlag?: string;
  onSelect: () => void;
  onFollowTrace: () => void;
  onFlagSelect: (flag: string) => void;
}) {
  const cat = categoryMeta(record.category);
  const flagged = Boolean(record.flags && record.flags.length > 0);
  return (
    <div
      style={{ height: ROW_H }}
      onClick={onSelect}
      className={`group relative flex cursor-pointer items-center gap-3 border-b border-card-border/60 px-3 transition-colors motion-reduce:transition-none ${
        selected
          ? "bg-primary/10"
          : flagged
            ? "bg-red-500/[0.04] hover:bg-card-elevated/60"
            : "hover:bg-card-elevated/60"
      }`}
    >
      {/* Selection / flag rail */}
      <span
        aria-hidden
        className={`absolute inset-y-2 left-0 w-0.5 rounded-r-full ${
          selected ? "bg-primary" : flagged ? "bg-red-500/60" : "bg-transparent"
        }`}
      />

      {/* Time / turn */}
      <div
        className="w-20 flex-shrink-0 text-xs tabular-nums text-muted"
        title={formatTimestamp(record.ts)}
      >
        <div className="font-medium text-foreground">{formatRelative(record.ts)}</div>
        <div className="mt-0.5 text-[10px]">Turn {record.turn}</div>
      </div>

      {/* Category dot */}
      <span
        className={`h-2.5 w-2.5 flex-shrink-0 rounded-full ring-2 ring-background/60 ${cat.dot}`}
        title={cat.label}
      />

      {/* Summary + meta */}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm text-foreground">{summarizeRecord(record)}</div>
        <div className="mt-0.5 flex items-center gap-2 overflow-hidden whitespace-nowrap text-xs text-muted">
          <span className="font-mono text-[11px]">{record.action}</span>
          {flagged && (
            <span className="min-w-0 overflow-hidden">
              <FlagChips flags={record.flags} activeFlag={activeFlag} onSelect={onFlagSelect} />
            </span>
          )}
        </div>
      </div>

      {/* Amount */}
      {isFiniteNumber(record.amount) && (
        <div
          className={`hidden flex-shrink-0 font-mono text-sm tabular-nums sm:block ${
            record.amount < 0 ? "text-red-400" : "text-green-400"
          }`}
        >
          {formatAmount(record.amount, record.currencyCode)}
        </div>
      )}

      {/* Outcome */}
      <span
        className={`hidden flex-shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide md:inline-block ${OUTCOME_META[record.outcome].badge}`}
      >
        {OUTCOME_META[record.outcome].label}
      </span>

      {/* Follow trace */}
      <button
        type="button"
        title="Follow this trace end-to-end"
        onClick={(e) => {
          e.stopPropagation();
          onFollowTrace();
        }}
        className="flex-shrink-0 rounded-md border border-card-border px-2 py-1 text-[11px] font-medium text-muted transition-colors hover:border-primary/40 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 motion-reduce:transition-none"
      >
        Trace →
      </button>
    </div>
  );
}

export function AuditTable({
  rows,
  loading,
  hasMore,
  selectedId,
  activeFlag,
  onSelect,
  onFollowTrace,
  onFlagSelect,
  onLoadMore,
}: AuditTableProps) {
  const [scrollTop, setScrollTop] = useState(0);
  const scrollerRef = useRef<HTMLDivElement>(null);

  const handleScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const el = e.currentTarget;
      setScrollTop(el.scrollTop);
      if (hasMore && !loading && el.scrollHeight - el.scrollTop - el.clientHeight < LOAD_MORE_PX) {
        onLoadMore();
      }
    },
    [hasMore, loading, onLoadMore]
  );

  const total = rows.length;
  const start = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const end = Math.min(total, Math.ceil((scrollTop + VIEWPORT_H) / ROW_H) + OVERSCAN);
  const visible = rows.slice(start, end);
  const padTop = start * ROW_H;
  const padBottom = Math.max(0, (total - end) * ROW_H);

  if (!loading && total === 0) {
    return null; // empty state handled by the parent (needs reset affordance)
  }

  return (
    <div className="overflow-hidden rounded-xl border border-card-border bg-card shadow-card">
      {/* Slim status strip: keeps the stream scannable without a heavy header. */}
      <div className="flex items-baseline justify-between border-b border-card-border/70 bg-card-elevated/40 px-3 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
          Action stream
        </span>
        <span className="text-[11px] tabular-nums text-muted">
          {total > 0 ? `${total.toLocaleString("en-US")}${hasMore ? "+" : ""} actions` : "loading…"}
        </span>
      </div>
      <div
        ref={scrollerRef}
        onScroll={handleScroll}
        style={{ height: VIEWPORT_H }}
        className="overflow-y-auto"
      >
        {/* Loading skeleton for the very first load */}
        {loading && total === 0 ? (
          <div className="p-2" aria-hidden>
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="flex h-14 w-full animate-pulse items-center gap-3 rounded-lg px-2 motion-reduce:animate-none"
              >
                <div className="h-3 w-16 rounded bg-card-elevated" />
                <div className="h-2.5 w-2.5 rounded-full bg-card-elevated" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 w-3/4 rounded bg-card-elevated" />
                  <div className="h-2.5 w-1/3 rounded bg-card-elevated/70" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <>
            <div style={{ height: padTop }} />
            {visible.map((r) => (
              <Row
                key={r._id}
                record={r}
                selected={r._id === selectedId}
                activeFlag={activeFlag}
                onSelect={() => onSelect(r)}
                onFollowTrace={() => onFollowTrace(r.traceId)}
                onFlagSelect={onFlagSelect}
              />
            ))}
            <div style={{ height: padBottom }} />
            {loading && total > 0 && (
              <div className="flex justify-center py-3">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent motion-reduce:animate-none" />
              </div>
            )}
            {!hasMore && total > 0 && (
              <div className="flex items-center gap-3 px-6 py-3 text-[11px] uppercase tracking-[0.14em] text-muted/70">
                <span className="h-px flex-1 bg-card-border/60" aria-hidden />
                End of results
                <span className="h-px flex-1 bg-card-border/60" aria-hidden />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
