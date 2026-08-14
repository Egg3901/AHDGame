"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { LocalTime } from "@/components/time/LocalTime";

type ReportStatus = "pending" | "dismissed" | "actioned";

interface MailReportMessage {
  id: string;
  fromCharacterId: string | null;
  fromCharacterName: string;
  fromCharacterSequentialId: number | null;
  toCharacterId: string;
  toCharacterName: string;
  toCharacterSequentialId: number;
  body: string;
  createdAt: string;
  isReported: boolean;
  deletedByRecipient: boolean;
  deletedBySender: boolean;
}

interface MailReportDetail {
  report: {
    _id: string;
    mailId: string;
    reportedByUserId: string;
    status: ReportStatus;
    adminNote?: string;
    reviewedAt?: string;
    createdAt: string;
  };
  reporterUsername: string | null;
  subject: string | null;
  messages: MailReportMessage[];
}

interface MailReportViewClientProps {
  reportId: string;
  backHref?: string;
}

const DATE_LABEL_OPTIONS = {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
} as const;

export function MailReportViewClient({
  reportId,
  backHref: backHrefProp = "/moderator?tab=content&sub=mail-reports",
}: MailReportViewClientProps) {
  const searchParams = useSearchParams();
  const backHref = searchParams.get("back") ?? backHrefProp;
  const [detail, setDetail] = useState<MailReportDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionNote, setActionNote] = useState("");
  const [actioning, setActioning] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/mail-reports/${reportId}`, {
        credentials: "same-origin",
      });
      if (!res.ok)
        throw new Error(res.status === 404 ? "Report not found" : `status ${res.status}`);
      setDetail(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load report");
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [reportId]);

  useEffect(() => {
    void load();
  }, [load]);

  const takeAction = async (action: "dismiss" | "delete_mail" | "warn" | "ban") => {
    setActioning(action);
    try {
      const res = await fetch(`/api/admin/mail-reports/${reportId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, adminNote: actionNote || undefined }),
      });
      if (!res.ok) throw new Error(`Action failed (${res.status})`);
      setActionNote("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setActioning(null);
    }
  };

  if (loading) {
    return <p className="py-12 text-center text-sm text-muted">Loading conversation…</p>;
  }

  if (error || !detail) {
    return (
      <div className="py-12 text-center">
        <p className="text-sm text-error">{error ?? "Report not found"}</p>
        <Link href={backHref} className="mt-3 inline-block text-sm text-primary hover:underline">
          ← Back to mail reports
        </Link>
      </div>
    );
  }

  const { report, reporterUsername, subject, messages } = detail;
  const statusTone =
    report.status === "pending"
      ? "text-yellow-400"
      : report.status === "dismissed"
        ? "text-zinc-400"
        : "text-green-400";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Link href={backHref} className="text-xs text-muted hover:text-foreground">
            ← Back to mail reports
          </Link>
          <h1 className="mt-2 text-xl font-semibold text-foreground">
            {subject ?? "Deleted message"}
          </h1>
          <p className="mt-1 text-sm text-muted">
            Reported <LocalTime value={report.createdAt} options={DATE_LABEL_OPTIONS} />
            {reporterUsername ? ` by @${reporterUsername}` : ""}
            {" · "}
            <span className={`font-medium uppercase ${statusTone}`}>{report.status}</span>
          </p>
        </div>
      </div>

      {report.adminNote && (
        <div className="rounded-lg border border-card-border bg-card-elevated px-4 py-3 text-sm text-muted">
          <span className="font-semibold text-foreground">Staff note:</span> {report.adminNote}
        </div>
      )}

      <div className="rounded-xl border border-card-border bg-card">
        <div className="border-b border-card-border px-4 py-3">
          <h2 className="text-sm font-semibold text-foreground">Conversation</h2>
          <p className="mt-0.5 text-xs text-muted">
            Full thread between the players. The reported message is highlighted.
          </p>
        </div>

        {messages.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted italic">
            The reported message was deleted and is no longer available.
          </p>
        ) : (
          <div className="divide-y divide-card-border/60">
            {messages.map((msg) => {
              const deleted = msg.deletedByRecipient || msg.deletedBySender;
              return (
                <div
                  key={msg.id}
                  className={`px-4 py-4 ${msg.isReported ? "bg-error/5 ring-1 ring-inset ring-error/20" : ""}`}
                >
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                    {msg.fromCharacterSequentialId ? (
                      <Link
                        href={`/character/${msg.fromCharacterSequentialId}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {msg.fromCharacterName}
                      </Link>
                    ) : (
                      <span className="font-medium text-foreground">{msg.fromCharacterName}</span>
                    )}
                    <span>→</span>
                    <Link
                      href={`/character/${msg.toCharacterSequentialId}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {msg.toCharacterName}
                    </Link>
                    <span>·</span>
                    <span>
                      <LocalTime value={msg.createdAt} options={DATE_LABEL_OPTIONS} />
                    </span>
                    {msg.isReported && (
                      <span className="rounded bg-error/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-error">
                        Reported
                      </span>
                    )}
                    {deleted && (
                      <span className="rounded bg-zinc-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
                        Deleted
                      </span>
                    )}
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-foreground/90">{msg.body}</p>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {report.status === "pending" && (
        <div className="rounded-xl border border-card-border bg-card p-4 space-y-3">
          <h2 className="text-sm font-semibold text-foreground">Moderation actions</h2>
          <div className="space-y-1">
            <label className="text-xs text-muted">Staff note (optional)</label>
            <input
              type="text"
              maxLength={500}
              value={actionNote}
              onChange={(e) => setActionNote(e.target.value)}
              placeholder="Reason for action…"
              className="w-full rounded-lg border border-card-border bg-zinc-950 px-3 py-2 text-sm text-foreground focus:border-zinc-500 focus:outline-none"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void takeAction("dismiss")}
              disabled={actioning !== null}
              className="rounded-lg bg-zinc-500/10 px-3 py-1.5 text-xs font-medium text-zinc-400 transition-colors hover:bg-zinc-500/20 disabled:opacity-50"
            >
              Dismiss
            </button>
            <button
              type="button"
              onClick={() => void takeAction("delete_mail")}
              disabled={actioning !== null || messages.length === 0}
              className="rounded-lg bg-yellow-500/10 px-3 py-1.5 text-xs font-medium text-yellow-400 transition-colors hover:bg-yellow-500/20 disabled:opacity-50"
            >
              Delete Mail
            </button>
            <button
              type="button"
              onClick={() => void takeAction("warn")}
              disabled={actioning !== null}
              className="rounded-lg bg-blue-500/10 px-3 py-1.5 text-xs font-medium text-blue-400 transition-colors hover:bg-blue-500/20 disabled:opacity-50"
            >
              Warn Sender
            </button>
            <button
              type="button"
              onClick={() => void takeAction("ban")}
              disabled={actioning !== null}
              className="rounded-lg bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/20 disabled:opacity-50"
            >
              Ban Sender
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
