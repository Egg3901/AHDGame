"use client";

import {
  QUEUE_DESTINATIONS,
  type AdminBadgeCounts,
} from "@/components/admin/nav/useAdminBadgeCounts";
import type { MainTabId } from "@/components/admin/tabs/AdminTabsConfig";

interface PendingQueuesCardProps {
  counts: AdminBadgeCounts;
  onNavigate: (tab: MainTabId, sub?: string) => void;
}

/** Every review queue with its live count, one click from the dashboard. */
export function PendingQueuesCard({ counts, onNavigate }: PendingQueuesCardProps) {
  return (
    <section className="rounded-lg border border-card-border bg-card shadow-card">
      <div className="border-b border-card-border px-4 py-3">
        <h2 className="text-body font-bold">Pending queues</h2>
      </div>
      <div className="flex flex-col p-1.5">
        {QUEUE_DESTINATIONS.map((q) => {
          const count = counts.queues[q.key];
          return (
            <button
              key={q.key}
              type="button"
              onClick={() => onNavigate(q.tab, q.sub)}
              className="flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-white/5"
            >
              <span className={`h-2 w-2 shrink-0 rounded-full ${q.dotClass}`} aria-hidden />
              <span className="min-w-0 flex-1 truncate text-body-sm font-medium">{q.label}</span>
              <span
                className={`font-mono text-body-sm font-semibold ${
                  (count ?? 0) > 0 ? "text-foreground" : "text-muted"
                }`}
              >
                {count ?? "—"}
              </span>
              <span className="text-body-xs text-muted" aria-hidden>
                →
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
