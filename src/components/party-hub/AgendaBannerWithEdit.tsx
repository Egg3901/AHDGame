"use client";

import { useState } from "react";
import { AgendaBanner } from "./AgendaBanner";
import { useAgenda } from "./useAgenda";

/**
 * Self-contained agenda banner widget for the Party Hub. Fetches the
 * active agenda via `useAgenda`; for chair viewers, exposes an inline
 * edit form that POSTs to the chair-only API.
 *
 * Renders nothing when no agenda is set AND viewer is not editable.
 * (Editable chairs see an empty-state "Set agenda" button.)
 */
export function AgendaBannerWithEdit({
  countryCode,
  partyId,
  partyAbbreviation,
  partyColor,
  canEdit,
}: {
  countryCode: string;
  partyId: string;
  partyAbbreviation?: string;
  partyColor?: string;
  canEdit: boolean;
}) {
  const { agenda, refresh } = useAgenda(countryCode, partyId);
  const [editing, setEditing] = useState(false);
  const [headline, setHeadline] = useState("");
  const [detail, setDetail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!agenda && !canEdit) return null;

  if (editing) {
    const handleSubmit = async () => {
      setSubmitting(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/country/${countryCode.toLowerCase()}/parties/${encodeURIComponent(partyId)}/agenda`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ headline, detail }),
          }
        );
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setError(data?.error ?? `HTTP ${res.status}`);
          return;
        }
        setEditing(false);
        setHeadline("");
        setDetail("");
        refresh();
      } finally {
        setSubmitting(false);
      }
    };

    return (
      <div className="rounded-xl border border-card-border bg-card p-4 shadow-sm space-y-2">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted">
          {partyAbbreviation
            ? `${partyAbbreviation} National Agenda — Edit`
            : "National Agenda — Edit"}
        </div>
        <input
          type="text"
          value={headline}
          onChange={(e) => setHeadline(e.target.value)}
          placeholder={agenda?.headline ?? "Set the National Agenda headline"}
          className="w-full rounded-md border border-card-border bg-background px-2 py-1.5 text-sm"
          maxLength={120}
        />
        <textarea
          value={detail}
          onChange={(e) => setDetail(e.target.value)}
          placeholder={agenda?.detail ?? "Optional detail explaining the agenda."}
          className="w-full rounded-md border border-card-border bg-background px-2 py-1.5 text-xs"
          rows={2}
          maxLength={500}
        />
        {error ? <p className="text-xs text-red-500">{error}</p> : null}
        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="rounded-md border border-card-border px-3 py-1 text-xs"
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || !headline.trim()}
            className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
          >
            {submitting ? "Saving…" : "Save Agenda"}
          </button>
        </div>
      </div>
    );
  }

  if (!agenda && canEdit) {
    return (
      <div className="rounded-xl border border-dashed border-card-border bg-card p-4 shadow-sm flex items-center justify-between gap-2">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted">
            {partyAbbreviation ? `${partyAbbreviation} National Agenda` : "National Agenda"}
          </div>
          <p className="text-xs text-muted mt-0.5">No active agenda. Chairs can set one.</p>
        </div>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="shrink-0 rounded-md border border-card-border px-2 py-1 text-[10px] font-medium uppercase tracking-wider hover:bg-[var(--card-muted)]"
        >
          Set Agenda
        </button>
      </div>
    );
  }

  return (
    <AgendaBanner
      headline={agenda?.headline ?? null}
      detail={agenda?.detail}
      partyAbbreviation={partyAbbreviation}
      partyColor={partyColor}
      editable={canEdit}
      onEdit={() => setEditing(true)}
    />
  );
}
