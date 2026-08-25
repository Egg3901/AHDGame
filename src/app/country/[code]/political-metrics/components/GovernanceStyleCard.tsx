import type { DemocraticCompetition } from "@/lib/governanceStyle/competition";
import { governanceStyleFlavor } from "@/lib/governanceStyle/flavor";
import type { GovernanceStyleAxis, GovernanceStyleScore } from "@/lib/governanceStyle/score";
import { scoreTone } from "./tones";

function BalanceRail({
  description,
  axis,
  low,
  high,
  accentClass,
  markerClass,
  trackClass,
}: {
  description: string;
  axis: GovernanceStyleAxis;
  low: string;
  high: string;
  accentClass: string;
  markerClass: string;
  trackClass: string;
}) {
  return (
    <div>
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="font-mono text-body-xs uppercase tracking-[0.18em] text-muted">
            {description}
          </div>
          <div className={`mt-1 font-display text-heading font-semibold ${accentClass}`}>
            {axis.label}
          </div>
        </div>
        <div className="font-mono text-heading-lg font-semibold tabular-nums text-foreground">
          {Math.round(axis.value)}
        </div>
      </div>

      <div className="mt-3">
        <div className="relative h-3 rounded-full bg-background/80 ring-1 ring-card-border">
          <div
            className={`absolute inset-x-1 top-1/2 h-1 -translate-y-1/2 rounded-full ${trackClass}`}
          />
          <span
            className={`absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-card shadow-card ${markerClass}`}
            style={{ left: `${axis.value}%` }}
          >
            <span className="sr-only">{axis.label}</span>
          </span>
        </div>
        <div className="mt-2 flex justify-between font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
          <span>{low}</span>
          <span>{high}</span>
        </div>
      </div>
    </div>
  );
}

function governmentStatus(competition: DemocraticCompetition) {
  if (competition.executiveAlignedWithLegislature === true) {
    return "Aligned presidency";
  }
  if (competition.executiveAlignedWithLegislature === false) {
    return "Divided government";
  }
  return "Parliamentary government";
}

function continuityStatus(competition: DemocraticCompetition) {
  if (competition.executiveAlignedWithLegislature !== null) {
    const terms = competition.consecutiveExecutiveTerms;
    return terms > 0 ? `${terms} executive ${terms === 1 ? "term" : "terms"}` : "New executive";
  }
  return competition.uninterruptedControlTurns > 0
    ? `${competition.uninterruptedControlTurns} turns of chamber lead`
    : "No recorded streak";
}

function PowerBalance({ competition }: { competition: DemocraticCompetition }) {
  const chamberScope =
    competition.chambersMeasured === 1
      ? "elected chamber"
      : `${competition.chambersMeasured} elected chambers`;

  return (
    <div className="border-t border-card-border bg-background/30 px-4 py-4 sm:px-5">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <div className="font-mono text-body-xs uppercase tracking-[0.18em] text-muted">
            Balance of power
          </div>
          <p className="mt-1 text-body-sm text-muted">
            Concentrated control can hollow out an otherwise healthy democracy over time.
          </p>
        </div>
        <div className="rounded-full border border-card-border bg-card px-3 py-1 font-mono text-body-xs tabular-nums text-muted">
          {competition.penalty > 0 ? `−${competition.penalty.toFixed(1)} health` : "No pressure"}
        </div>
      </div>

      <div className="mt-4 grid gap-px overflow-hidden rounded-md border border-card-border bg-card-border sm:grid-cols-2 xl:grid-cols-4">
        <div className="bg-card px-3 py-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted">
            Chambers
          </div>
          <div className="mt-1 text-body-lg font-semibold tabular-nums text-foreground">
            {competition.dominantSeatShare.toFixed(1)}%
          </div>
          <div className="mt-1 text-body-xs text-muted">Largest party across {chamberScope}</div>
        </div>
        <div className="bg-card px-3 py-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted">
            Government
          </div>
          <div className="mt-1 text-body-lg font-semibold text-foreground">
            {governmentStatus(competition)}
          </div>
          <div className="mt-1 text-body-xs text-muted">Executive and legislature status</div>
        </div>
        <div className="bg-card px-3 py-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted">
            Continuity
          </div>
          <div className="mt-1 text-body-lg font-semibold text-foreground">
            {continuityStatus(competition)}
          </div>
          <div className="mt-1 text-body-xs text-muted">Same governing settlement</div>
        </div>
        <div className="bg-card px-3 py-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted">
            Institutional cost
          </div>
          <div className="mt-1 text-body-lg font-semibold tabular-nums text-foreground">
            −{competition.penalty.toFixed(1)}
          </div>
          <div className="mt-1 text-body-xs text-muted">Democratic-health pressure</div>
        </div>
      </div>

      <p className="mt-3 text-body-xs leading-relaxed text-muted">
        Chamber margins: −{competition.seatMarginPenalty.toFixed(1)}. Legislative continuity: −
        {competition.legislativeContinuityPenalty.toFixed(1)}. Executive continuity: −
        {competition.executiveContinuityPenalty.toFixed(1)}.
      </p>
    </div>
  );
}

