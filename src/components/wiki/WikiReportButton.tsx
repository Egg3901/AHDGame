"use client";

import { useState, type FormEvent } from "react";
import { Button, Modal } from "@/components/ui";
import { WIKI_REPORT_REASONS, type WikiReportReason } from "@/lib/db/types/wikiReport";

const REASON_LABELS: Record<WikiReportReason, string> = {
  stale: "Stale (out of date)",
  incorrect: "Incorrect",
  "update-request": "Update request",
  other: "Other",
};

interface WikiReportButtonProps {
  slug: string;
}

export function WikiReportButton({ slug }: WikiReportButtonProps) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<WikiReportReason>("stale");
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  function close() {
    setOpen(false);
    setStatus("idle");
    setError(null);
    setNote("");
    setReason("stale");
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setStatus("submitting");
    setError(null);
    try {
      const res = await fetch("/api/wiki/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, reason, note: note.trim() }),
      });
      if (res.status === 429) {
        setStatus("error");
        setError("Too many reports from this network. Wait a minute and try again.");
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setStatus("error");
        setError(body?.error ?? "Could not send the report.");
        return;
      }
      setStatus("done");
    } catch {
      setStatus("error");
      setError("Could not send the report.");
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-card-border bg-card/40 px-2.5 py-1 text-muted hover:border-primary/40 hover:text-primary"
      >
        Report page issue
      </button>
      <Modal open={open} onClose={close} title="Report page issue" maxWidthClass="max-w-sm">
        {status === "done" ? (
          <div className="space-y-4">
            <p className="text-sm text-muted">Thanks. We logged the report for this page.</p>
            <Button type="button" variant="secondary" size="sm" onClick={close}>
              Close
            </Button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <p className="text-sm text-muted">
              Tell us what is wrong with <span className="font-medium text-foreground">{slug}</span>
              .
            </p>
            <label className="block text-xs font-medium text-foreground">
              Reason
              <select
                value={reason}
                onChange={(e) => setReason(e.target.value as WikiReportReason)}
                className="mt-1 w-full rounded-md border border-card-border bg-card px-2 py-1.5 text-sm text-foreground"
              >
                {WIKI_REPORT_REASONS.map((value) => (
                  <option key={value} value={value}>
                    {REASON_LABELS[value]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-medium text-foreground">
              Note (optional)
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={2000}
                rows={4}
                className="mt-1 w-full rounded-md border border-card-border bg-card px-2 py-1.5 text-sm text-foreground"
                placeholder="What should change?"
              />
            </label>
            {error && <p className="text-sm text-error">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={close}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={status === "submitting"}>
                {status === "submitting" ? "Sending..." : "Send report"}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}
