"use client";

import { forwardRef, useCallback, type ReactNode } from "react";
import { BLEND, BLEND_LABEL, FONT } from "@/components/blend/tokens";
import {
  describeTrend,
  formatPollChange,
  pollChangeHint,
  type PresMapModel,
  type PresMapState,
  type PresMapTrend,
} from "./presMapModel";
import { CountySection } from "./CountySection";

const TIER_LABEL = { safe: "Safe", likely: "Likely", lean: "Lean", tossup: "Toss-up" } as const;

export interface StatePanelProps {
  state: PresMapState;
  model: PresMapModel;
  electionId: string;
  countryId: string;
  turn: number | null;
  onClose: () => void;
}

/**
 * The state overview that opens when a state is clicked: who leads and by how
 * much, each ticket's projected share with its change since last turn, which
 * way the state is moving, and the county results. Chrome (overlay or bottom
 * sheet) is the caller's; this is only the content.
 */
export const StatePanel = forwardRef<HTMLDivElement, StatePanelProps>(function StatePanel(
  { state, model, electionId, countryId: _countryId, turn, onClose },
  ref
) {
  // Colour and name for any candidate id the county API returns.
  const candidate = useCallback(
    (id: string) => model.candidates[id] ?? { name: "Unknown", color: "#9CA3AF" },
    [model]
  );

  const hint = pollChangeHint(state.turnsAgo, state.sinceTurn);

  return (
    <div
      ref={ref}
      tabIndex={-1}
      style={{ outline: "none", fontFamily: FONT.sans, color: BLEND.ink }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ ...BLEND_LABEL, fontSize: 11, letterSpacing: ".08em" }}>
            {state.id} / {state.ev} ELECTORAL {state.ev === 1 ? "VOTE" : "VOTES"}
          </div>
          <h3 style={{ margin: "2px 0 0", fontSize: 21, fontWeight: 600, lineHeight: 1.15 }}>
            {state.name}
          </h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close state overview"
          style={{
            flex: "none",
            width: 32,
            height: 32,
            display: "grid",
            placeItems: "center",
            cursor: "pointer",
            border: `1px solid ${BLEND.hairlineStrong}`,
            background: "transparent",
            color: BLEND.muted,
            font: "inherit",
            fontSize: 18,
            lineHeight: 1,
          }}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
            <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.6" fill="none" />
          </svg>
        </button>
      </div>

      <div
        style={{
          marginTop: 12,
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 12px",
          background: BLEND.inset,
          border: `1px solid ${BLEND.hairline}`,
        }}
      >
        <i
          aria-hidden
          style={{ width: 12, height: 34, flex: "none", display: "block", background: state.fill }}
        />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14.5, fontWeight: 600 }}>
            {state.leaderName}
            <span style={{ fontWeight: 400, color: BLEND.muted }}> leads</span>
          </div>
          <div style={{ fontFamily: FONT.mono, fontSize: 11.5, color: BLEND.muted, marginTop: 2 }}>
            +{state.margin.toFixed(1)}pp / {TIER_LABEL[state.tier]}
          </div>
        </div>
      </div>

      <PanelBlock title="Projected vote">
        {state.shares.map((share) => {
          const badge = share.changePp === null ? null : formatPollChange(share.changePp);
          return (
            <div
              key={share.id}
              style={{ padding: "8px 0", borderBottom: `1px solid ${BLEND.hairline}` }}
            >
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <i
                  aria-hidden
                  style={{
                    width: 9,
                    height: 9,
                    flex: "none",
                    display: "block",
                    background: share.color,
                    alignSelf: "center",
                  }}
                />
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    fontSize: 14,
                    fontWeight: 500,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {share.name}
                </span>
                <span style={{ fontFamily: FONT.mono, fontSize: 15, fontWeight: 500 }}>
                  {share.pct.toFixed(1)}%
                </span>
                {badge ? (
                  <span
                    title={hint}
                    aria-label={`Change ${badge.text}. ${hint}`}
                    style={{
                      minWidth: 48,
                      textAlign: "center",
                      padding: "1px 6px",
                      cursor: "help",
                      fontFamily: FONT.mono,
                      fontSize: 11,
                      fontWeight: 600,
                      color:
                        badge.tone === "up"
                          ? BLEND.positive
                          : badge.tone === "down"
                            ? BLEND.negative
                            : BLEND.muted,
                      background:
                        badge.tone === "up"
                          ? "rgba(34,197,94,.12)"
                          : badge.tone === "down"
                            ? "rgba(239,68,68,.12)"
                            : BLEND.track,
                    }}
                  >
                    {badge.text}
                  </span>
                ) : null}
              </div>
              <div
                style={{
                  marginTop: 6,
                  height: 3,
                  background: BLEND.trackAlt,
                  position: "relative",
                  overflow: "hidden",
                }}
              >
                <i
                  style={{
                    position: "absolute",
                    inset: 0,
                    width: `${Math.min(100, share.pct).toFixed(1)}%`,
                    background: share.color,
                    display: "block",
                  }}
                />
              </div>
              <div
                style={{
                  marginTop: 5,
                  fontFamily: FONT.mono,
                  fontSize: 11,
                  color: BLEND.mutedDim,
                }}
              >
                {Math.round(share.votes).toLocaleString("en-US")} votes
                {share.ev > 0 && share.ev !== state.ev ? ` / ${share.ev} EV` : ""}
              </div>
            </div>
          );
        })}
        <p style={{ margin: "7px 0 0", fontSize: 11.5, color: BLEND.mutedDim }}>
          Badges show the change in projected share{" "}
          {state.turnsAgo === 1 || state.turnsAgo === null
            ? "since last turn"
            : `over the last ${state.turnsAgo} turns`}
          , in percentage points.
        </p>
      </PanelBlock>

      <PanelBlock title="Direction">
        <TrendReadout
          trend={state.trend}
          colors={Object.fromEntries(state.shares.map((sh) => [sh.id, sh.color]))}
        />
      </PanelBlock>

      <PanelBlock title="Counties">
        <CountySection
          electionId={electionId}
          stateId={state.id}
          turn={turn}
          candidate={candidate}
        />
      </PanelBlock>
    </div>
  );
});

function PanelBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ marginTop: 18 }}>
      <div
        style={{
          ...BLEND_LABEL,
          fontFamily: FONT.mono,
          fontSize: 10.5,
          letterSpacing: ".1em",
          textTransform: "uppercase",
          color: BLEND.mutedDim,
          paddingBottom: 6,
          borderBottom: `1px solid ${BLEND.hairlineStrong}`,
        }}
      >
        {title}
      </div>
      <div style={{ marginTop: 8 }}>{children}</div>
    </section>
  );
}

function TrendReadout({ trend, colors }: { trend: PresMapTrend; colors: Record<string, string> }) {
  const hint =
    "Compares the latest projection with the one a few turns earlier. The ticket with the biggest share gain is the one the state is moving toward.";
  return (
    <div>
      <div
        title={hint}
        style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, cursor: "help" }}
      >
        {trend.status === "toward" && trend.color ? (
          <i
            aria-hidden
            style={{ width: 9, height: 9, flex: "none", display: "block", background: trend.color }}
          />
        ) : null}
        <span style={{ color: trend.status === "none" ? BLEND.mutedDim : BLEND.ink }}>
          {describeTrend(trend)}
        </span>
      </div>
      <Sparkline trend={trend} colors={colors} />
    </div>
  );
}

/** Top two tickets' shares by turn. Drawn only once there are two points. */
function Sparkline({ trend, colors }: { trend: PresMapTrend; colors: Record<string, string> }) {
  const { series } = trend;
  if (series.length < 2) return null;
  const ids = Object.keys(series[0].shares);
  const values = series.flatMap((p) => ids.map((id) => p.shares[id] ?? 0));
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pad = Math.max(0.5, (hi - lo) * 0.15);
  const min = lo - pad;
  const span = hi + pad - min;
  const W = 240;
  const H = 44;
  const x = (i: number) => (i / (series.length - 1)) * W;
  const y = (v: number) => H - ((v - min) / span) * H;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label="Projected share of the top two tickets over recent turns"
      style={{ display: "block", width: "100%", height: H, marginTop: 8, background: BLEND.inset }}
    >
      {ids.map((id) => (
        <polyline
          key={id}
          fill="none"
          style={{ stroke: colors[id] ?? BLEND.muted }}
          strokeWidth={1.6}
          vectorEffect="non-scaling-stroke"
          points={series
            .map((p, i) => `${x(i).toFixed(1)},${y(p.shares[id] ?? 0).toFixed(1)}`)
            .join(" ")}
        />
      ))}
    </svg>
  );
}
