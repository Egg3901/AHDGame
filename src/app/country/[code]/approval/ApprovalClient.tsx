"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { ActiveModifier } from "@/lib/utils/approvalModifiers";
import { metricsApiUrl, approvalApiUrl, politicalMetricsUrl, regionApprovalUrl } from "@/lib/urls";
import { POLITICAL_METRIC_COUNTRY_IDS } from "@/lib/politicalMetrics/types";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { ModifierList } from "@/components/approval/ModifierChip";
import { computeRegionalConditionMargin } from "@/lib/states/conditions/marginEffects";
import { mergeApprovalModifiers } from "./mergeApprovalModifiers";

interface StateApprovalEntry {
  stateId: string;
  stateName: string;
  approval: number;
  baseApproval: number;
  modifiers: ActiveModifier[];
}

interface MetricsApiResponse {
  governmentApproval?: number;
  governmentApprovalBase?: number;
  governmentApprovalModifiers?: ActiveModifier[];
  stateApprovals?: StateApprovalEntry[];
  totalPopulation?: number;
}

interface ApprovalApiResponse {
  governmentApproval?: number;
  history?: { turn: number; approval: number }[];
  modifiers?: ActiveModifier[];
}

function approvalColor(v: number) {
  return v >= 50 ? "text-success" : v >= 40 ? "text-warning" : "text-error";
}

interface ApprovalClientProps {
  /** Server-seeded initial data so the page renders without a client round trip. */
  initialMetrics?: MetricsApiResponse | null;
  initialApproval?: ApprovalApiResponse | null;
}

