import type { DemocraticCompetition } from "@/lib/governanceStyle/competition";
import { governanceStyleFlavor } from "@/lib/governanceStyle/flavor";
import type { GovernanceStyleAxis, GovernanceStyleScore } from "@/lib/governanceStyle/score";
import { sentenceCase } from "./labels";
import { healthTone } from "./tones";

const MINUS = "−";

/**
 * One governance measure: its name, its label and score, and a neutral track
 * with a single marker between the two named poles. No gradient: the marker
 * and value take a colour only when the caller passes one that means something.
 */
function Measure({
  name,
  axis,
  low,
  high,
  valueClass,
  markerClass,
  note,
}: {
  name: string;
  axis: GovernanceStyleAxis;
  low: string;
  high: string;
  valueClass: string;
  markerClass: string;
  note?: string;
}) {
  const value = Math.round(axis.value);
  const position = Math.max(0, Math.min(100, axis.value));
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <dt className="text-body text-muted">{name}</dt>
        <dd className={`text-body-lg font-semibold ${valueClass}`}>
          {axis.label} <span className="tabular-nums">{value}</span>
        </dd>
      </div>
      <dd className="mt-3">
        <div
          role="img"
          aria-label={`${value} on a scale from ${low} at 0 to ${high} at 100`}
          className="relative h-1 rounded-full bg-card-border"
        >
          <span
            aria-hidden="true"
            className={`absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-background ${markerClass}`}
            style={{ left: `${position}%` }}
          />
        </div>
        <div aria-hidden="true" className="mt-2 flex justify-between gap-4 text-body-sm text-muted">
          <span>{low}</span>
          <span className="text-right">{high}</span>
        </div>
        {note && <p className="mt-2 text-body-sm text-muted">{note}</p>}
      </dd>
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

/** Balance of power as a definition list: what each figure is, the figure, and its basis. */
function PowerBalance({
  competition,
  scopeNote,
}: {
  competition: DemocraticCompetition;
  scopeNote?: string;
}) {
  const chamberScope =
    competition.chambersMeasured === 1
      ? "elected chamber"
      : `${competition.chambersMeasured} elected chambers`;
  const courtScored = competition.courtSeated >= 5;
  const penalised = competition.penalty > 0;
  const rows: Array<{ label: string; value: string; note: string }> = [
    {
      label: "Chambers",
      value: `${competition.dominantSeatShare.toFixed(1)}%`,
      note: `Largest party across ${chamberScope}`,
    },
    {
      label: "Government",
      value: governmentStatus(competition),
      note: "Executive and legislature status",
    },
    {
      label: "Continuity",
      value: continuityStatus(competition),
      note: "Same governing settlement",
    },
    {
      label: "Court",
      value: courtScored ? `${competition.courtDominantShare.toFixed(1)}%` : "n/a",
      note: courtScored
        ? `Largest party of ${competition.courtSeated} seated justices`
        : "Too few justices seated to score packing",
    },
    {
      label: "Institutional cost",
      value: penalised ? `${MINUS}${competition.penalty.toFixed(1)}` : "None",
      note: penalised ? "Points off democratic health" : "No pressure on democratic health",
    },
  ];

  return (
    <section aria-labelledby="balance-of-power-heading">
      <h3 id="balance-of-power-heading" className="text-heading-sm font-semibold text-foreground">
        Balance of power
      </h3>
      <p className="mt-1 text-body text-muted">
        Concentrated control can hollow out an otherwise healthy democracy over time.
      </p>
      <dl className="mt-4 grid grid-cols-2 gap-x-8 gap-y-6 sm:grid-cols-3 lg:grid-cols-5">
        {rows.map((row) => (
          <div key={row.label} className="min-w-0">
            <dt className="text-body-sm text-muted">{row.label}</dt>
            <dd className="mt-1 text-body-lg font-semibold tabular-nums text-foreground">
              {row.value}
            </dd>
            <dd className="mt-0.5 text-body-sm text-muted">{row.note}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 text-body text-muted">
        Chamber margins: {MINUS}
        {competition.seatMarginPenalty.toFixed(1)}. Legislative continuity: {MINUS}
        {competition.legislativeContinuityPenalty.toFixed(1)}. Executive continuity: {MINUS}
        {competition.executiveContinuityPenalty.toFixed(1)}. Court packing: {MINUS}
        {competition.courtPenalty.toFixed(1)}.
      </p>
      {scopeNote && <p className="mt-2 text-body text-muted">{scopeNote}</p>}
    </section>
  );
}

/**
 * The governance style section: the national spirit's verdict, political
 * direction and democratic health on plain tracks, the institutional
 * assessment, and the balance of power behind the health score.
 */
export function GovernanceStyleCard({
  score,
  scopeNote,
}: {
  score: GovernanceStyleScore;
  /**
   * Shown under the balance of power. A region view passes one, because those
   * figures describe the country's legislature and executive, not the
   * region's, even though they bear on the region's democratic health.
   */
  scopeNote?: string;
}) {
  const flavor = governanceStyleFlavor(score);
  const health = healthTone(score.democraticHealth.value);

  return (
    <section aria-labelledby="governance-style-heading">
      <h2
        id="governance-style-heading"
        className="text-heading-lg font-semibold tracking-tight text-foreground"
      >
        Governance style
      </h2>
      <p className="mt-1 text-body text-muted">National spirit · Liberal democracy</p>

      <div className="mt-6 grid gap-x-12 gap-y-10 lg:grid-cols-2 lg:items-start">
        <div className="min-w-0">
          <p className="text-heading font-semibold text-foreground">
            {sentenceCase(flavor.headline)}
          </p>
          <p className="mt-1 text-body text-muted">{flavor.institutionalSigns[0]}</p>
          <dl className="mt-6 space-y-6">
            <Measure
              name="Political direction"
              axis={score.leftRight}
              low="Left"
              high="Right"
              valueClass="text-foreground"
              markerClass="bg-foreground"
              note={`Political character: ${sentenceCase(flavor.politicalHeadline)}`}
            />
            <Measure
              name="Democratic health"
              axis={score.democraticHealth}
              low="Failed state"
              high="Healthy democracy"
              valueClass={health.text}
              markerClass={health.marker}
            />
          </dl>
          <p className="mt-6 text-body-sm text-muted">
            Left and right describe political direction, not quality. Democratic health reflects
            whether institutions can constrain power, survive scandal, and hand authority over
            peacefully.
          </p>
        </div>

        <section aria-labelledby="institutional-assessment-heading" className="min-w-0">
          <h3
            id="institutional-assessment-heading"
            className="text-heading-sm font-semibold text-foreground"
          >
            Institutional assessment
          </h3>
          <p className="mt-2 text-body leading-relaxed text-muted">
            {flavor.institutionalNarrative}
          </p>
        </section>
      </div>

      {score.competition && (
        <div className="mt-10">
          <PowerBalance competition={score.competition} scopeNote={scopeNote} />
        </div>
      )}
    </section>
  );
}
