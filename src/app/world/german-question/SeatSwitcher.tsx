"use client";

import type { DossierView } from "@/lib/settlement/queries/dossier";

/**
 * Who you are on this board, and which hat you are wearing.
 *
 * This replaces the source design's `YOUR SEAT` chip row, which let the viewer
 * become any of the five delegations at will. That was a preview harness: a
 * British player cannot act as the GDR Staatsrat, and seat identity comes from
 * officeholding, not from a button. The switcher takes the same slot so the
 * layout is unchanged, but it toggles the two budgets an officeholder really
 * has rather than swapping identity.
 *
 * A character with no delegation sees no toggle — only their personal standing.
 */
interface SeatSwitcherProps {
  view: DossierView;
  mode: "seat" | "personal";
  onModeChange: (mode: "seat" | "personal") => void;
}

export function SeatSwitcher({ view, mode, onModeChange }: SeatSwitcherProps) {
  const seat = view.viewer.seat;

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-card-border bg-card px-4 py-3">
      <span className="w-20 shrink-0 font-mono text-body-xs font-semibold tracking-widest text-muted">
        ACTING AS
      </span>

      {seat ? (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onModeChange("seat")}
            aria-pressed={mode === "seat"}
            className={`flex flex-col items-start rounded-md border px-3 py-1.5 text-left ${
              mode === "seat"
                ? "border-gold/55 bg-gold/10 text-foreground"
                : "border-card-border bg-foreground/[0.02] text-muted"
            }`}
          >
            <span className="text-body-sm font-semibold">{seat.name}</span>
            <span className="font-mono text-body-xs tracking-wider">
              {seat.tier} · {seat.multiplier} · {seat.actionsRemaining}/{seat.actionsBankCap} AP
            </span>
          </button>

          <button
            type="button"
            onClick={() => onModeChange("personal")}
            aria-pressed={mode === "personal"}
            className={`flex flex-col items-start rounded-md border px-3 py-1.5 text-left ${
              mode === "personal"
                ? "border-gold/55 bg-gold/10 text-foreground"
                : "border-card-border bg-foreground/[0.02] text-muted"
            }`}
          >
            <span className="text-body-sm font-semibold">Yourself</span>
            <span className="font-mono text-body-xs tracking-wider">
              PERSONAL · 0.25× · {view.viewer.personalActions} AP
            </span>
          </button>
        </div>
      ) : (
        <div className="flex flex-col">
          <span className="text-body-sm font-semibold text-foreground">Yourself</span>
          <span className="font-mono text-body-xs tracking-wider text-muted">
            PERSONAL · 0.25× · {view.viewer.personalActions} AP · no delegation
          </span>
        </div>
      )}

      {seat && mode === "seat" && !seat.canAct && (
        <p className="ml-auto font-mono text-body-xs text-warning">
          {seat.blockedReason === "no-direction"
            ? "Your country is in neither bloc — it has no side to push for."
            : "Your delegation has spent its budget this turn."}
        </p>
      )}
    </div>
  );
}
