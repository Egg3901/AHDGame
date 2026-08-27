/**
 * How long this office stays in caretaker hands.
 *
 * Complements `ActingLock`, which disables the individual levers and says why.
 * That covers WHAT an acting secretary cannot do; this covers how long they
 * remain one, which no lock can express because it is a property of the
 * appointment rather than of any control.
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
      {turnsRemaining !== null && (
        <p className="mt-2 text-sm text-muted">
          {turnsRemaining > 0
            ? `${turnsRemaining} turns remain before this appointment lapses, and the locked controls below stay locked until then. Senate confirmation ends it early and lifts every one of them.`
            : "This appointment lapses at the next turn."}
        </p>
      )}
    </section>
  );
}