export default function ApprovalClient({ initialMetrics, initialApproval }: ApprovalClientProps) {
  const { code } = useParams<{ code: string }>();
  const rawCode = code?.toUpperCase() ?? "US";
  const config =
    rawCode in COUNTRY_CONFIGS ? COUNTRY_CONFIGS[rawCode as CountryId] : COUNTRY_CONFIGS.US;
  const country = config.id;

  const [metricsData, setMetricsData] = useState<MetricsApiResponse | null>(initialMetrics ?? null);
  const [approvalData, setApprovalData] = useState<ApprovalApiResponse | null>(
    initialApproval ?? null
  );
  const [error, setError] = useState<string | null>(null);
  // Seeded from the server → no initial spinner. Only show loading when we have
  // nothing to render yet and must fetch client-side.
  const [loading, setLoading] = useState(!(initialMetrics || initialApproval));
  // Skip the first client fetch when the server already provided data; the
  // country param is fixed for the lifetime of this mount (a different country
  // is a different route segment → a fresh server render).
  const skipInitialFetch = useRef(Boolean(initialMetrics || initialApproval));

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const fetchOpts = { signal: AbortSignal.timeout(15_000) };
      const [metricsRes, approvalRes] = await Promise.all([
        fetch(metricsApiUrl(country), fetchOpts).then((r) => (r.ok ? r.json() : null)),
        fetch(approvalApiUrl(country), fetchOpts).then((r) => (r.ok ? r.json() : null)),
      ]);
      setMetricsData(metricsRes);
      setApprovalData(approvalRes);
      if (!metricsRes && !approvalRes) {
        setError("Failed to load data.");
      }
    } catch (err) {
      console.error("Error loading approval data:", err);
      setError("Failed to load data.");
    } finally {
      setLoading(false);
    }
  }, [country]);

  useEffect(() => {
    if (skipInitialFetch.current) {
      skipInitialFetch.current = false;
      return;
    }
    load();
  }, [load]);

  // Metric conditions come from the metrics endpoint when it has loaded; the
  // national ones the snapshot stored (address, org statements, the war block)
  // only ever arrive through the approval endpoint, so they are merged in
  // rather than lost to a preference between the two.
  const modifiers: ActiveModifier[] = mergeApprovalModifiers(
    metricsData?.governmentApprovalModifiers,
    approvalData?.modifiers
  );

  // The STORED snapshot value, not the metrics endpoint's live recompute.
  //
  // The two are different models: the snapshot is a population-weighted
  // aggregate of damped regional approval with the national providers and the
  // cabinet penalties folded in, while the metrics endpoint scores national
  // metric averages alone. The stored one is canonical — it is what the history
  // chart below plots, what the Executive page shows, and what elections
  // consume — so showing the other beside that history was already showing two
  // different numbers for the same thing. It becomes untenable once the effects
  // list includes national modifiers the recompute does not know about: the
  // chips would not add up to the figure above them.
  const governmentApproval: number | undefined =
    approvalData?.governmentApproval ?? metricsData?.governmentApproval;

  const sortedStates = metricsData?.stateApprovals
    ? [...metricsData.stateApprovals].sort((a, b) => b.approval - a.approval)
    : [];

  const history = approvalData?.history ?? [];

  const netApproval = modifiers.reduce((s, m) => s + m.effect, 0);
  const netMargin = computeRegionalConditionMargin(modifiers);

  return (
    <div className="min-h-screen bg-background pb-16">
      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 overflow-x-hidden">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 mb-4 text-xs text-muted">
          <Link
            href={`/country/${config.code.toLowerCase()}`}
            className="hover:text-foreground transition-colors"
          >
            {config.name}
          </Link>
          <span>/</span>
          <span>Approval &amp; Active Effects</span>
        </div>

        <h1 className="text-2xl font-bold mb-1">{config.name} Approval &amp; Active Effects</h1>
        <p className="text-sm text-muted mb-8">
          National approval and the named conditions that adjust it — plus their knock-on effects on
          in-state sector profit margins.
        </p>

        {loading && (
          <div className="rounded-xl border border-card-border bg-card p-12 text-center">
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        )}

        {error && !loading && (
          <div className="rounded-xl border border-card-border bg-card p-8 text-center">
            <p className="text-sm text-error mb-4">{error}</p>
            <button
              onClick={load}
              className="rounded-lg border border-card-border bg-card px-4 py-2 text-sm font-medium text-muted hover:text-foreground transition-colors"
            >
              Retry
            </button>
          </div>
        )}

        {!loading && !error && (
          <div className="space-y-6">
            {/* Government Approval */}
            {governmentApproval != null && (
              <div className="rounded-xl border border-card-border bg-card p-6 shadow-panel">
                <p className="text-xs uppercase tracking-widest text-muted font-medium mb-1">
                  Government Approval
                </p>
                <p
                  className={`text-5xl font-bold tabular-nums ${approvalColor(governmentApproval)}`}
                >
                  {governmentApproval.toFixed(1)}%
                </p>
                <p className="text-xs text-muted mt-2">
                  Population-weighted average of {config.regionLabel.toLowerCase()} approval, as of
                  the latest turn.
                </p>
              </div>
            )}

            {/* Active Effects / Modifiers */}
            <div className="rounded-xl border border-card-border bg-card p-6 shadow-panel">
              <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
                <h2 className="text-xs font-semibold uppercase tracking-widest text-muted">
                  Active Effects
                </h2>
                {modifiers.length > 0 && (
                  <div className="flex gap-4 text-right text-xs">
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-muted">
                        Net approval
                      </div>
                      <div
                        className={
                          "mt-0.5 font-semibold tabular-nums " +
                          (netApproval > 0
                            ? "text-emerald-500"
                            : netApproval < 0
                              ? "text-rose-500"
                              : "text-muted")
                        }
                      >
                        {netApproval > 0 ? "+" : ""}
                        {netApproval}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-muted">
                        Net margin
                      </div>
                      <div
                        className={
                          "mt-0.5 font-semibold tabular-nums " +
                          (netMargin > 0
                            ? "text-emerald-500"
                            : netMargin < 0
                              ? "text-rose-500"
                              : "text-muted")
                        }
                      >
                        {netMargin > 0 ? "+" : ""}
                        {netMargin}pp
                      </div>
                    </div>
                  </div>
                )}
              </div>
              <ModifierList modifiers={modifiers} emptyText="No active effects." />
            </div>

            {/* Turn history */}
            {history.length > 0 && (
              <div className="rounded-xl border border-card-border bg-card p-6 shadow-panel">
                <h2 className="text-xs font-semibold uppercase tracking-widest text-muted mb-4">
                  History (last {history.length} turns)
                </h2>
                <div className="flex items-end gap-1 h-16">
                  {history.map((h, i) => {
                    const pct = Math.max(0, Math.min(100, h.approval));
                    const color = pct >= 50 ? "bg-success" : pct >= 40 ? "bg-warning" : "bg-error";
                    return (
                      <div
                        key={i}
                        title={`Turn ${h.turn}: ${h.approval.toFixed(1)}%`}
                        className={`flex-1 rounded-sm ${color} opacity-80 hover:opacity-100 transition-opacity`}
                        style={{ height: `${pct}%` }}
                      />
                    );
                  })}
                </div>
                <div className="flex justify-between mt-1 text-[10px] text-muted">
                  <span>Turn {history[0]?.turn}</span>
                  <span>Turn {history[history.length - 1]?.turn}</span>
                </div>
              </div>
            )}

            {/* State/region rankings */}
            {sortedStates.length > 0 && (
              <div className="rounded-xl border border-card-border bg-card p-6 shadow-panel">
                <h2 className="text-xs font-semibold uppercase tracking-widest text-muted mb-4">
                  {config.regionLabel} Rankings
                </h2>
                <div className="space-y-1">
                  {sortedStates.map((s, i) => {
                    const stateHref = regionApprovalUrl(country, s.stateId);
                    return (
                      <Link
                        key={s.stateId}
                        href={stateHref}
                        className="flex items-center gap-3 rounded-lg px-3 py-2.5 bg-card-muted/40 hover:bg-card-elevated/60 transition-colors"
                      >
                        <span className="text-xs text-muted w-6 text-right shrink-0">#{i + 1}</span>
                        <span className="text-sm flex-1">{s.stateName}</span>
                        <span className="text-xs text-muted tabular-nums">
                          base {s.baseApproval.toFixed(0)}%
                        </span>
                        <span
                          className={`text-sm font-semibold tabular-nums ${approvalColor(s.approval)}`}
                        >
                          {s.approval.toFixed(1)}%
                        </span>
                        {s.modifiers.length > 0 && (
                          <span className="text-[10px] text-muted">
                            {s.modifiers.length} effect{s.modifiers.length !== 1 ? "s" : ""}
                          </span>
                        )}
                      </Link>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Back nav */}
        <div className="mt-8 flex items-center gap-3 pt-4 border-t border-card-border/40">
          <Link
            href={`/country/${config.code.toLowerCase()}`}
            className="rounded-lg border border-card-border bg-card px-4 py-2 text-sm font-medium text-muted hover:text-foreground transition-colors"
          >
            ← {config.name} Overview
          </Link>
          {(POLITICAL_METRIC_COUNTRY_IDS as readonly string[]).includes(config.id) ? (
            // SP6: playables' metrics product is the political registry.
            <Link
              href={politicalMetricsUrl(config.id)}
              className="rounded-lg border border-card-border bg-card px-4 py-2 text-sm font-medium text-muted hover:text-foreground transition-colors"
            >
              Political Metrics
            </Link>
          ) : (
            <Link
              href={`/country/${config.code.toLowerCase()}/metrics`}
              className="rounded-lg border border-card-border bg-card px-4 py-2 text-sm font-medium text-muted hover:text-foreground transition-colors"
            >
              National Metrics
            </Link>
          )}
        </div>
      </main>
    </div>
  );
}
