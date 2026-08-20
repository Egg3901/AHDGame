import type { DossierView } from "@/lib/settlement/queries/dossier";

/**
 * The five rungs, and who may climb them.
 *
 * DISPLAY-ONLY THIS PHASE. Arming and declaring are Phase 5, so the control
 * renders disabled with an explanation rather than pretending to work — a
 * button that silently does nothing is worse than one that says why.
 */
export function EscalationLadder({ view }: { view: DossierView }) {
  const seat = view.viewer.seat;
  return (
    <section className="rounded-xl border border-warning/40 bg-warning/[0.05] p-4">
      <h2 className="mb-3 font-mono text-body-xs font-bold tracking-wider text-gold-muted">
        ESCALATION LADDER · DEFCON {view.defcon}
      </h2>

      <ol className="flex flex-col">
        {[...view.ladder].reverse().map((rung) => (
          <li key={rung.num} className="flex items-center gap-2.5 py-1.5">
            <span
              className={`w-3.5 text-center font-mono text-body-sm font-bold ${
                rung.here ? "text-warning" : rung.passed ? "text-muted" : "text-muted/60"
              }`}
            >
              {rung.num}
            </span>
            <span
              aria-hidden
              className={`size-2.5 shrink-0 rounded-full border-2 ${
                rung.here
                  ? "border-warning bg-warning shadow-glow-sm"
                  : rung.passed
                    ? "border-muted bg-muted/40"
                    : "border-card-border bg-background"
              }`}
            />
            <span
              className={`leading-snug ${
                rung.here
                  ? "text-body-sm font-bold text-foreground"
                  : rung.passed
                    ? "text-body-xs text-muted"
                    : "text-body-xs text-muted/70"
              }`}
            >
              {rung.label}
            </span>
            {rung.here && (
              <span className="ml-auto shrink-0 font-mono text-body-xs font-semibold text-warning">
                ◀ HERE
              </span>
            )}
          </li>
        ))}
      </ol>

      {seat?.canEscalate ? (
        <button
          type="button"
          disabled
          title="Arming and declaring arrive with the war phase."
          className="mt-3 w-full cursor-not-allowed rounded-md border border-warning/40 bg-warning/[0.07] p-2.5 font-mono text-body-xs font-semibold tracking-wider text-warning opacity-60"
        >
          ▲ FORCE THE ISSUE — ESCALATE
        </button>
      ) : (
        <p className="mt-3 rounded-md border border-dashed border-card-border p-3 font-mono text-body-xs leading-relaxed text-muted">
          NO ESCALATION AUTHORITY — {seat?.escalateGate ?? "only a delegation may take the ladder."}
        </p>
      )}

      <p className="mt-2.5 font-mono text-body-xs leading-relaxed text-gold-muted">
        At rung 5 the influence contest closes and a NATO–Warsaw Pact conflict opens on the
        Conflicts board. The settlement goes to whoever wins it.
      </p>
    </section>
  );
}
