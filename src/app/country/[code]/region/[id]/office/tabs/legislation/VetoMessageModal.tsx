"use client";

import { useState } from "react";
import { VETO_MESSAGE_MIN_LENGTH, VETO_MESSAGE_MAX_LENGTH } from "@/lib/constants/governorOffice";

interface Props {
  open: boolean;
  billTitle: string;
  endpointUrl: string;
  /**
   * The base body merged with `{ vetoMessage }`. Defaults to `{ action: "vetoed" }`
   * (state-bill governor-action shape). Federal/presidential callers pass
   * `{ action: "presidential_action", decision: "veto" }`.
   */
  basePayload?: Record<string, unknown>;
  onClose: () => void;
  onSuccess: () => void;
}

export function VetoMessageModal({
  open,
  billTitle,
  endpointUrl,
  basePayload,
  onClose,
  onSuccess,
}: Props) {
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const trimmedLength = message.trim().length;
  const canSubmit =
    trimmedLength >= VETO_MESSAGE_MIN_LENGTH && trimmedLength <= VETO_MESSAGE_MAX_LENGTH;

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const payload = { ...(basePayload ?? { action: "vetoed" }), vetoMessage: message.trim() };
      const res = await fetch(endpointUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error ?? "Veto failed.");
        setSubmitting(false);
        return;
      }
      onSuccess();
    } catch {
      setError("Network error.");
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="veto-modal-title"
    >
      <div className="w-full max-w-lg rounded-2xl border border-card-border bg-card p-6 shadow-modal">
        <h2 id="veto-modal-title" className="text-lg font-semibold mb-1">
          Veto &ldquo;{billTitle}&rdquo;
        </h2>
        <p className="text-sm text-muted mb-4">
          A public message is required. It will appear in the news feed and on the bill page.
        </p>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          maxLength={VETO_MESSAGE_MAX_LENGTH}
          rows={4}
          className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm"
          placeholder="Why are you vetoing this bill?"
          disabled={submitting}
          aria-label="Veto message"
        />
        <div className="mt-1 flex justify-between text-xs text-muted">
          <span>
            {trimmedLength < VETO_MESSAGE_MIN_LENGTH
              ? `Minimum ${VETO_MESSAGE_MIN_LENGTH} characters`
              : "Ready"}
          </span>
          <span>
            {trimmedLength}/{VETO_MESSAGE_MAX_LENGTH}
          </span>
        </div>
        {error && <p className="mt-3 text-sm text-error">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={submitting}
            className="rounded-lg px-3 py-1.5 text-sm text-muted hover:bg-background/60"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!canSubmit || submitting}
            className="rounded-lg bg-error px-3 py-1.5 text-sm font-medium text-white hover:bg-error/80 disabled:opacity-50"
          >
            {submitting ? "Vetoing…" : "Veto with message"}
          </button>
        </div>
      </div>
    </div>
  );
}
