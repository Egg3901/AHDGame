/**
 * National Agenda banner — appears on 4 surfaces per Phase 3 acceptance:
 *  - National Party Hub
 *  - State Party Hub
 *  - State Politics tab
 *  - Down-Ballot / tier-selector context (Primary + General screens)
 *
 * Chair-set headline + detail. Read-only for non-chair viewers — the
 * `editable` prop controls whether the "Edit" affordance shows up.
 * Per Phase 3 D4: one active agenda at a time; setting a new one
 * supersedes the old.
 *
 * Renders nothing when no agenda is set (`headline === null`).
 */
export function AgendaBanner({
  headline,
  detail,
  partyAbbreviation,
  partyColor,
  editable = false,
  onEdit,
}: {
  headline: string | null;
  detail?: string;
  partyAbbreviation?: string;
  partyColor?: string;
  editable?: boolean;
  onEdit?: () => void;
}) {
  if (!headline) return null;

  const accentColor = partyColor ?? "var(--primary)";

  return (
    <div
      className="rounded-xl border border-card-border bg-card p-4 shadow-sm flex items-start gap-3"
      style={{ borderLeftColor: accentColor, borderLeftWidth: 4 }}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted">
          {partyAbbreviation ? `${partyAbbreviation} National Agenda` : "National Agenda"}
        </div>
        <p className="text-sm font-semibold leading-snug truncate">{headline}</p>
        {detail ? <p className="mt-1 text-xs text-muted leading-snug">{detail}</p> : null}
      </div>
      {editable && onEdit ? (
        <button
          type="button"
          onClick={onEdit}
          className="ml-2 shrink-0 rounded-md border border-card-border px-2 py-1 text-[10px] font-medium uppercase tracking-wider hover:bg-[var(--card-muted)]"
        >
          Edit
        </button>
      ) : null}
    </div>
  );
}
