import type { GovernanceStyleScore } from "@/lib/governanceStyle/score";
import { governanceStyleFlavor } from "@/lib/governanceStyle/flavor";

function AxisReading({
  label,
  value,
  description,
}: {
  label: string;
  value: number;
  description: string;
}) {
  return (
    <div className="rounded-md border border-card-border bg-background/40 px-3 py-2">
      <div className="font-mono text-body-xs uppercase tracking-wider text-muted">
        {description}
      </div>
      <div className="mt-1 flex items-baseline justify-between gap-3">
        <span className="font-display text-body-lg font-semibold text-foreground">{label}</span>
        <span className="font-mono text-body tabular-nums text-muted">{Math.round(value)}</span>
      </div>
    </div>
  );
}

export function GovernanceStyleCard({ score }: { score: GovernanceStyleScore }) {
  const flavor = governanceStyleFlavor(score);
  return (
    <section
      className="overflow-hidden rounded-lg border border-card-border bg-card shadow-card"
      aria-labelledby="governance-style-heading"
    >
      <div className="border-b border-card-border px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="font-mono text-body-xs uppercase tracking-widest text-muted">
              National spirit
            </div>
            <h2
              id="governance-style-heading"
              className="mt-0.5 font-display text-heading font-semibold text-foreground"
            >
              Governance Style
            </h2>
          </div>
          <span className="rounded border border-card-border px-2 py-1 font-mono text-body-xs uppercase tracking-wider text-muted">
            Liberal democracy
          </span>
        </div>
        <p className="mt-2 max-w-3xl text-body-sm text-muted">
          Policy direction and democratic health move independently as laws and national outcomes
          change.
        </p>
      </div>

      <div className="grid gap-4 p-4 lg:grid-cols-[minmax(260px,420px)_1fr] lg:items-center">
        <div
          className="relative mx-auto aspect-square w-full max-w-[360px]"
          role="img"
          aria-label={`${score.leftRight.label}, ${Math.round(score.leftRight.value)} out of 100 from Left to Right. ${score.democraticHealth.label}, ${Math.round(score.democraticHealth.value)} out of 100 from Failed State to Healthy Democracy.`}
        >
          <span className="absolute left-1/2 top-0 -translate-x-1/2 font-mono text-body-xs uppercase tracking-wider text-success">
            Healthy democracy
          </span>
          <span className="absolute bottom-0 left-1/2 -translate-x-1/2 font-mono text-body-xs uppercase tracking-wider text-error">
            Failed state
          </span>
          <span className="absolute left-0 top-1/2 -translate-y-1/2 font-mono text-body-xs uppercase tracking-wider text-muted">
            Left
          </span>
          <span className="absolute right-0 top-1/2 -translate-y-1/2 font-mono text-body-xs uppercase tracking-wider text-muted">
            Right
          </span>

          <div className="absolute inset-x-12 bottom-8 top-8 rounded-md border border-card-border bg-background/30">
            <div className="absolute inset-x-0 top-1/2 border-t border-card-border" />
            <div className="absolute inset-y-0 left-1/2 border-l border-card-border" />
            <div
              className="absolute h-4 w-4 -translate-x-1/2 translate-y-1/2 rounded-full border-2 border-background bg-primary shadow-card"
              style={{
                left: `${score.leftRight.value}%`,
                bottom: `${score.democraticHealth.value}%`,
              }}
            >
              <span className="sr-only">Current Governance Style position</span>
            </div>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
          <AxisReading
            description="Political direction"
            label={score.leftRight.label}
            value={score.leftRight.value}
          />
          <AxisReading
            description="Democratic health"
            label={score.democraticHealth.label}
            value={score.democraticHealth.value}
          />
          <p className="text-body-xs leading-relaxed text-muted sm:col-span-2 lg:col-span-1">
            Left and right describe association, not quality. Democratic health reads election
            participation, openness, integrity, administration, due process, courts, public trust,
            safety, and civic life.
          </p>
        </div>
      </div>

      <div className="grid gap-4 border-t border-card-border bg-background/30 p-4 lg:grid-cols-2">
        <div>
          <div className="font-mono text-body-xs uppercase tracking-widest text-muted">
            Institutional character
          </div>
          <h3 className="mt-1 font-display text-heading font-semibold text-foreground">
            {flavor.headline}
          </h3>
          <p className="mt-2 text-body-sm leading-relaxed text-muted">
            {flavor.institutionalNarrative}
          </p>
        </div>
        <div>
          <div className="font-mono text-body-xs uppercase tracking-widest text-muted">
            Political character
          </div>
          <h3 className="mt-1 font-display text-heading font-semibold text-foreground">
            {flavor.politicalHeadline}
          </h3>
          <p className="mt-2 text-body-sm leading-relaxed text-muted">
            {flavor.politicalNarrative}
          </p>
        </div>
        <div className="lg:col-span-2">
          <div className="font-mono text-body-xs uppercase tracking-widest text-muted">
            Signs of the system
          </div>
          <ul className="mt-2 grid gap-2 text-body-sm text-muted md:grid-cols-3">
            {flavor.institutionalSigns.map((sign) => (
              <li key={sign} className="rounded-md border border-card-border bg-card px-3 py-2">
                {sign}
              </li>
            ))}
          </ul>
        </div>
        {flavor.competitionNarrative && (
          <div className="rounded-md border border-card-border bg-card px-3 py-2 text-body-sm text-muted lg:col-span-2">
            <span className="font-semibold text-foreground">Competitive balance: </span>
            {flavor.competitionNarrative}
          </div>
        )}
      </div>
    </section>
  );
}
