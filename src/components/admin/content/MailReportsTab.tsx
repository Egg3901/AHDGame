"use client";

import { useReducer, useEffect, useCallback } from "react";
import Link from "next/link";

interface MailReport {
  _id: string;
  mailId: string;
  reportedByUserId: string;
  status: "pending" | "dismissed" | "actioned";
  adminNote?: string;
  reviewedAt?: string;
  createdAt: string;
  mail?: {
    fromCharacterName: string;
    fromCharacterSequentialId: number;
    toCharacterName: string;
    toCharacterSequentialId: number;
    subject: string;
    body: string;
  };
}

type StatusFilter = "pending" | "dismissed" | "actioned" | "all";

interface State {
  reports: MailReport[];
  loading: boolean;
  statusFilter: StatusFilter;
  expandedId: string | null;
}

type Action =
  | { type: "LOAD_START" }
  | { type: "LOAD_SUCCESS"; reports: MailReport[] }
  | { type: "SET_STATUS_FILTER"; filter: StatusFilter }
  | { type: "SET_EXPANDED"; id: string | null };

const initialState: State = {
  reports: [],
  loading: true,
  statusFilter: "pending",
  expandedId: null,
};

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "LOAD_START":
      return { ...state, loading: true };
    case "LOAD_SUCCESS":
      return { ...state, loading: false, reports: action.reports };
    case "SET_STATUS_FILTER":
      return { ...state, statusFilter: action.filter };
    case "SET_EXPANDED":
      return { ...state, expandedId: action.id };
    default:
      return state;
  }
}

const conversationHref = (reportId: string, backHref?: string) => {
  const base = `/moderator/mail-reports/${reportId}`;
  if (!backHref) return base;
  return `${base}?back=${encodeURIComponent(backHref)}`;
};

export function MailReportsTab({ backHref }: { backHref?: string }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const { reports, loading, statusFilter, expandedId } = state;

  const fetchReports = useCallback(async () => {
    dispatch({ type: "LOAD_START" });
    const params = new URLSearchParams();
    if (statusFilter !== "all") params.set("status", statusFilter);
    const res = await fetch(`/api/admin/mail-reports?${params}`);
    if (res.ok) {
      const data = await res.json();
      dispatch({ type: "LOAD_SUCCESS", reports: data.reports ?? [] });
    } else {
      dispatch({ type: "LOAD_SUCCESS", reports: [] });
    }
  }, [statusFilter]);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  const statusBadge = (s: MailReport["status"]) => {
    const cls =
      s === "pending"
        ? "bg-yellow-500/20 text-yellow-400"
        : s === "dismissed"
          ? "bg-zinc-500/20 text-zinc-400"
          : "bg-green-500/20 text-green-400";
    return (
      <span className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded ${cls}`}>
        {s}
      </span>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap">
        {(["pending", "all", "dismissed", "actioned"] as StatusFilter[]).map((s) => (
          <button
            key={s}
            onClick={() => dispatch({ type: "SET_STATUS_FILTER", filter: s })}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
              statusFilter === s
                ? "bg-primary/20 text-primary border border-primary/30"
                : "text-muted hover:text-foreground"
            }`}
          >
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {loading && <p className="text-sm text-muted py-4 text-center">Loading reports…</p>}
      {!loading && reports.length === 0 && (
        <p className="text-sm text-muted py-4 text-center">No reports found.</p>
      )}

      {!loading &&
        reports.map((report) => {
          const isExpanded = expandedId === report._id;
          const viewHref = conversationHref(report._id, backHref);
          return (
            <div key={report._id} className="rounded-xl border border-card-border bg-card">
              <div className="flex items-start justify-between gap-4 p-4">
                <button
                  type="button"
                  className="min-w-0 flex-1 cursor-pointer text-left"
                  onClick={() =>
                    dispatch({ type: "SET_EXPANDED", id: isExpanded ? null : report._id })
                  }
                >
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      {statusBadge(report.status)}
                      <span className="text-xs text-muted">{formatDate(report.createdAt)}</span>
                    </div>
                    {report.mail ? (
                      <>
                        <p className="text-sm font-medium text-foreground truncate">
                          {report.mail.subject}
                        </p>
                        <p className="text-xs text-muted">
                          From{" "}
                          <Link
                            href={`/character/${report.mail.fromCharacterSequentialId}`}
                            className="text-primary hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {report.mail.fromCharacterName}
                          </Link>
                          {" → "}
                          <Link
                            href={`/character/${report.mail.toCharacterSequentialId}`}
                            className="text-primary hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {report.mail.toCharacterName}
                          </Link>
                        </p>
                      </>
                    ) : (
                      <p className="text-xs text-muted italic">Mail deleted</p>
                    )}
                  </div>
                </button>

                <Link
                  href={viewHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 rounded-lg border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/15"
                >
                  View conversation ↗
                </Link>
              </div>

              {isExpanded && (
                <div className="border-t border-card-border/50 px-4 pb-4 pt-4 space-y-3">
                  {report.adminNote && (
                    <p className="text-xs text-muted">
                      <span className="font-semibold">Staff note:</span> {report.adminNote}
                    </p>
                  )}
                  <p className="text-xs text-muted">
                    Open the conversation page to read the full thread and take moderation action.
                  </p>
                  <Link
                    href={viewHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex text-sm font-medium text-primary hover:underline"
                  >
                    Open reported conversation ↗
                  </Link>
                  {backHref && (
                    <p className="text-xs text-muted">
                      Or return to{" "}
                      <Link href={backHref} className="text-primary hover:underline">
                        mail reports list
                      </Link>
                      .
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
    </div>
  );
}
