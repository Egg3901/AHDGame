"use client";

import { formatMonthLabel } from "@/lib/changelog/postUtils";

export function MonthDivider({ month }: { month: string }) {
  return (
    <div className="flex items-center gap-3 py-2">
      <span className="text-xs font-bold uppercase tracking-widest text-muted">
        {formatMonthLabel(month)}
      </span>
      <span className="h-px flex-1 bg-card-border" />
    </div>
  );
}
