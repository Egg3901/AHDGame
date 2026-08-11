"use client";

// Before/after delta renderer. Each changed field is shown as an aligned
// before → after pair; when both sides are numeric the signed diff is
// highlighted (green up / red down). Money rows surface a pivot to the linked
// financial-tx / ledger entry instead of making the mod read raw amounts.

import {
  type ActionAuditRecord,
  type AuditDelta,
  formatAmount,
  formatDeltaValue,
  isFiniteNumber,
  numericDelta,
  refPivots,
} from "./types";

interface DeltaViewProps {
  record: ActionAuditRecord;
  /** Pivot into a linked domain log (financial tx, ledger, bill, …). */
  onRefPivot?: (refKey: string, refId: string) => void;
}

function DeltaRow({ delta }: { delta: AuditDelta }) {
  const diff = numericDelta(delta);
  const beforeNum = isFiniteNumber(delta.before);
  const afterNum = isFiniteNumber(delta.after);

  return (
    <div className="grid grid-cols-[minmax(6rem,10rem)_1fr] items-start gap-x-3 gap-y-0.5 py-2">
      <div className="break-words pt-0.5 font-mono text-xs text-muted">{delta.field}</div>
      <div className="flex flex-wrap items-center gap-1.5 text-sm">
        <span
          className={`rounded-md border border-card-border/60 bg-card-muted px-1.5 py-0.5 font-mono text-xs tabular-nums ${
            beforeNum ? "text-foreground/80" : "text-muted"
          }`}
        >
          {formatDeltaValue(delta.before)}
        </span>
        <span aria-hidden className="px-0.5 text-muted">
          →
        </span>
        <span className="rounded-md border border-card-border/60 bg-card-muted px-1.5 py-0.5 font-mono text-xs tabular-nums text-foreground">
          {formatDeltaValue(delta.after)}
        </span>
        {afterNum && beforeNum && diff !== null && diff !== 0 && (
          <span
            className={`rounded-md px-1.5 py-0.5 font-mono text-xs font-semibold tabular-nums ${
              diff > 0 ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"
            }`}
          >
            {diff > 0 ? "+" : ""}
            {diff.toLocaleString("en-US")}
          </span>
        )}
      </div>
    </div>
  );
}

export function DeltaView({ record, onRefPivot }: DeltaViewProps) {
  const deltas = record.delta ?? [];
  const isMoney = record.category === "money" || record.category === "market";
  const pivots = refPivots(record.refs);
  const moneyPivots = pivots.filter(
    (p) => p.key === "financialTxLogId" || p.key === "ledgerEntryId"
  );

  const hasContent = deltas.length > 0 || (isMoney && isFiniteNumber(record.amount));
  if (!hasContent) {
    return <p className="text-sm italic text-muted">No recorded field changes for this action.</p>;
  }

  return (
    <div className="space-y-3">
      {/* Money headline: signed amount + pivot to the heavy domain log. */}
      {isMoney && isFiniteNumber(record.amount) && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-card-border bg-card/60 px-4 py-3">
          <div>
            <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
              Amount
            </div>
            <div
              className={`font-mono text-xl font-semibold tabular-nums tracking-tight ${
                record.amount < 0 ? "text-red-400" : "text-green-400"
              }`}
            >
              {formatAmount(record.amount, record.currencyCode)}
            </div>
          </div>
          {isFiniteNumber(record.anchorAmount) && (
            <div>
              <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
                Anchor (₳)
              </div>
              <div className="font-mono text-sm tabular-nums text-muted">
                {formatAmount(record.anchorAmount, undefined, false)}
              </div>
            </div>
          )}
          {moneyPivots.length > 0 && onRefPivot && (
            <div className="ml-auto flex flex-wrap gap-2">
              {moneyPivots.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => onRefPivot(p.key, String(record.refs?.[p.key]))}
                  className="rounded-md border border-card-border px-2.5 py-1.5 text-xs font-medium text-primary transition-colors hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 motion-reduce:transition-none"
                >
                  View {p.label} →
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {deltas.length > 0 ? (
        <div className="divide-y divide-card-border/60 rounded-lg border border-card-border bg-card/40 px-3">
          {deltas.map((d, i) => (
            <DeltaRow key={`${d.field}-${i}`} delta={d} />
          ))}
        </div>
      ) : (
        isMoney && (
          <p className="text-xs italic text-muted">
            Amounts recorded on the linked financial-tx entry; no additional field-level changes.
          </p>
        )
      )}
    </div>
  );
}
