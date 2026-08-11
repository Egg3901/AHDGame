"use client";

// DetectionHealthPanel (forensics-v2 Wave 3, admin-only) — the two questions
// the ranked cluster list cannot answer:
//
//  1. "Is the confidence number trustworthy?" — the calibration report
//     (GET /api/admin/alts/calibration): a reliability plot of predicted vs.
//     observed confirm rate over dispositioned rings, a Brier skill score
//     against the base-rate prior, and a precision/recall sweep that says
//     whether the auto-open threshold is set in the right place.
//  2. "Is the detector still running properly?" — the run telemetry report
//     (GET /api/admin/alts/metrics): candidate volume, confidence
//     distribution, and per-signal firing trends across recent hourly runs,
//     with explicit warnings when a signal that used to fire has gone
//     silent (usually an upstream data break, not fewer alts).
//
// Both endpoints are read-only and advisory. Any threshold or weight change
// they suggest is applied by hand through the ScoringConfigPanel.

import { useEffect, useState } from "react";
import {
  confidenceHex,
  formatPct,
  formatRelativeTime,
  signalMeta,
  type CalibrationReport,
  type MetricsReport,
} from "./altTypes";

interface DetectionHealthPanelProps {
  notify?: (msg: string, kind: "success" | "error" | "info") => void;
}

const CARD_CLS = "rounded-xl border border-card-border bg-card p-4";
const LABEL_CLS = "text-[11px] font-medium uppercase tracking-wide text-muted";

function StatTile({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "neutral" | "good" | "warn" | "bad";
}) {
  const toneCls =
    tone === "good"
      ? "text-green-400"
      : tone === "warn"
        ? "text-yellow-400"
        : tone === "bad"
          ? "text-red-400"
          : "text-foreground";
  return (
    <div className="rounded-lg border border-card-border/70 bg-card-elevated/40 px-3 py-2.5">
      <div className={LABEL_CLS}>{label}</div>
      <div className={`mt-0.5 text-lg font-semibold tabular-nums ${toneCls}`}>{value}</div>
      {hint && <div className="mt-0.5 text-[11px] leading-snug text-muted">{hint}</div>}
    </div>
  );
}

/** Reliability plot as a bar pair per bin: what we predicted vs. what
 * moderators actually confirmed. A well-calibrated model has matching pairs. */
