"use client";

import type { ReactNode } from "react";
import type { PMRegistryData } from "./registryTypes";
import { CategoryTable } from "./CategoryTable";
import { GovernanceStyleCard } from "./GovernanceStyleCard";
import {
  NO_HISTORY_YET,
  deltaTextClass,
  formatDelta,
  movementSince,
  overallAtSnapshot,
  yearStepsBack,
} from "./movement";

/** A metric below this reads as Critical (STATUS_BANDS). */
const CRITICAL_BELOW = 25;

/** One entry in the summary list: a label, its value, and a short note under the value. */
function SummaryFigure({
  label,
  value,
  note,
  valueClass = "text-foreground",
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  valueClass?: string;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-body-sm text-muted">{label}</dt>
      <dd className={`mt-1 text-heading-sm font-semibold tabular-nums ${valueClass}`}>{value}</dd>
      {note != null && <dd className="mt-0.5 text-body-sm text-muted">{note}</dd>}
    </div>
  );
}

/** The overall score's change against a snapshot, or the honest empty state. */
function MovementFigure({
  label,
  data,
  stepsBack,
}: {
  label: string;
  data: PMRegistryData;
  stepsBack: number;
}) {
  const movement = movementSince(data.overall, overallAtSnapshot(data, stepsBack));
  if (!movement) {
    return (
      <div className="min-w-0">
        <dt className="text-body-sm text-muted">{label}</dt>
        <dd className="mt-1 text-body text-muted">{NO_HISTORY_YET}</dd>
      </div>
    );
  }
  return (
    <SummaryFigure
      label={label}
      value={formatDelta(movement.delta)}
      note={`from ${Math.round(movement.from)}`}
      valueClass={deltaTextClass(movement.delta)}
    />
  );
}

export function OverviewView({
  data,
  onOpenCategory,
  onOpenMetric,
  showGovernanceStyle,
  governanceScopeNote,
}: {
  data: PMRegistryData;
  onOpenCategory: (categoryId: string) => void;
  onOpenMetric: (categoryId: string, metricId: string) => void;
  showGovernanceStyle: boolean;
  /** Passed through to the governance section; a region view explains the national half. */
  governanceScopeNote?: string;
}) {
  const sorted = [...data.categories].sort((a, b) => b.score - a.score);
  const strongest = sorted[0];
  const weakest = sorted[sorted.length - 1];
  const criticalCount = data.categories
    .flatMap((c) => c.metrics)
    .filter((m) => m.value < CRITICAL_BELOW).length;

  return (
    <div className="mt-6 flex flex-col gap-12">
      {/* Supporting figures for the headline in the header above. Labelled by
          what the series actually holds: snapshots land every
          `historyCadenceTurns`, so "since last turn" was never a question this
          data could answer. */}
      <dl
        aria-label="Summary"
        className="grid grid-cols-2 gap-x-8 gap-y-6 sm:grid-cols-3 lg:grid-cols-5"
      >
        <MovementFigure
          label={`Change over the last ${data.historyCadenceTurns} turns`}
          data={data}
          stepsBack={0}
        />
        <MovementFigure
          label="Change over the past year"
          data={data}
          stepsBack={yearStepsBack(data.historyCadenceTurns)}
        />
        <SummaryFigure
          label="Critical metrics"
          value={criticalCount}
          note={`Score below ${CRITICAL_BELOW}`}
          valueClass={criticalCount > 0 ? "text-error" : "text-foreground"}
        />
        {strongest && (
          <SummaryFigure
            label="Strongest category"
            value={Math.round(strongest.score)}
            note={strongest.displayName}
          />
        )}
        {weakest && (
          <SummaryFigure
            label="Weakest category"
            value={Math.round(weakest.score)}
            note={weakest.displayName}
          />
        )}
      </dl>

      {showGovernanceStyle && data.governanceStyle && (
        <GovernanceStyleCard score={data.governanceStyle} scopeNote={governanceScopeNote} />
      )}

      <CategoryTable
        categories={data.categories}
        onOpenCategory={onOpenCategory}
        onOpenMetric={onOpenMetric}
      />
    </div>
  );
}
