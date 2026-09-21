import type { DepartmentProgramReadModel } from "@/lib/governmentFinance/readModel";

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function money(value: number, symbol: string): string {
  return `${symbol}${Math.round(value).toLocaleString()}`;
}

function Ratio({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border border-card-border bg-background/40 p-3">
      <div className="mb-1 flex items-center justify-between gap-3 text-xs">
        <span className="text-muted">{label}</span>
        <span className="font-semibold tabular-nums text-foreground">{percent(value)}</span>
      </div>
      <meter className="h-2 w-full" min={0} max={1} value={value} aria-label={`${label} ratio`} />
    </div>
  );
}

export function DepartmentProgramPanel({
  program,
  currencySymbol,
}: {
  program: DepartmentProgramReadModel;
  currencySymbol: string;
}) {
  if (!program.enabled) {
    return (
      <section
        className="rounded-lg border border-card-border bg-card p-5"
        aria-labelledby="program-title"
      >
        <h2 id="program-title" className="text-lg font-semibold">
          Department Programs
        </h2>
        <p className="mt-2 text-sm text-muted">{program.explanation}</p>
      </section>
    );
  }

  return (
    <section
      className="rounded-lg border border-card-border bg-card p-5"
      aria-labelledby="program-title"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted">{program.departmentName}</p>
          <h2 id="program-title" className="text-lg font-semibold">
            {program.programName}
          </h2>
        </div>
        <span className="rounded-full border border-card-border px-3 py-1 text-xs font-semibold uppercase">
          {program.status.replaceAll("_", " ")}
        </span>
      </div>
      <p className="mt-3 text-sm text-muted">{program.explanation}</p>

      {program.ratios && (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Ratio label="Funding" value={program.ratios.funding} />
            <Ratio label="Capacity" value={program.ratios.capacity} />
            <Ratio label="Coverage" value={program.ratios.coverage} />
            <Ratio label="Ramp" value={program.ratios.ramp} />
            <Ratio label="Delivered" value={program.ratios.implementation} />
          </div>
          <p className="mt-3 text-sm">
            Binding constraint: <strong>{program.bindingConstraint?.replaceAll("_", " ")}</strong>
          </p>
        </>
      )}

      {program.annualDemand !== undefined && (
        <dl className="mt-4 grid gap-x-5 gap-y-3 border-t border-card-border pt-4 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-muted">Annual demand</dt>
            <dd>{money(program.annualDemand, currencySymbol)}</dd>
          </div>
          <div>
            <dt className="text-muted">Authority this turn</dt>
            <dd>{money(program.authorityThisTurn ?? 0, currencySymbol)}</dd>
          </div>
          {program.availableBalance !== undefined && (
            <div>
              <dt className="text-muted">Available balance</dt>
              <dd>{money(program.availableBalance, currencySymbol)}</dd>
            </div>
          )}
          <div>
            <dt className="text-muted">Encumbered</dt>
            <dd>{money(program.encumbered ?? 0, currencySymbol)}</dd>
          </div>
          <div>
            <dt className="text-muted">Outlaid this turn</dt>
            <dd>{money(program.outlaid ?? 0, currencySymbol)}</dd>
          </div>
          <div>
            <dt className="text-muted">Arrears</dt>
            <dd>{money(program.arrears ?? 0, currencySymbol)}</dd>
          </div>
        </dl>
      )}

      {program.capacity && (
        <div className="mt-4 border-t border-card-border pt-4">
          <h3 className="text-sm font-semibold">Operating capacity</h3>
          <p className="mt-1 text-xs text-muted">
            Throughput {program.capacity.availableThroughput}; maintenance demand{" "}
            {program.capacity.maintenanceDemand}.
          </p>
          <dl className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            <div>
              <dt className="text-muted">Workforce</dt>
              <dd>{program.capacity.workforce}</dd>
            </div>
            <div>
              <dt className="text-muted">Facilities</dt>
              <dd>{program.capacity.facilities}</dd>
            </div>
            <div>
              <dt className="text-muted">Systems</dt>
              <dd>{program.capacity.systems}</dd>
            </div>
            <div>
              <dt className="text-muted">Efficiency</dt>
              <dd>{program.capacity.efficiency}</dd>
            </div>
          </dl>
        </div>
      )}

      {program.outcome && (
        <p className="mt-4 border-t border-card-border pt-4 text-sm">
          <span className="text-muted">Outcome channel:</span> {program.outcome.label} receives{" "}
          <strong>{percent(program.outcome.deliveredShare)}</strong> of the authored program effect
          this turn.
        </p>
      )}
    </section>
  );
}
