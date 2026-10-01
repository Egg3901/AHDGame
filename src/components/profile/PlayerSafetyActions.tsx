"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

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
  characterId: string;
  characterName: string;
  initiallyBlocked: boolean;
}

/**
 * Report and Block on another player's profile. Reports go to the moderator
 * queue; blocking hides the player's mail and profile content from the viewer
 * and stops them mailing the viewer.
 */
export function PlayerSafetyActions({ characterId, characterName, initiallyBlocked }: Props) {
  const router = useRouter();
  const [blocked, setBlocked] = useState(initiallyBlocked);
  const [reportOpen, setReportOpen] = useState(false);
  const [reason, setReason] = useState("harassment");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  const toggleBlock = async () => {
    if (
      !blocked &&
      !window.confirm(
        `Block ${characterName}? Their mail will be hidden, they will not be able to mail you, and their bio and campaign song will be hidden from you.`
      )
    ) {
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/players/${characterId}/block`, {
        method: blocked ? "DELETE" : "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage({ text: data.error ?? "Something went wrong. Try again.", ok: false });
        return;
      }
      setBlocked(!blocked);
      setMessage({
        text: blocked ? `${characterName} is unblocked.` : `${characterName} is blocked.`,
        ok: true,
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const submitReport = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/players/${characterId}/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason, context: "profile", details: details.trim() || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage({ text: data.error ?? "Could not send the report. Try again.", ok: false });
        return;
      }
      setReportOpen(false);
      setDetails("");
      setMessage({ text: "Thanks. A moderator will review your report.", ok: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setReportOpen((open) => !open)}
          disabled={busy}
          className="rounded-lg border border-card-border px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:text-foreground disabled:opacity-50"
        >
          Report
        </button>
        <button
          type="button"
          onClick={toggleBlock}
          disabled={busy}
          className="rounded-lg border border-error/30 px-3 py-1.5 text-xs font-medium text-error transition-colors hover:bg-error/10 disabled:opacity-50"
        >
          {blocked ? "Unblock" : "Block"}
        </button>
      </div>

      {reportOpen && (
        <form
          onSubmit={submitReport}
          className="space-y-2 rounded-lg border border-card-border p-3"
        >
          <label className="block text-xs font-medium" htmlFor={`report-reason-${characterId}`}>
            What is wrong with {characterName}&apos;s content?
          </label>
          <select
            id={`report-reason-${characterId}`}
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
            maxLength={1000}
            rows={3}
            placeholder="Optional: what you saw and where"
            className="w-full rounded-lg border border-card-border bg-background px-3 py-1.5 text-sm"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50"
            >
              Send report
            </button>
            <button
              type="button"
              onClick={() => setReportOpen(false)}
              className="rounded-lg px-3 py-1.5 text-xs text-muted hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {message && (
        <p className={`text-xs ${message.ok ? "text-success" : "text-error"}`} role="status">
          {message.text}
        </p>
      )}
    </div>
  );
}
