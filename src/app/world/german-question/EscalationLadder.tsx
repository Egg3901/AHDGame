"use client";

import { useState } from "react";
import type { DossierView } from "@/lib/settlement/queries/dossier";

/**
 * The five rungs, and who may climb them.
 *
 * Force the Issue ARMS the ladder; it does not declare. Declaring the war is a
 * second, separate act and arrives with the war phase — so the armed state
 * renders as a standing cost and a live warning rather than a button that
 * quietly does nothing.
 */
export function EscalationLadder({ view, onArmed }: { view: DossierView; onArmed: () => void }) {
  const seat = view.viewer.seat;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const post = async (path: "escalate" | "declare", fallback: string) => {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/world/german-question/${path}`, { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? fallback);
        return;
      }
      onArmed();
    } catch {
      setError("The order could not be sent. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  };

  const arm = () => post("escalate", "The ladder could not be forced.");
  const declare = () => post("declare", "The declaration could not be sent.");
  // Switched off by an admin: the rungs still render, greyed, so the shape of
  // the thing that is unavailable stays legible. A hidden ladder would read as
  // a page that forgot to load.
  const off = !view.rules.escalationEnabled;
  return (
    <section
      className={`rounded-xl border p-4 ${
        off ? "border-card-border bg-card-muted/40" : "border-warning/40 bg-warning/[0.05]"
      }`}
    >
      <h2 className="mb-3 font-mono text-body-xs font-bold tracking-wider text-gold-muted">
        ESCALATION LADDER · {off ? "STOOD DOWN" : `DEFCON ${view.defcon}`}
      </h2>

      <ol className={`flex flex-col ${off ? "opacity-50" : ""}`}>
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

      {view.armed && (
        <p className="mt-3 rounded-md border border-warning/50 bg-warning/10 p-3 font-mono text-body-xs leading-relaxed text-warning">
          ARMED · DEFCON 1. Every delegation&apos;s country is paying a mobilisation levy each turn
          it stands here. Let the heat decay and the ladder steps back down.
        </p>
      )}

      {off ? (
        <p className="mt-3 rounded-md border border-dashed border-card-border p-3 font-mono text-body-xs leading-relaxed text-muted">
          LADDER STOOD DOWN —{" "}
          {seat?.escalateGate ?? "escalation is switched off for this question."}
        </p>
      ) : seat?.canEscalate ? (
        view.armed ? (
          // The SECOND press. Deliberately a separate control with its own copy
          // rather than the same button relabelled: arming can be walked back by
          // letting the heat decay, and this cannot be walked back at all.
          <button
            type="button"
            disabled={pending}
            onClick={() => void declare()}
            title="Open the war. The influence contest closes and the settlement goes to whoever wins."
            className="mt-3 w-full rounded-md border border-error bg-error/15 p-2.5 font-mono text-body-xs font-bold tracking-wider text-error hover:bg-error/25 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? "DECLARING…" : "☢ DECLARE — OPEN THE WAR"}
          </button>
        ) : (
          <button
            type="button"
            disabled={pending || !seat.canArmNow}
            onClick={() => void arm()}
            title={
              seat.canArmNow
                ? "Take the ladder to rung 5. This arms a declaration and starts the levy."
                : "The ladder must reach rung 4 on coercive plays before it can be forced."
            }
            className="mt-3 w-full rounded-md border border-warning/40 bg-warning/[0.07] p-2.5 font-mono text-body-xs font-semibold tracking-wider text-warning hover:bg-warning/[0.14] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? "FORCING…" : "▲ FORCE THE ISSUE — ESCALATE"}
          </button>
        )
      ) : (
        <p className="mt-3 rounded-md border border-dashed border-card-border p-3 font-mono text-body-xs leading-relaxed text-muted">
          NO ESCALATION AUTHORITY — {seat?.escalateGate ?? "only a delegation may take the ladder."}
        </p>
      )}

      {error && (
        <p role="alert" className="mt-2 font-mono text-body-xs text-error">
          {error}
        </p>
      )}

      <p className="mt-2.5 font-mono text-body-xs leading-relaxed text-gold-muted">
        {off
          ? "While the ladder is stood down, coercive plays land as ordinary plays and leave no heat. The question can only be settled on the index."
          : "At rung 5 the influence contest closes and a NATO–Warsaw Pact conflict opens on the Conflicts board. The settlement goes to whoever wins it."}
      </p>
    </section>
  );
}
