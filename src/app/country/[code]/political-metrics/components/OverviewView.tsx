"use client";

import type { CountryPoliticalMetricsResponse } from "@/lib/politicalMetrics/queries/countryPoliticalMetrics";
import { CategoryCard } from "./CategoryCard";
import { GovernanceStyleCard } from "./GovernanceStyleCard";
import { scoreTone } from "./tones";

/** Movement tiles render honest empty states until the dynamics sub-project lands. */
const EMPTY_SERIES = "series begins this campaign";

function Tile({
  label,
  value,
  sub,
  toneText,
}: {
  label: string;
  value: string;
  sub: string;
  toneText?: string;
}) {
  return (
    <div className="border-l border-card-border px-4 py-3 first:border-l-0">
      <div className="font-mono text-body-xs uppercase tracking-wider text-muted">{label}</div>
      <div className={`mt-0.5 text-body-lg font-bold tabular-nums ${toneText ?? "text-muted"}`}>
        {value}
      </div>
      <div className="text-body-xs text-muted">{sub}</div>
    </div>
  );
}

export function OverviewView({
  data,
  onOpenCategory,
  onOpenMetric,
  showGovernanceStyle,
}: {
  data: CountryPoliticalMetricsResponse;
  onOpenCategory: (categoryId: string) => void;
  onOpenMetric: (categoryId: string, metricId: string) => void;
  showGovernanceStyle: boolean;
}) {
  const tone = scoreTone(data.overall);
  const sorted = [...data.categories].sort((a, b) => b.score - a.score);
  const strongest = sorted[0];
  const weakest = sorted[sorted.length - 1];
  const criticalCount = data.categories
    .flatMap((c) => c.metrics)
    .filter((m) => m.nationalValue < 25).length;

  // Condition ring geometry (raw SVG values are isolated here by necessity;
  // colors still come from tokens via currentColor).
  const size = 84;
  const r = (size - 8) / 2;
  const circ = 2 * Math.PI * r;

  return (
    <section className="mt-4 flex flex-col gap-4">
      <div className="overflow-hidden rounded-lg border border-card-border bg-card p-0 shadow-card">
        <div className="grid grid-cols-2 lg:grid-cols-[minmax(230px,1.5fr)_repeat(4,minmax(0,1fr))]">
          <div className="col-span-2 flex items-center gap-4 border-b border-card-border px-4 py-3 lg:col-span-1 lg:border-b-0 lg:border-r">
            <span
              className={`relative inline-flex ${tone.text}`}
              aria-label="Overall national score"
            >
              <svg width={size} height={size} className="-rotate-90">
                <circle
                  cx={size / 2}
                  cy={size / 2}
                  r={r}
                  fill="none"
                  className="stroke-track"
                  strokeWidth="7"
                />
                <circle
                  cx={size / 2}
                  cy={size / 2}
                  r={r}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="7"
                  strokeLinecap="round"
                  strokeDasharray={circ.toFixed(1)}
                  strokeDashoffset={(circ * (1 - data.overall / 100)).toFixed(1)}
                />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center">
                <span className="text-heading font-extrabold tabular-nums">
                  {Math.round(data.overall)}
                </span>
              </span>
            </span>
            <div>
              <div className="font-mono text-body-xs uppercase tracking-widest text-muted">
                Overall condition
              </div>
              <div className="mt-0.5 font-display text-heading font-semibold text-foreground">
                {data.overallStatus}
              </div>
              <div className="text-body-xs text-muted">mean of nine category scores</div>
            </div>
          </div>
          <Tile label="Δ since last turn" value="—" sub={EMPTY_SERIES} />
          <Tile label="Δ over past year" value="—" sub={EMPTY_SERIES} />
          <Tile
            label="Critical metrics"
            value={String(criticalCount)}
            sub="score below 25"
            toneText={criticalCount > 0 ? "text-error" : "text-muted"}
          />
          <Tile
            label="Strongest / weakest"
            value={`${Math.round(strongest.score)} / ${Math.round(weakest.score)}`}
            sub={`${strongest.displayName} / ${weakest.displayName}`}
            toneText="text-foreground"
          />
        </div>
      </div>

      {showGovernanceStyle && <GovernanceStyleCard score={data.governanceStyle} />}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {data.categories.map((cat) => (
          <CategoryCard
            key={cat.id}
            category={cat}
            onOpenCategory={onOpenCategory}
            onOpenMetric={onOpenMetric}
          />
        ))}
      </div>

      <div className="flex flex-wrap gap-4 font-mono text-body-xs uppercase tracking-wider text-muted">
        <span>Strip: position = political lean (L→R)</span>
        <span>Bar = objective score</span>
        <span>Lean describes association, not quality</span>
      </div>
    </section>
  );
}