function ReliabilityBins({ report }: { report: CalibrationReport }) {
  const populated = report.bins.filter((b) => b.count > 0);
  if (populated.length === 0) {
    return (
      <p className="text-sm text-muted">
        No dispositioned rings to plot yet — confirm or dismiss some clusters and this fills in.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      {populated.map((bin) => (
        <div key={bin.lower} className="flex items-center gap-3">
          <div className="w-20 shrink-0 text-[11px] tabular-nums text-muted">
            {formatPct(bin.lower)}–{formatPct(bin.upper)}
          </div>
          <div className="flex-1 space-y-1">
            <div className="flex items-center gap-2">
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-card-elevated">
                <div
                  className="h-full rounded-full opacity-60"
                  style={{
                    width: `${Math.max(1, bin.meanPredicted * 100)}%`,
                    backgroundColor: confidenceHex(bin.meanPredicted),
                  }}
                />
              </div>
              <span className="w-24 shrink-0 text-[11px] tabular-nums text-muted">
                predicted {formatPct(bin.meanPredicted)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-card-elevated">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.max(1, bin.observedRate * 100)}%`,
                    backgroundColor: confidenceHex(bin.observedRate),
                  }}
                />
              </div>
              <span className="w-24 shrink-0 text-[11px] tabular-nums text-muted">
                observed {formatPct(bin.observedRate)}
              </span>
            </div>
          </div>
          <div className="w-32 shrink-0 text-right text-[11px] tabular-nums text-muted">
            {bin.confirmedCount}/{bin.count} confirmed
            {bin.lowSample && (
              <span
                className="ml-1 text-yellow-400"
                title="Fewer than 3 rings in this bin — shown, but excluded from the calibration error."
              >
                (thin)
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function CalibrationSection({ report }: { report: CalibrationReport }) {
  const eceTone =
    report.expectedCalibrationError <= 0.1
      ? "good"
      : report.expectedCalibrationError <= 0.2
        ? "warn"
        : "bad";
  const skillTone = report.skillScore > 0.2 ? "good" : report.skillScore > 0 ? "warn" : "bad";

  return (
    <div className={`${CARD_CLS} space-y-4`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold tracking-tight">Confidence calibration</h3>
        <span className="text-[11px] text-muted">
          {report.confirmedTotal} confirmed / {report.dismissedTotal} dismissed rings
        </span>
      </div>

      <p
        className={`rounded-lg border px-3 py-2 text-sm leading-snug ${
          report.lowConfidence
            ? "border-yellow-400/25 bg-yellow-500/10 text-yellow-200"
            : "border-card-border/70 bg-card-elevated/40 text-foreground"
        }`}
      >
        {report.verdict}
      </p>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Brier score"
          value={report.brierScore.toFixed(3)}
          hint={`vs ${report.brierScoreBaseline.toFixed(3)} for always guessing the base rate`}
          tone={report.brierScore < report.brierScoreBaseline ? "good" : "bad"}
        />
        <StatTile
          label="Skill score"
          value={report.skillScore.toFixed(3)}
          hint="Above 0 means the confidence beats the prior"
          tone={skillTone}
        />
        <StatTile
          label="Calibration error"
          value={report.expectedCalibrationError.toFixed(3)}
          hint={`worst bin ${report.maxCalibrationError.toFixed(3)}`}
          tone={eceTone}
        />
        <StatTile
          label="Bias"
          value={`${report.calibrationBias >= 0 ? "+" : ""}${report.calibrationBias.toFixed(3)}`}
          hint={report.calibrationBias < 0 ? "Overconfident" : "Underconfident"}
          tone={Math.abs(report.calibrationBias) <= 0.1 ? "good" : "warn"}
        />
      </div>

      <div>
        <div className={`${LABEL_CLS} mb-2`}>Reliability — predicted vs. observed</div>
        <ReliabilityBins report={report} />
      </div>

      <div>
        <div className={`${LABEL_CLS} mb-2`}>Auto-open threshold</div>
        {report.recommendedClusterThreshold !== null ? (
          <p className="rounded-lg border border-blue-400/25 bg-blue-500/10 px-3 py-2 text-sm text-blue-200">
            Currently {formatPct(report.currentClusterThreshold)}. The best F1 over dispositioned
            rings is at <strong>{formatPct(report.recommendedClusterThreshold)}</strong> — apply it
            in the scoring config if you agree.
          </p>
        ) : (
          <p className="text-sm text-muted">
            Currently {formatPct(report.currentClusterThreshold)} — no better threshold found in the
            sweep{report.lowConfidence ? " (too few dispositioned rings to recommend one)" : ""}.
          </p>
        )}
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[28rem] text-left text-xs">
            <thead className="text-muted">
              <tr>
                <th className="py-1 pr-3 font-medium">Threshold</th>
                <th className="py-1 pr-3 font-medium">Precision</th>
                <th className="py-1 pr-3 font-medium">Recall</th>
                <th className="py-1 pr-3 font-medium">F1</th>
                <th className="py-1 font-medium">Missed rings</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {report.thresholdSweep.map((point) => {
                const isCurrent = point.threshold === report.currentClusterThreshold;
                return (
                  <tr
                    key={point.threshold}
                    className={isCurrent ? "bg-card-elevated/60 text-foreground" : "text-muted"}
                  >
                    <td className="py-1 pr-3">
                      {formatPct(point.threshold)}
                      {isCurrent && <span className="ml-1 text-[10px] uppercase">current</span>}
                    </td>
                    <td className="py-1 pr-3">{formatPct(point.precision)}</td>
                    <td className="py-1 pr-3">{formatPct(point.recall)}</td>
                    <td className="py-1 pr-3">{point.f1.toFixed(2)}</td>
                    <td className="py-1">{point.falseNegatives}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <div className={`${LABEL_CLS} mb-2`}>Signal precision (lift over base rate)</div>
        <div className="space-y-1">
          {report.signalPrecision
            .filter((s) => s.occurrences > 0)
            .slice(0, 10)
            .map((s) => (
              <div key={s.signal} className="flex items-center gap-3 text-xs">
                <span className="w-44 shrink-0 truncate text-foreground" title={s.signal}>
                  {signalMeta(s.signal).label}
                </span>
                <span className="w-24 shrink-0 tabular-nums text-muted">
                  {s.confirmedCount}/{s.occurrences} rings
                </span>
                <span
                  className={`w-16 shrink-0 tabular-nums ${
                    s.lift > 0 ? "text-green-400" : s.lift < 0 ? "text-red-400" : "text-muted"
                  }`}
                >
                  {s.lift >= 0 ? "+" : ""}
                  {s.lift.toFixed(2)}
                </span>
                {s.lowConfidence && (
                  <span className="text-[10px] uppercase text-yellow-400">thin</span>
                )}
              </div>
            ))}
          {report.signalPrecision.every((s) => s.occurrences === 0) && (
            <p className="text-sm text-muted">
              No signals have appeared in a dispositioned ring yet.
            </p>
          )}
        </div>
      </div>

      <details className="text-xs text-muted">
        <summary className="cursor-pointer select-none">How this is computed</summary>
        <p className="mt-2 leading-relaxed">{report.method}</p>
      </details>
    </div>
  );
}

function MetricsSection({ report }: { report: MetricsReport }) {
  const latest = report.latestRun;
  const declining = report.signalTrends.filter((t) => t.delta < 0).slice(0, 8);

  return (
    <div className={`${CARD_CLS} space-y-4`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold tracking-tight">Pipeline health</h3>
        <span className="text-[11px] text-muted">
          {latest ? `last run ${formatRelativeTime(latest.at)}` : "no runs recorded yet"}
        </span>
      </div>

      {report.warnings.length > 0 && (
        <ul className="space-y-1.5">
          {report.warnings.map((warning) => (
            <li
              key={warning}
              className="rounded-lg border border-yellow-400/25 bg-yellow-500/10 px-3 py-2 text-sm leading-snug text-yellow-200"
            >
              {warning}
            </li>
          ))}
        </ul>
      )}

      {latest ? (
        <>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile
              label="Candidates"
              value={String(latest.candidateCount)}
              hint={latest.candidatePoolTruncated ? "Pool truncated" : "Pool complete"}
              tone={latest.candidatePoolTruncated ? "warn" : "neutral"}
            />
            <StatTile
              label="Links scored"
              value={String(latest.linksComputed)}
              hint={`${latest.newLinkCount} new, ${latest.escalationCount} escalated`}
              tone={latest.linksComputed === 0 ? "warn" : "neutral"}
            />
            <StatTile
              label="Rings opened"
              value={String(latest.clustersOpened)}
              hint={`${latest.clustersComputed} computed`}
            />
            <StatTile
              label="Run time"
              value={`${(latest.durationMs / 1000).toFixed(1)}s`}
              hint={
                latest.error
                  ? "Last run errored"
                  : `p95 confidence ${formatPct(latest.p95LinkConfidence)}`
              }
              tone={latest.error ? "bad" : "neutral"}
            />
          </div>

          <div>
            <div className={`${LABEL_CLS} mb-2`}>Link confidence distribution (last run)</div>
            <div className="flex items-end gap-1" role="img" aria-label="Confidence histogram">
              {latest.confidenceHistogram.map((count, i) => {
                const max = Math.max(1, ...latest.confidenceHistogram);
                const mid = (i + 0.5) / 10;
                return (
                  <div key={i} className="flex flex-1 flex-col items-center gap-1">
                    <span className="text-[10px] tabular-nums text-muted">{count || ""}</span>
                    <div
                      className="w-full rounded-t"
                      style={{
                        height: `${Math.max(2, (count / max) * 64)}px`,
                        backgroundColor: confidenceHex(mid),
                        opacity: count === 0 ? 0.15 : 0.85,
                      }}
                    />
                    <span className="text-[10px] tabular-nums text-muted">{i * 10}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      ) : (
        <p className="text-sm text-muted">
          No scoring runs have been recorded yet. The hourly cron writes one record per pass — this
          fills in after the next run.
        </p>
      )}

      {declining.length > 0 && (
        <div>
          <div className={`${LABEL_CLS} mb-2`}>
            Signals firing less than before (per-run average)
          </div>
          <div className="space-y-1">
            {declining.map((trend) => (
              <div key={trend.type} className="flex items-center gap-3 text-xs">
                <span className="w-44 shrink-0 truncate text-foreground" title={trend.type}>
                  {signalMeta(trend.type).label}
                </span>
                <span className="w-28 shrink-0 tabular-nums text-muted">
                  {trend.priorMeanFired} → {trend.recentMeanFired}
                </span>
                <span className="w-16 shrink-0 tabular-nums text-red-400">
                  {trend.delta.toFixed(2)}
                </span>
                {trend.wentSilent && (
                  <span className="text-[10px] uppercase text-red-400">silent</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function DetectionHealthPanel({ notify }: DetectionHealthPanelProps) {
  const [calibration, setCalibration] = useState<CalibrationReport | null>(null);
  const [metrics, setMetrics] = useState<MetricsReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [calRes, metRes] = await Promise.all([
          fetch("/api/admin/alts/calibration"),
          fetch("/api/admin/alts/metrics"),
        ]);
        if (!calRes.ok || !metRes.ok) {
          const failed = !calRes.ok ? calRes : metRes;
          const data = await failed.json().catch(() => ({}));
          throw new Error(data.error ?? `Request failed (${failed.status})`);
        }
        const [cal, met] = await Promise.all([calRes.json(), metRes.json()]);
        if (cancelled) return;
        setCalibration(cal as CalibrationReport);
        setMetrics(met as MetricsReport);
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : "Failed to load detection health";
        setError(msg);
        notify?.(msg, "error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [notify]);

  if (loading) {
    return (
      <div className="space-y-4" aria-hidden>
        <div className="h-64 animate-pulse rounded-xl border border-card-border bg-card motion-reduce:animate-none" />
        <div className="h-48 animate-pulse rounded-xl border border-card-border bg-card motion-reduce:animate-none" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-8 text-center text-sm text-red-400">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {calibration && <CalibrationSection report={calibration} />}
      {metrics && <MetricsSection report={metrics} />}
    </div>
  );
}
