"use client";

/**
 * Per-provision "Current law → Proposed" comparison for NEW-GENERATION catalog
 * laws (US/UK/RU/DD), per the Legislation Update design: each side carries the
 * enacted level's name and its est. annual fiscal line (from the API-attached
 * per-level `estimates`), the proposed side annotates the delta ("saves X" /
 * "+X · +Y% GDP"), and a chip row names each affected political metric with
 * its direction RELATIVE to the current law (law points rise monotonically
 * with level, so direction = sign(proposed − current); weight 1 = primary).
 */

import { formatCurrencyCompactChip } from "@/lib/utils/formatters";
import { getCurrencyPrefix } from "@/lib/utils/budgetCalculations";
import { getMetricDisplayName } from "@/lib/politicalMetrics/names";
import { POLITICAL_METRIC_COUNTRY_IDS } from "@/lib/politicalMetrics/types";
import type { PoliticalMetricsCountryId, PoliticalMetricId } from "@/lib/politicalMetrics/types";

export interface LawLevelEstimateLite {
  level: number;
  cost: number;
  revenue: number;
  net: number;
}

export interface ComparisonLawType {
  estimates?: LawLevelEstimateLite[];
  estimatesGdp?: number;
  politicalMetricTargets?: { metricId: string; weight: number }[];
  policyOptions?: { id: string; name: string }[];
}

/** Annual net → display line ("Est. annual cost ₽X" / "revenue ₽X" / "₽0"). */
function fiscalLine(net: number, prefix: string): { label: string; value: string } {
  if (net < 0) return { label: "Est. annual cost", value: formatCurrencyCompactChip(-net, prefix) };
  if (net > 0)
    return { label: "Est. annual revenue", value: formatCurrencyCompactChip(net, prefix) };
  return { label: "Est. annual cost", value: `${prefix}0` };
}

