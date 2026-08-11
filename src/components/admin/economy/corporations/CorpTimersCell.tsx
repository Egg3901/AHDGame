"use client";

import type { CorpRow } from "../useCorporationsAdminState";

/** Renders active timer badges or "No Timers Active" for a corporation row. */
export function CorpTimersCell({ row, currentTurn }: { row: CorpRow; currentTurn: number }) {
  const timers: { label: string; remaining: number | null }[] = [];

  if (row.ceoVacant && row.ceoVacantSinceTurn != null) {
    // CEO vacancy isn't a countdown — it's "vacant since turn X"
    const turnsSince = currentTurn - row.ceoVacantSinceTurn;
    timers.push({ label: `CEO vacant ${turnsSince}t`, remaining: null });
  }

  if (row.suspended && row.suspendedUntilTurn != null) {
    const remaining = row.suspendedUntilTurn - currentTurn;
    timers.push({
      label: remaining > 0 ? `Suspended ${remaining}t` : "Suspension expired",
      remaining,
    });
  }

  if (row.bondDefaultCreditPenaltyUntilTurn != null) {
    const remaining = row.bondDefaultCreditPenaltyUntilTurn - currentTurn;
    timers.push({
      label: remaining > 0 ? `Bond default ${remaining}t` : "Penalty expired",
      remaining,
    });
  }

  if (timers.length === 0) {
    return <span className="text-xs text-success font-medium">No Timers Active</span>;
  }

  return (
    <div className="flex flex-col gap-1">
      {timers.map((t) => (
        <span
          key={t.label}
          className={`text-[10px] font-semibold px-1.5 py-0.5 rounded w-fit ${
            t.remaining != null && t.remaining <= 0
              ? "bg-success/20 text-success"
              : "bg-warning/20 text-warning"
          }`}
        >
          {t.label}
        </span>
      ))}
    </div>
  );
}
