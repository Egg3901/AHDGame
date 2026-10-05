"use client";

import { formatMonthLabel } from "@/lib/changelog/postUtils";

export function MonthDivider({ month }: { month: string }) {
  return (
    <div className="flex items-center gap-3 py-2">
      <span className="text-body-sm font-medium text-muted">{formatMonthLabel(month)}</span>
      <span className="h-px flex-1 bg-card-border" />
    </div>
  );
}
