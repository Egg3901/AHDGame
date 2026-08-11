"use client";

// SignalBreakdown (plan §4.8): the "why is this flagged?" panel. Renders each
// signal's MARGINAL contribution (P − P_without_i, computed server-side in
// `cluster/[id]`) as a waterfall — a stacked bar that accumulates to the
// cluster confidence — plus a per-signal ledger. False-positive guards
// (CF-edge IPs, degenerate fingerprints) are shown explicitly as scored-to-0
// so a moderator can see the score was NOT inflated by them.

import {
  clamp01,
  confidenceHex,
  formatPct,
  formatPctPrecise,
  signalMeta,
  TIER_HEX,
  TIER_LABEL,
  type SignalContribution,
  type SignalTier,
} from "./altTypes";

interface GuardedSignal {
  type: SignalContribution["type"];
  evidence: string;
}

interface SignalBreakdownProps {
  confidence: number;
  /** Per-signal marginal contributions, strongest first (from the API). */
  contributions: SignalContribution[];
  /** Signals that matched but were guarded to weight 0 (from link scan). */
  guards?: GuardedSignal[];
}

function TierDot({ tier }: { tier: SignalTier }) {
  return (
    <span
      className="inline-block h-2 w-2 flex-shrink-0 rounded-full"
      style={{ backgroundColor: TIER_HEX[tier] }}
      title={`${TIER_LABEL[tier]} signal`}
    />
  );
}

export function SignalBreakdown({ confidence, contributions, guards = [] }: SignalBreakdownProps) {
  const total = clamp01(confidence);
  const positive = contributions.filter((c) => c.contribution > 0);
  const sumContrib = positive.reduce((acc, c) => acc + c.contribution, 0);

  // Normalize contributions to the actual confidence so the stacked segments
  // fill exactly the confidence bar (marginal contributions in a noisy-OR
  // don't sum to the total; we scale to keep the waterfall honest to the %).
  const scale = sumContrib > 0 ? total / sumContrib : 0;

  return (
    <div className="space-y-5">
      <div>
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <h4 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
            Why this score
          </h4>
          <span className="text-xs text-muted">
            {positive.length} signal{positive.length === 1 ? "" : "s"} · aggregated by noisy-OR
          </span>
        </div>

        {/* Waterfall / stacked confidence bar. Recessed track; 2px surface
            gaps between segments so each contribution reads as its own mark. */}
        <div className="flex h-8 w-full gap-[2px] overflow-hidden rounded-lg border border-card-border/70 bg-card-muted p-[3px]">
          {positive.map((c, i) => {
            const meta = signalMeta(c.type);
            const widthPct = c.contribution * scale * 100;
            return (
              <div
                key={`${c.type}-${i}`}
                className="h-full min-w-[3px] rounded-[4px] transition-all motion-reduce:transition-none"
                style={{ width: `${widthPct}%`, backgroundColor: TIER_HEX[meta.tier] }}
                title={`${meta.label}: +${formatPctPrecise(c.contribution)} (weight ${c.weight.toFixed(2)})`}
              />
            );
          })}
        </div>
        <div className="mt-1.5 flex items-baseline justify-between text-[10px] tabular-nums text-muted">
          <span>0%</span>
          <span className="text-xs font-semibold" style={{ color: confidenceHex(total) }}>
            = {formatPct(total)} ring confidence
          </span>
          <span>100%</span>
        </div>
      </div>

      {/* Per-signal ledger */}
      <ul className="space-y-1">
        {positive.map((c, i) => {
          const meta = signalMeta(c.type);
          const barPct = sumContrib > 0 ? (c.contribution / positive[0].contribution) * 100 : 0;
          return (
            <li
              key={`${c.type}-${i}`}
              className="space-y-1.5 rounded-lg px-2 py-2 transition-colors hover:bg-card-elevated/50 motion-reduce:transition-none"
            >
              <div className="flex items-center gap-2">
                <TierDot tier={meta.tier} />
                <span className="min-w-0 truncate text-sm font-medium">{meta.label}</span>
                <span
                  className="rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                  style={{
                    backgroundColor: `${TIER_HEX[meta.tier]}1f`,
                    color: TIER_HEX[meta.tier],
                  }}
                >
                  {TIER_LABEL[meta.tier]}
                </span>
                <span className="ml-auto flex flex-shrink-0 items-baseline gap-2">
                  <span className="font-mono text-[11px] text-muted">w {c.weight.toFixed(2)}</span>
                  <span
                    className="min-w-[3rem] text-right text-xs font-semibold tabular-nums"
                    style={{ color: TIER_HEX[meta.tier] }}
                  >
                    +{formatPctPrecise(c.contribution)}
                  </span>
                </span>
              </div>
              <div className="ml-4 h-1 overflow-hidden rounded-full bg-track">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${barPct}%`, backgroundColor: TIER_HEX[meta.tier] }}
                />
              </div>
              {c.evidence && (
                <p className="ml-4 text-xs leading-relaxed text-muted">{c.evidence}</p>
              )}
            </li>
          );
        })}
        {positive.length === 0 && (
          <li className="rounded-lg border border-dashed border-card-border px-3 py-4 text-center text-sm text-muted">
            No positively-weighted signals contributed.
          </li>
        )}
      </ul>

      {/* False-positive guards — VISIBLE per acceptance criterion */}
      {guards.length > 0 && (
        <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-3">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-emerald-400">
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
              />
            </svg>
            False-positive guards applied — did NOT inflate this score
          </div>
          <ul className="space-y-1.5">
            {guards.map((g, i) => {
              const meta = signalMeta(g.type);
              return (
                <li key={`${g.type}-${i}`} className="flex items-start gap-2 text-xs text-muted">
                  <span className="mt-px rounded bg-emerald-500/10 px-1 font-mono text-[10px] leading-4 text-emerald-400/90">
                    ×0
                  </span>
                  <span className="leading-relaxed">
                    <span className="font-medium text-foreground/80">{meta.label}:</span>{" "}
                    {g.evidence}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
