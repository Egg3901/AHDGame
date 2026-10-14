"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { apiErrorText } from "@/lib/errors/catalog";

const REASONS: { value: string; label: string }[] = [
  { value: "harassment", label: "Harassment or bullying" },
  { value: "hate", label: "Hate speech" },
  { value: "sexual", label: "Sexual content" },
  { value: "violence", label: "Violence or threats" },
  { value: "spam", label: "Spam or scams" },
  { value: "impersonation", label: "Impersonation" },
  { value: "other", label: "Something else" },
];

interface Props {
  issueNumber: number;
  /** Report one reply instead of the suggestion. */
  commentId?: string;
  /** Open the form on mount (the Discord post links to `?report=1`). */
  initiallyOpen?: boolean;
}

/** Report a suggestion or reply to the moderator queue. */
export function SuggestionReportButton({ issueNumber, commentId, initiallyOpen }: Props) {
  const id = useId();
  const router = useRouter();
  // Remount with a new `key` to apply a changed `initiallyOpen`.
  const [open, setOpen] = useState(!!initiallyOpen);
  const [reason, setReason] = useState("spam");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/suggestions/public/${issueNumber}/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason, details: details.trim() || undefined, commentId }),
      });
      if (res.status === 401) {
        router.push("/login");
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage({
          text: apiErrorText(data, "Could not send the report. Try again."),
          ok: false,
        });
        return;
      }
      setOpen(false);
      setDetails("");
      setMessage({ text: "Thanks. A moderator will review it.", ok: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-muted transition-colors hover:bg-card-elevated hover:text-foreground"
      >
        <svg
          className="h-3.5 w-3.5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          aria-hidden
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M3 21V4m0 0h13l-2 4 2 4H3"
          />
        </svg>
        Report
      </button>
      {message && !open && (
        <p className={`mt-1 text-xs ${message.ok ? "text-success" : "text-error"}`} role="status">
          {message.text}
        </p>
      )}
      {open && (
        <form
          onSubmit={submit}
          className="absolute right-0 z-20 mt-2 w-72 space-y-2 rounded-xl border border-card-border bg-card-elevated p-3 shadow-lg"
        >
          <label className="block text-xs font-semibold" htmlFor={`${id}-reason`}>
            {commentId ? "What is wrong with this reply?" : "What is wrong with this suggestion?"}
          </label>
          <select
            id={`${id}-reason`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="w-full rounded-lg border border-card-border bg-background px-3 py-1.5 text-sm"
          >
            {REASONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
          <textarea
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            maxLength={900}
            rows={3}
            placeholder="Optional: anything a moderator should know"
            className="w-full rounded-lg border border-card-border bg-background px-3 py-1.5 text-sm"
          />
          {message && !message.ok && (
            <p className="text-xs text-error" role="status">
              {message.text}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg px-3 py-1.5 text-xs text-muted hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50"
            >
              Send report
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