export function LawProvisionComparison({
  countryId,
  lt,
  currentIndex,
  proposedIndex,
}: {
  countryId: string;
  lt: ComparisonLawType;
  /** Enacted level index; undefined = unknown (renders nothing). */
  currentIndex: number | undefined;
  /** Selected level index; -1/undefined = nothing selected yet. */
  proposedIndex: number | undefined;
}) {
  const estimates = lt.estimates;
  if (!estimates?.length || currentIndex === undefined) return null;
  const options = lt.policyOptions ?? [];
  const current = estimates[currentIndex];
  const currentName = options[currentIndex]?.name ?? `Level ${currentIndex}`;
  const prefix = getCurrencyPrefix(countryId);
  const hasProposed =
    proposedIndex !== undefined && proposedIndex >= 0 && proposedIndex < estimates.length;
  const proposed = hasProposed ? estimates[proposedIndex] : undefined;
  const proposedName = hasProposed ? (options[proposedIndex]?.name ?? "") : "";

  const currentLine = fiscalLine(current?.net ?? 0, prefix);
  const proposedLine = proposed ? fiscalLine(proposed.net, prefix) : null;
  // Annual net cost = −net. Positive deltaCost = the proposal costs MORE per
  // year than current law; negative = it saves money.
  const deltaCost = proposed ? -proposed.net - -(current?.net ?? 0) : 0;
  const gdp = lt.estimatesGdp ?? 0;
  const deltaPctGdp = gdp > 0 ? (Math.abs(deltaCost) / gdp) * 100 : null;

  const levelDelta = hasProposed ? proposedIndex - currentIndex : 0;
  const isRegistryCountry = (POLITICAL_METRIC_COUNTRY_IDS as readonly string[]).includes(
    countryId.toUpperCase()
  );
  const targets = levelDelta !== 0 && isRegistryCountry ? (lt.politicalMetricTargets ?? []) : [];

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_1fr]">
        <div className="rounded-lg border border-card-border bg-card/60 p-2.5">
          <div className="font-mono text-[10px] uppercase tracking-widest text-muted">
            Current law
          </div>
          <div
            className="mt-0.5 truncate text-xs font-semibold text-foreground"
            title={currentName}
          >
            {currentName}
          </div>
          <div className="mt-1.5 flex items-baseline justify-between gap-2 text-[11px]">
            <span className="text-muted">{currentLine.label}</span>
            <span className="font-mono font-bold tabular-nums text-foreground">
              {currentLine.value}
            </span>
          </div>
        </div>
        <div className="hidden items-center text-muted sm:flex" aria-hidden="true">
          →
        </div>
        <div
          className={`rounded-lg border p-2.5 ${
            hasProposed ? "border-primary/40 bg-primary/5" : "border-card-border bg-card/60"
          }`}
        >
          <div className="font-mono text-[10px] uppercase tracking-widest text-primary">
            Proposed
          </div>
          {hasProposed && proposedLine ? (
            <>
              <div
                className="mt-0.5 truncate text-xs font-semibold text-foreground"
                title={proposedName}
              >
                {proposedName}
              </div>
              <div className="mt-1.5 flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 text-[11px]">
                <span className="text-muted">{proposedLine.label}</span>
                <span className="font-mono font-bold tabular-nums text-foreground">
                  {proposedLine.value}
                  {deltaCost < 0 && (
                    <span className="ml-1.5 font-semibold text-success">
                      saves {formatCurrencyCompactChip(-deltaCost, prefix)}
                    </span>
                  )}
                  {deltaCost > 0 && (
                    <span className="ml-1.5 font-semibold text-error">
                      +{formatCurrencyCompactChip(deltaCost, prefix)}
                    </span>
                  )}
                </span>
                {deltaCost > 0 && deltaPctGdp != null && deltaPctGdp >= 0.05 && (
                  <span className="w-full text-right font-mono font-semibold tabular-nums text-error">
                    +{deltaPctGdp.toFixed(1)}% GDP
                  </span>
                )}
              </div>
            </>
          ) : (
            <div className="mt-0.5 text-xs italic text-muted">Select a policy option…</div>
          )}
        </div>
      </div>
      {targets.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="w-full font-mono text-[10px] uppercase tracking-widest text-muted/70">
            Affected metrics vs current law
          </span>
          {targets.map((t) => {
            const up = levelDelta > 0;
            const major = Math.abs(t.weight) >= 1;
            const name = getMetricDisplayName(
              countryId.toUpperCase() as PoliticalMetricsCountryId,
              t.metricId as PoliticalMetricId
            );
            return (
              <span
                key={t.metricId}
                className={`inline-flex items-center gap-0.5 text-xs ${
                  up ? "text-success" : "text-error"
                }`}
                title={major ? "Primary target" : "Secondary target"}
              >
                <span aria-hidden="true">{up ? (major ? "▲▲" : "▲") : major ? "▼▼" : "▼"}</span>
                {name}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Bill-level fiscal roll-up across new-generation provisions (design strip). */
export function BillFiscalImpactStrip({
  countryId,
  rows,
}: {
  countryId: string;
  rows: Array<{
    lt: ComparisonLawType | undefined;
    currentIndex: number | undefined;
    proposedIndex: number | undefined;
  }>;
}) {
  const prefix = getCurrencyPrefix(countryId);
  const priced = rows.filter(
    (r) =>
      r.lt?.estimates?.length &&
      r.currentIndex !== undefined &&
      r.proposedIndex !== undefined &&
      r.proposedIndex >= 0
  );
  if (priced.length === 0) return null;

  // Sum ANNUAL NET COST (positive = costs money) across the priced provisions.
  const currentCost = priced.reduce(
    (sum, r) => sum - (r.lt!.estimates![r.currentIndex!]?.net ?? 0),
    0
  );
  const enactedCost = priced.reduce(
    (sum, r) => sum - (r.lt!.estimates![r.proposedIndex!]?.net ?? 0),
    0
  );
  const netChange = enactedCost - currentCost;
  const gdp = priced[0].lt!.estimatesGdp ?? 0;
  const netPctGdp = gdp > 0 ? (Math.abs(netChange) / gdp) * 100 : null;

  const cell = (label: string, value: string, extra?: React.ReactNode) => (
    <div className="flex-1 px-3 py-2">
      <div className="font-mono text-[10px] uppercase tracking-widest text-muted">{label}</div>
      <div className="mt-0.5 font-mono text-sm font-bold tabular-nums text-foreground">
        {value}
        {extra}
      </div>
    </div>
  );

  return (
    <div className="overflow-hidden rounded-lg border border-card-border bg-card/60">
      <div className="border-b border-card-border px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest text-muted">
        Fiscal impact — estimated
      </div>
      <div className="flex flex-col divide-y divide-card-border sm:flex-row sm:divide-x sm:divide-y-0">
        {cell("Current laws", `${formatCurrencyCompactChip(currentCost, prefix)}/yr`)}
        {cell("If enacted", `${formatCurrencyCompactChip(enactedCost, prefix)}/yr`)}
        {cell(
          "Net change",
          `${netChange >= 0 ? "+" : "−"}${formatCurrencyCompactChip(Math.abs(netChange), prefix)}/yr`,
          netChange !== 0 && netPctGdp != null && netPctGdp >= 0.05 ? (
            <div className={`text-[11px] ${netChange > 0 ? "text-error" : "text-success"}`}>
              {netChange > 0 ? "+" : "−"}
              {netPctGdp.toFixed(1)}% GDP
            </div>
          ) : undefined
        )}
      </div>
    </div>
  );
}
