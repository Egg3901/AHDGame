"use client";

import type { DossierInstitutionView } from "@/lib/settlement/queries/dossier";
import { PlayButton } from "./PlayButton";
import { SplitBar } from "./SplitBar";

/**
 * One contested institution.
 *
 * The subtitle is LIVE — the Bundestag counts its seated parties rather than
 * printing the mockup's 496, and the Länder counts its state governments.
 */
interface InstitutionCardProps {
  institution: DossierInstitutionView;
  /** Which catalogue the viewer is currently acting from. */
  mode: "seat" | "personal";
  seatName: string | null;
  onCommitted: () => void;
}

export function InstitutionCard({
  institution,
  mode,
  seatName,
  onCommitted,
}: InstitutionCardProps) {
  const driftTone =
    institution.driftDirection === "east"
      ? "text-error"
      : institution.driftDirection === "west"
        ? "text-info"
        : "text-muted";
  const actorLabel = mode === "seat" && seatName ? seatName : "YOU";
  // Only the catalogue the viewer is currently acting from. Offering the other
  // one would render buttons the command refuses 403 every time.
  const plays = institution.plays.filter((p) => p.actor === mode);
  const cap = institution.personalCap;
  // The cap governs the open floor's push, so its usage reads in the same
  // direction colours as everything else: east is error, west is info.
  const capTone =
    cap && cap.netPoints > 0 ? "text-error" : cap && cap.netPoints < 0 ? "text-info" : "text-muted";

  return (
    <section className="flex flex-col overflow-hidden rounded-lg border border-card-border bg-background">
      <header className="border-b border-card-border px-4 pb-3 pt-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-serif text-heading-sm font-bold text-foreground">
            {institution.name}
          </h2>
          <span className="rounded border border-gold/35 px-1.5 py-0.5 font-mono text-body-xs font-bold tracking-widest text-gold">
            {institution.weightTag}
          </span>
        </div>
        <p className="mt-1 font-mono text-body-xs text-muted">{institution.subtitle}</p>

        <div className="mt-3">
          <SplitBar eastPct={institution.eastPct} height="md" />
        </div>
        {/* Two rows, at every width. These cards go two-up from 640px, so the
            card is narrow almost everywhere — as one wrapping three-column row
            the drift note ended up beside the NATO figure with the PACT figure
            orphaned below, reading as though the drift belonged to one side. */}
        <div className="mt-2 flex items-baseline justify-between gap-2">
          <span className="font-mono text-body-sm font-bold text-info">
            {institution.westPct}% NATO
          </span>
          <span className="font-mono text-body-sm font-bold text-error">
            {institution.eastPct}% PACT
          </span>
        </div>
        <div className={`mt-1 font-mono text-body-xs font-semibold ${driftTone}`}>
          {institution.driftNote}
        </div>
      </header>

      <div className="flex flex-1 flex-col gap-2 px-4 pb-4 pt-3">
        {cap && (
          <div data-testid="open-floor-cap" aria-live="polite">
            <div
              className={`flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 font-mono text-body-xs ${
                cap.maxed
                  ? "border-warning/40 bg-warning/[0.05]"
                  : "border-card-border bg-card-muted"
              }`}
            >
              <span className="tracking-widest text-muted">OPEN FLOOR CAP</span>
              <span className="flex items-center gap-1.5">
                <span className={`font-bold ${capTone}`}>
                  {cap.netPoints >= 0 ? "+" : ""}
                  {cap.netPoints.toFixed(2)} / ±{cap.capPoints.toFixed(2)}
                </span>
                {cap.maxed && (
                  <span className="rounded border border-warning/40 px-1 font-bold tracking-widest text-warning">
                    MAXED
                  </span>
                )}
              </span>
            </div>
            {cap.maxed && (
              <p className="mt-1 font-mono text-body-xs leading-relaxed text-warning">
                The open floor has reached its limit on this category for this turn. Further
                personal plays cost their action point but move nothing here until the next tick.
              </p>
            )}
          </div>
        )}
        <p className="font-mono text-body-xs tracking-widest text-muted">
          PLAYS OPEN TO {actorLabel} HERE
        </p>
        {plays.map((play) => (
          <PlayButton key={play.id} play={play} onCommitted={onCommitted} />
        ))}
        {plays.length === 0 && (
          <p className="rounded-md border border-dashed border-card-border p-3 font-mono text-body-xs leading-relaxed text-muted">
            No play here from this seat — {institution.gateNote}
          </p>
        )}
      </div>

      <footer className="flex flex-wrap gap-2 border-t border-card-border bg-card-muted px-4 py-2.5 font-mono text-body-xs text-muted">
        <span>
          held by{" "}
          <span className={institution.holder === "PACT" ? "text-error" : "text-info"}>
            {institution.holder}
          </span>
        </span>
        {institution.lastPlayLabel && (
          <>
            <span aria-hidden>·</span>
            <span>{institution.lastPlayLabel}</span>
          </>
        )}
      </footer>
    </section>
  );
}
