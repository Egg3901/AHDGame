/**
 * Caretaker notice for an office held by an acting secretary.
 *
 * The API refuses an acting holder's restricted levers with a 403. Without
 * this the holder would only discover the limit by pressing a button and
 * getting an error, so the office states the rule up front and says what
 * confirmation would unlock.
 */
export function ActingOfficeNotice({
  turnsRemaining,
}: {
  /** Turns left on the appointment, or null when the turn is unknown. */
  turnsRemaining: number | null;
}) {
  return (
    <section
      role="note"
      aria-label="Acting appointment"
      className="rounded-lg border border-warning/30 bg-warning/10 p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded bg-warning/20 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-warning">
          Acting
        </span>
        {/* States a fact about the office rather than addressing the reader:
            this page is also reachable by the head of government, the head of
            state, and admins, none of whom are the acting holder. */}
        <p className="text-sm font-medium text-foreground">
          This department is being run by an acting secretary.
        </p>
      </div>
      <p className="mt-2 text-sm text-muted">
        Day to day work continues as normal: deployments, recruitment, standing orders, and funding
        for projects already under way. Setting department policy or budget allocations, appointing
        or dismissing personnel, adopting doctrine or nuclear programmes, and opening new estates,
        infrastructure, or energy projects all need a confirmed secretary, so those controls will be
        refused until the Senate confirms one.
      </p>
      {turnsRemaining !== null && (
        <p className="mt-2 text-sm text-muted">
          {turnsRemaining > 0
            ? `${turnsRemaining} turns remain before this appointment lapses. Senate confirmation ends it early and lifts every limit above.`
            : "This appointment lapses at the next turn."}
        </p>
      )}
    </section>
  );
}
