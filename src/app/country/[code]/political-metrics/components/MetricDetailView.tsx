"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import type { PMCategory, PMMetric, PMRegistryData } from "./registryTypes";
import { HistorySparkline } from "./HistorySparkline";
import { sentenceCase } from "./labels";
import { ModifiersPanel } from "./ModifiersPanel";
import {
  NO_HISTORY_YET,
  deltaTextClass,
  formatDelta,
  metricAtSnapshot,
  movementSince,
} from "./movement";
import { RegionBreakdown } from "./RegionBreakdown";
import { RelevantLegislationPanel } from "./RelevantLegislationPanel";
import { statusTextClass } from "./tones";
import { getCurrencyPrefix } from "@/lib/utils/budgetCalculations";

const LINK_CLASS =
  "text-left underline decoration-card-border underline-offset-4 transition-colors hover:decoration-foreground";

/** SP6: format an evidence row (a "$" prefix becomes the country currency). */
function formatEvidenceValue(
  row: { value: number; format: { prefix?: string; suffix?: string; decimals?: number } },
  countryId: string
): string {
  const decimals = row.format.decimals ?? 1;
  const prefix =
    row.format.prefix === "$" ? getCurrencyPrefix(countryId) : (row.format.prefix ?? "");
  return `${prefix}${row.value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}${row.format.suffix ?? ""}`;
}

/** A small label over its value, for the metric's key facts. */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-body-sm text-muted">{label}</dt>
      <dd className="mt-0.5 text-body font-medium text-foreground">{children}</dd>
    </div>
  );
}

function SectionHeading({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h3 id={id} className="text-heading-sm font-semibold text-foreground">
      {children}
    </h3>
  );
}

