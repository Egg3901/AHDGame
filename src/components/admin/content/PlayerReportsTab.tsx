"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { LocalTime } from "@/components/time/LocalTime";

interface PlayerReport {
  _id: string;
  targetCharacterId: string;
  targetCharacterName: string;
  reason: string;
  context: string;
  details?: string;
  status: "pending" | "dismissed" | "actioned";
  adminNote?: string;
  createdAt: string;
}

type StatusFilter = "pending" | "dismissed" | "actioned" | "all";

const REASON_LABELS: Record<string, string> = {
  harassment: "Harassment or bullying",
  hate: "Hate speech",
  sexual: "Sexual content",
  violence: "Violence or threats",
  spam: "Spam or scams",
  impersonation: "Impersonation",
  other: "Other",
};

/**
 * Moderator queue for reports filed from player profiles. Moderators open the
 * profile, act with the existing tools (edit bio, warn, ban), then close the
 * report here as actioned or dismissed.
 */
export function PlayerReportsTab() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("pending");
  const [reports, setReports] = useState<PlayerReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (statusFilter !== "all") params.set("status", statusFilter);
    try {
      const res = await fetch(`/api/admin/player-reports?${params}`);
      const data = res.ok ? await res.json() : null;
      setReports(data?.reports ?? []);
    } catch {
      setReports([]);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const close = async (id: string, status: "dismissed" | "actioned") => {
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/player-reports/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, adminNote: notes[id] || undefined }),
      });
      if (res.ok) await load();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {(["pending", "all", "dismissed", "actioned"] as StatusFilter[]).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`rounded-lg px-3 py-1 text-xs font-medium transition-colors ${
              statusFilter === s
                ? "border border-primary/30 bg-primary/20 text-primary"
                : "text-muted hover:text-foreground"
            }`}
          >
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {loading && <p className="py-4 text-center text-sm text-muted">Loading reports…</p>}
      {!loading && reports.length === 0 && (
        <p className="py-4 text-center text-sm text-muted">No reports found.</p>
      )}

      {!loading &&
        reports.map((report) => (
          <div
            key={report._id}
            className="space-y-3 rounded-xl border border-card-border bg-card p-4"
          >
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
              <span
                className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                  report.status === "pending"
                    ? "bg-yellow-500/20 text-yellow-400"
                    : report.status === "dismissed"
                      ? "bg-zinc-500/20 text-zinc-400"
                      : "bg-green-500/20 text-green-400"
                }`}
              >
                {report.status}
              </span>
              <LocalTime
                value={report.createdAt}
                options={{ month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }}
              />
              <span>· seen on {report.context}</span>
            </div>
            <p className="text-sm">
              <Link
                href={`/character/${report.targetCharacterId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-primary hover:underline"
              >
                {report.targetCharacterName} ↗
              </Link>{" "}
              <span className="text-muted">· {REASON_LABELS[report.reason] ?? report.reason}</span>
            </p>
            {report.details && (
              <p className="whitespace-pre-wrap rounded-lg bg-background/60 p-3 text-sm">
                {report.details}
              </p>
            )}
            {report.adminNote && (
              <p className="text-xs text-muted">
                <span className="font-semibold">Staff note:</span> {report.adminNote}
              </p>
            )}
            {report.status === "pending" && (
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  maxLength={500}
                  placeholder="Staff note (optional)"
                  value={notes[report._id] ?? ""}
                  onChange={(e) => setNotes((n) => ({ ...n, [report._id]: e.target.value }))}
                  className="min-w-0 flex-1 rounded-lg border border-card-border bg-background px-3 py-1.5 text-sm"
                />
                <button
                  disabled={busyId === report._id}
                  onClick={() => close(report._id, "actioned")}
                  className="rounded-lg border border-green-500/30 bg-green-500/10 px-3 py-1.5 text-xs font-medium text-green-400 disabled:opacity-50"
                >
                  Mark actioned
                </button>
                <button
                  disabled={busyId === report._id}
                  onClick={() => close(report._id, "dismissed")}
                  className="rounded-lg border border-card-border px-3 py-1.5 text-xs font-medium text-muted disabled:opacity-50"
                >
                  Dismiss
                </button>
              </div>
            )}
          </div>
        ))}
    </div>
  );
}
