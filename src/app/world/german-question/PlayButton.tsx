"use client";

import { useState } from "react";
import type { DossierPlayView } from "@/lib/settlement/queries/dossier";

/**
 * One committable play.
 *
 * Shows the EFFECTIVE swing — magnitude × the actor's multiplier — with the
 * basis beneath it. The source mockup showed the base figure and the multiplier
 * separately, which reads identically at 1.0× and understates every GDR play by
 * half at 2.0×; the number on the button is now the number that happens.
 *
 * A personal play chooses its own side, so it renders two commit buttons rather
 * than one. A seat play's side is its country's bloc and is decided server-side.
 */
interface PlayButtonProps {
  /** Carries its own `actor` — the button never guesses which catalogue it is. */
  play: DossierPlayView;
  onCommitted: () => void;
}

const REASON_COPY: Record<string, string> = {
  actions: "No action points left this turn.",
  capital: "Not enough capital banked.",
  funds: "The treasury cannot cover this.",
  "no-direction": "Your country belongs to neither bloc.",
};

export function PlayButton({ play, onCommitted }: PlayButtonProps) {
  const actor = play.actor;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const commit = async (direction?: 1 | -1) => {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/world/german-question/play", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ actor, playId: play.id, direction }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "That play could not be committed.");
        return;
      }
      onCommitted();
    } catch {
      setError("The play could not be sent. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  };

  const disabled = pending || !play.affordable;
  const blockedCopy = play.blockedReason
    ? (REASON_COPY[play.blockedReason] ?? play.blockedReason)
    : null;
  const swingTone = play.effectivePoints >= 0 ? "text-error" : "text-info";
  const tagTone = play.danger ? "text-warning" : "text-muted";

  return (
    <div className="flex flex-col gap-1">
      <div
        className={`flex w-full items-center gap-2.5 rounded-md border border-card-border bg-foreground/[0.02] px-3 py-2.5 ${
          disabled ? "opacity-55" : ""
        }`}
      >
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-body-sm font-semibold text-foreground">{play.name}</span>
          <span className="font-mono text-body-xs text-muted">{play.costLabel}</span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-0.5 text-right">
          <span className={`font-mono text-body-sm font-bold ${swingTone}`}>
            {actor === "personal" ? "±" : play.effectivePoints >= 0 ? "+" : ""}
            {Math.abs(play.effectivePoints).toFixed(1)}
          </span>
          <span className={`font-mono text-body-xs tracking-wider ${tagTone}`}>{play.tag}</span>
        </span>
      </div>

      {/* Wraps rather than squeezing: at 375 the basis label and both direction
          buttons do not fit on one line, and shrinking the buttons to fit is
          how they ended up below a usable tap size in the first place. */}
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-2 pl-1">
        <span className="font-mono text-body-xs text-muted">{play.basisLabel}</span>
        <span className="ml-auto flex gap-1.5">
          {actor === "personal" ? (
            <>
              <button
                type="button"
                disabled={disabled}
                onClick={() => void commit(-1)}
                className="min-h-11 min-w-16 rounded border border-info/40 px-3 font-mono text-body-xs text-info hover:bg-info/10 disabled:cursor-not-allowed disabled:opacity-50"
                title={blockedCopy ?? "Push toward NATO"}
              >
                {pending ? "…" : "NATO"}
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={() => void commit(1)}
                className="min-h-11 min-w-16 rounded border border-error/40 px-3 font-mono text-body-xs text-error hover:bg-error/10 disabled:cursor-not-allowed disabled:opacity-50"
                title={blockedCopy ?? "Push toward reunification"}
              >
                {pending ? "…" : "PACT"}
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={disabled}
              onClick={() => void commit()}
              className="min-h-11 rounded border border-gold/40 px-3 font-mono text-body-xs text-gold hover:bg-gold/10 disabled:cursor-not-allowed disabled:opacity-50"
              title={blockedCopy ?? play.detail}
            >
              {pending ? "COMMITTING…" : "COMMIT"}
            </button>
          )}
        </span>
      </div>

      {blockedCopy && !play.affordable && (
        <p className="pl-1 font-mono text-body-xs text-muted">{blockedCopy}</p>
      )}
      {error && (
        <p role="alert" className="pl-1 font-mono text-body-xs text-error">
          {error}
        </p>
      )}
    </div>
  );
}
