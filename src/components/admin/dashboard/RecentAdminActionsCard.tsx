"use client";

import { useEffect, useState } from "react";
import { Skeleton } from "@/components/ui";
import type { MainTabId } from "@/components/admin/tabs/AdminTabsConfig";

interface AuditRow {
  _id: string;
  ts: string;
  action: string;
  actor?: { name?: string; kind?: string };
  subject?: { type?: string; name?: string };
  outcome?: string;
}

interface RecentAdminActionsCardProps {
  onNavigate: (tab: MainTabId, sub?: string) => void;
}

/** Last few `category:"admin"` rows from the action-audit spine — who touched
 * what, straight on the dashboard. Full history lives in Players → Forensics. */
export function RecentAdminActionsCard({ onNavigate }: RecentAdminActionsCardProps) {
  const [rows, setRows] = useState<AuditRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/audit?category=admin&limit=8", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled) setRows(Array.isArray(data?.rows) ? data.rows : []);
      })
      .catch((err) => {
        console.debug("admin recent-actions fetch failed", err);
        if (!cancelled) setRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="rounded-lg border border-card-border bg-card shadow-card">
      <div className="flex items-center justify-between border-b border-card-border px-4 py-3">
        <h2 className="text-body font-bold">Recent admin actions</h2>
        <button
          type="button"
          onClick={() => onNavigate("players", "forensics")}
          className="cursor-pointer text-body-sm font-semibold text-primary hover:underline"
        >
          Forensics →
        </button>
      </div>
      <div className="flex flex-col px-4 py-2">
        {rows === null &&
          Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="border-b border-card-border/50 py-2 last:border-b-0">
              <Skeleton className="h-3.5 w-full" />
            </div>
          ))}
        {rows !== null && rows.length === 0 && (
          <div className="py-4 text-center text-body-sm text-muted">
            No recent admin actions recorded
          </div>
        )}
        {rows?.map((row) => {
          const when = new Date(row.ts);
          const time = Number.isNaN(when.getTime())
            ? "—"
            : when.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
          return (
            <div
              key={row._id}
              className="flex gap-2.5 border-b border-card-border/50 py-2 last:border-b-0"
            >
              <span className="w-14 shrink-0 pt-px font-mono text-body-xs text-muted">{time}</span>
              <div className="min-w-0">
                <div className="text-body-sm leading-snug">
                  <span className="font-semibold">{row.actor?.name ?? "System"}</span>{" "}
                  <span className="break-all text-muted">{row.action}</span>
                </div>
                {(row.subject?.name || row.subject?.type) && (
                  <div className="truncate text-body-xs text-muted">
                    {row.subject?.name ?? row.subject?.type}
                    {row.outcome && row.outcome !== "ok" ? ` · ${row.outcome}` : ""}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