function DriverList({ title, drivers }: { title: string; drivers: string[] }) {
  return (
    <div>
      <h4 className="text-body font-semibold text-foreground">{title}</h4>
      {drivers.length > 0 ? (
        <ul className="mt-2 space-y-1.5 text-body text-foreground">
          {drivers.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-body text-muted">None listed.</p>
      )}
    </div>
  );
}

export function MetricDetailView({
  data,
  category,
  metric,
  onBackToCategory,
  onOpenMetric,
}: {
  data: PMRegistryData;
  category: PMCategory;
  metric: PMMetric;
  onBackToCategory: () => void;
  onOpenMetric: (metricId: string) => void;
}) {
  const related = category.metrics.filter((m) => m.id !== metric.id);
  const movement = movementSince(metric.value, metricAtSnapshot(metric, 0));
  return (
    <section className="mt-8 flex flex-col gap-10">
      <div>
        <Button variant="ghost" size="sm" onClick={onBackToCategory}>
          ← {category.displayName}
        </Button>
      </div>

      <header className="max-w-4xl">
        <h2 className="text-heading-lg font-semibold tracking-tight text-foreground">
          {metric.displayName}
        </h2>
        <p className="mt-1 text-body text-muted">
          {category.displayName} · {data.countryDisplayName}
        </p>
        {metric.description && (
          <p className="mt-3 max-w-[65ch] text-body-lg text-muted">{metric.description}</p>
        )}
        <div className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-display font-semibold leading-none tabular-nums text-foreground">
            {Math.round(metric.value)}
          </span>
          <span className={`text-heading-sm font-semibold ${statusTextClass(metric.status)}`}>
            {metric.status}
          </span>
        </div>
        <dl className="mt-5 grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-4">
          <Fact label="Lean">{sentenceCase(metric.leanLabel)}</Fact>
          <Fact label={`Change over the last ${data.historyCadenceTurns} turns`}>
            {movement ? (
              <>
                <span className={`font-semibold tabular-nums ${deltaTextClass(movement.delta)}`}>
                  {formatDelta(movement.delta)}
                </span>{" "}
                <span className="text-muted">from {Math.round(movement.from)}</span>
              </>
            ) : (
              <span className="font-normal text-muted">{NO_HISTORY_YET}</span>
            )}
          </Fact>
          <Fact label="Updated">
            Turn <span className="tabular-nums">{data.turn.toLocaleString("en-US")}</span>
          </Fact>
          <Fact label="Scale">0 to 100, objective</Fact>
        </dl>
        <p className="mt-3 text-body-sm text-muted">
          Lean describes political association, not a quality judgment.
        </p>
      </header>

      <section aria-labelledby="pm-metric-history">
        <SectionHeading id="pm-metric-history">Historical series</SectionHeading>
        {metric.history.length >= 2 ? (
          <div className="mt-3">
            <HistorySparkline points={metric.history} />
          </div>
        ) : (
          <p className="mt-2 text-body text-muted">
            {NO_HISTORY_YET}. The chart starts once two snapshots exist, one every{" "}
            {data.historyCadenceTurns} turns.
          </p>
        )}
      </section>

      <div className="grid grid-cols-1 gap-x-12 gap-y-10 lg:grid-cols-2 lg:items-start">
        <section aria-labelledby="pm-metric-drivers" className="min-w-0">
          <SectionHeading id="pm-metric-drivers">Metric drivers</SectionHeading>
          <p className="mt-1 text-body text-muted">
            Structural conditions, ongoing, that push this metric up or down.
          </p>
          <div className="mt-4 grid grid-cols-1 gap-6 sm:grid-cols-2">
            <DriverList title="Positive contributors" drivers={metric.pos} />
            <DriverList title="Negative contributors" drivers={metric.neg} />
          </div>
        </section>

        <section aria-labelledby="pm-metric-indicators" className="min-w-0">
          <SectionHeading id="pm-metric-indicators">Component indicators</SectionHeading>
          <ul className="mt-3 list-disc space-y-1.5 pl-5 text-body text-foreground marker:text-muted">
            {metric.indicators.map((ind) => (
              <li key={ind}>{ind}</li>
            ))}
          </ul>
          <p className="mt-3 text-body text-muted">
            The headline metric is permanent; its component indicators shift with the era. Indicator
            readings arrive with the registry&apos;s live series.
          </p>
        </section>
      </div>

      <RegionBreakdown nationalValue={metric.national ?? metric.value} regions={metric.regions} />

      <ModifiersPanel modifiers={metric.modifiers} />

      {metric.evidence.length > 0 && (
        <section aria-labelledby="pm-metric-evidence">
          <SectionHeading id="pm-metric-evidence">Underlying statistics</SectionHeading>
          <table className="mt-3 w-full max-w-2xl border-collapse">
            <tbody>
              {metric.evidence.map((row) => (
                <tr key={row.id} className="border-b border-card-border/60 last:border-b-0">
                  <th scope="row" className="py-2 pr-3 text-left text-body font-normal text-muted">
                    {row.label}
                    {/* In a region view the macro rows are that region's own, but
                        the prime rate, inflation and debt to GDP are set for the
                        whole country. Saying so beats letting a player read a
                        national figure as their region's. */}
                    {data.scope === "region" && row.scope === "national" && (
                      <span className="ml-1.5 text-body-sm">(national)</span>
                    )}
                  </th>
                  <td className="whitespace-nowrap py-2 text-right text-body">
                    <span className="font-mono font-semibold tabular-nums text-foreground">
                      {formatEvidenceValue(row, data.countryId)}
                    </span>
                    {/* Neutral on purpose: a rising unemployment rate and a
                        rising income are both "up", so the arrow's direction
                        says nothing about good or bad. */}
                    {row.trend != null && Math.abs(row.trend) >= 0.05 && (
                      <span className="ml-2 font-mono text-body-sm tabular-nums text-muted">
                        {row.trend > 0 ? "▲" : "▼"} {Math.abs(row.trend).toFixed(1)}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-body text-muted">
            National statistical series feeding this judgment. Full series on the Economy page.
          </p>
        </section>
      )}

      <RelevantLegislationPanel countryId={data.countryId} legislation={metric.legislation} />

      {related.length > 0 && (
        <section aria-labelledby="pm-metric-related">
          <SectionHeading id="pm-metric-related">Related metrics</SectionHeading>
          <ul className="mt-3 grid grid-cols-1 gap-x-12 sm:grid-cols-2">
            {related.map((m) => (
              <li
                key={m.id}
                className="flex items-baseline justify-between gap-3 border-b border-card-border/60 py-2"
              >
                <button
                  type="button"
                  onClick={() => onOpenMetric(m.id)}
                  className={`${LINK_CLASS} text-body text-foreground`}
                >
                  {m.displayName}
                </button>
                <span className="shrink-0 text-body tabular-nums text-muted">
                  {Math.round(m.value)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}