/** A game-facing national-spirit dossier, not a generic metrics chart. */
export function GovernanceStyleCard({ score }: { score: GovernanceStyleScore }) {
  const flavor = governanceStyleFlavor(score);
  const healthTone = scoreTone(score.democraticHealth.value);

  return (
    <section
      className="overflow-hidden rounded-xl border border-card-border bg-card shadow-card"
      aria-labelledby="governance-style-heading"
    >
      <div className="relative overflow-hidden border-b border-card-border bg-gradient-to-br from-primary/15 via-card to-secondary/10 px-4 py-5 sm:px-5">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold/80 to-transparent" />
        <div className="relative grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(420px,1.1fr)] lg:items-end">
          <div>
            <div className="flex flex-wrap items-center gap-2 font-mono text-body-xs uppercase tracking-[0.18em] text-muted">
              <span>National spirit</span>
              <span className="h-1 w-1 rounded-full bg-gold" />
              <span>Liberal democracy</span>
            </div>
            <h2
              id="governance-style-heading"
              className="mt-3 font-display text-heading-lg font-bold leading-tight text-foreground"
            >
              {flavor.headline}
            </h2>
            <p className="mt-2 max-w-xl text-body text-muted">{flavor.institutionalSigns[0]}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <span className="rounded-full border border-card-border bg-card/80 px-3 py-1 font-mono text-body-xs text-muted">
                Political character: {flavor.politicalHeadline}
              </span>
              <span
                className={`rounded-full border border-card-border bg-card/80 px-3 py-1 font-mono text-body-xs ${healthTone.text}`}
              >
                {score.democraticHealth.label}
              </span>
            </div>
          </div>

          <div className="grid gap-5 rounded-lg border border-card-border bg-card/70 p-4 shadow-card">
            <BalanceRail
              description="Political direction"
              axis={score.leftRight}
              low="Left"
              high="Right"
              accentClass="text-primary"
              markerClass="bg-primary"
              trackClass="bg-gradient-to-r from-secondary via-muted/40 to-primary"
            />
            <BalanceRail
              description="Democratic health"
              axis={score.democraticHealth}
              low="Failed state"
              high="Healthy democracy"
              accentClass={healthTone.text}
              markerClass={healthTone.bg}
              trackClass="bg-gradient-to-r from-error via-warning to-success"
            />
          </div>
        </div>
      </div>

      {score.competition && <PowerBalance competition={score.competition} />}

      <div className="grid gap-4 px-4 py-4 sm:px-5 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.72fr)]">
        <div>
          <div className="font-mono text-body-xs uppercase tracking-[0.18em] text-muted">
            The institutional assessment
          </div>
          <p className="mt-2 text-body-sm leading-relaxed text-muted">
            {flavor.institutionalNarrative}
          </p>
        </div>
        <div className="rounded-md border border-card-border bg-background/30 p-3">
          <div className="font-mono text-body-xs uppercase tracking-[0.18em] text-muted">
            What this means
          </div>
          <p className="mt-2 text-body-sm leading-relaxed text-muted">
            Left and right describe political direction, not quality. Democratic health reflects
            whether institutions can constrain power, survive scandal, and hand authority over
            peacefully.
          </p>
        </div>
      </div>
    </section>
  );
}
