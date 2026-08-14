"use client";

import React, { useMemo, useState } from "react";
import { BarChart2, LayoutList, TrendingUp, Vote, ZoomIn } from "lucide-react";
import { PartyLogo } from "@/components/PartyLogo";
import { LocalTime } from "@/components/time/LocalTime";
import { buildCandidateColorMap } from "@/lib/campaigns/candidateColor";
import type { CandidateDetail, SnapshotPoint, VoteTurnSnapshot } from "./ElectionDetailTypes";
import type { CountryId } from "@/lib/constants/countries";

export function PieChart({
  slices,
  size = 80,
}: {
  slices: { label: string; pct: number; color: string }[];
  size?: number;
}) {
  if (slices.length === 0) return null;
  if (slices.length === 1) {
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={size / 2 - 2} fill={slices[0].color} />
      </svg>
    );
  }

  const cx = size / 2,
    cy = size / 2,
    r = size / 2 - 2;

  type SliceWithAngles = {
    label: string;
    pct: number;
    color: string;
    startAngle: number;
    endAngle: number;
    angle: number;
  };
  const { items: computedSlices } = slices.reduce<{ items: SliceWithAngles[]; nextAngle: number }>(
    (acc, s) => {
      const share = s.pct / 100;
      const angle = share * 2 * Math.PI;
      const startAngle = acc.nextAngle;
      const endAngle = acc.nextAngle + angle;
      acc.items.push({ ...s, startAngle, endAngle, angle });
      acc.nextAngle = endAngle;
      return acc;
    },
    { items: [], nextAngle: -Math.PI / 2 }
  );

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {computedSlices.map((s, i) => {
        const { startAngle, endAngle, angle } = s;
        const x1 = cx + r * Math.cos(startAngle);
        const y1 = cy + r * Math.sin(startAngle);
        const x2 = cx + r * Math.cos(endAngle);
        const y2 = cy + r * Math.sin(endAngle);
        const largeArc = angle > Math.PI ? 1 : 0;
        return (
          <path
            key={i}
            d={`M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`}
            fill={s.color}
            stroke="var(--card-border)"
            strokeWidth={1}
          >
            <title>{`${s.label}: ${s.pct.toFixed(1)}%`}</title>
          </path>
        );
      })}
    </svg>
  );
}

export function primaryPieSlices(
  candidates: CandidateDetail[]
): { label: string; pct: number; color: string }[] {
  if (candidates.length === 0) return [];
  const party = candidates[0];
  // Use the same color source as the candidate bar so chart and bar agree.
  const colorMap = buildCandidateColorMap(
    candidates.map((c) => ({ candidateId: c.id, campaignColor: c.campaignColor ?? null })),
    party.party,
    party.partyColor
  );
  return candidates.map((c) => ({
    label: c.characterName,
    pct: c.sharePct ?? 0,
    color: colorMap[c.id] ?? party.partyColor,
  }));
}

export function PrimaryLineGraph({
  snapshots,
  partyId,
  candidates,
  countryId,
}: {
  snapshots: SnapshotPoint[];
  partyId: string;
  candidates: CandidateDetail[];
  countryId: CountryId;
}) {
  const W = 420,
    H = 140,
    PAD = { top: 12, right: 16, bottom: 28, left: 32 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  // Only include points where all current candidates have data (avoids one-candidate phase)
  const candidateIds = new Set(candidates.map((c) => c.id));
  const points = snapshots.filter((s) => {
    const entries = s.byParty[partyId] ?? [];
    const hasAll = candidateIds.size > 0 && candidateIds.size <= entries.length;
    if (!hasAll) return false;
    const entryIds = new Set(entries.map((e) => e.candidateId));
    return [...candidateIds].every((id) => entryIds.has(id));
  });
  if (points.length < 2) {
    return (
      <div className="flex items-center justify-center h-24 text-xs text-muted/50 italic">
        Not enough history yet — snapshots recorded hourly
      </div>
    );
  }

  // Use the same color source as the candidate bar list so the line graph,
  // legend, and bar all assign the same color to a given candidate.
  const colorMap = buildCandidateColorMap(
    candidates.map((c) => ({ candidateId: c.id, campaignColor: c.campaignColor ?? null })),
    candidates[0]?.party ?? partyId,
    candidates[0]?.partyColor ?? "var(--muted)"
  );
  const series = candidates.map((cand) => {
    const color = colorMap[cand.id] ?? cand.partyColor ?? "var(--muted)";
    const coords = points.map((pt) => {
      const entry = pt.byParty[partyId]?.find((e) => e.candidateId === cand.id);
      const val = entry?.sharePct ?? null;
      return { x: 0, y: val !== null ? val : null, val }; // x,y computed after yScale
    });
    return { cand, color, coords };
  });

  // Zoom Y-axis when values are close (e.g. 49–51%) so lines are distinguishable
  const allVals = series.flatMap((s) =>
    s.coords.map((c) => c.val).filter((v): v is number => v !== null)
  );
  const dataMin = Math.min(...allVals);
  const dataMax = Math.max(...allVals);
  const dataRange = dataMax - dataMin;
  const ZOOM_THRESHOLD = 25; // zoom in when range < 25%
  const yMin = dataRange < ZOOM_THRESHOLD ? Math.max(0, dataMin - Math.max(dataRange * 0.5, 2)) : 0;
  const yMax =
    dataRange < ZOOM_THRESHOLD ? Math.min(100, dataMax + Math.max(dataRange * 0.5, 2)) : 100;
  const yRange = Math.max(yMax - yMin, 1);

  const xScale = (i: number) => PAD.left + (i / (points.length - 1)) * innerW;
  const yScale = (v: number) => PAD.top + innerH - ((v - yMin) / yRange) * innerH;

  // Update coords with computed x, y
  for (const s of series) {
    for (let pi = 0; pi < s.coords.length; pi++) {
      const c = s.coords[pi];
      s.coords[pi] = { ...c, x: xScale(pi), y: c.val !== null ? yScale(c.val) : null };
    }
  }

  const gridVals = (() => {
    if (yRange >= 90) return [25, 50, 75];
    const step = yRange <= 10 ? 2 : yRange <= 25 ? 5 : 10;
    const vals: number[] = [];
    for (let v = Math.ceil(yMin / step) * step; v <= yMax; v += step) {
      if (v >= yMin) vals.push(v);
    }
    return vals.length ? vals : [yMin, (yMin + yMax) / 2, yMax];
  })();

  const timeLabels = [0, Math.floor((points.length - 1) / 2), points.length - 1].map((i) => ({
    x: xScale(i),
    recordedAt: points[i].recordedAt,
  }));

  return (
    <div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} className="overflow-visible">
        {gridVals.map((v) => (
          <g key={v}>
            <line
              x1={PAD.left}
              y1={yScale(v)}
              x2={PAD.left + innerW}
              y2={yScale(v)}
              stroke="var(--card-border)"
              strokeDasharray="3 3"
            />
            <text
              x={PAD.left - 4}
              y={yScale(v) + 4}
              textAnchor="end"
              fontSize={8}
              fill="var(--muted)"
            >
              {v}
            </text>
          </g>
        ))}
        {timeLabels.map(({ x, recordedAt }, i) => (
          <text key={i} x={x} y={H - 4} textAnchor="middle" fontSize={8} fill="var(--muted)">
            <LocalTime value={recordedAt} options={{ hour: "2-digit", minute: "2-digit" }} />
          </text>
        ))}
        {series.map(({ color, coords }) => {
          const segments: { x: number; y: number }[][] = [];
          let current: { x: number; y: number }[] = [];
          for (const pt of coords) {
            if (pt.y !== null) {
              current.push({ x: pt.x, y: pt.y });
            } else if (current.length) {
              segments.push(current);
              current = [];
            }
          }
          if (current.length) segments.push(current);
          return segments.map((seg, si) => (
            <polyline
              key={`${color}-${si}`}
              points={seg.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="none"
              stroke={color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ));
        })}
        {series.map(({ color, coords }) => {
          const last = [...coords].reverse().find((p) => p.y !== null);
          if (!last) return null;
          return <circle key={color} cx={last.x} cy={last.y ?? 0} r={3} fill={color} />;
        })}
      </svg>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1">
        {series.map(({ cand, color }) => (
          <span key={cand.id} className="flex items-center gap-1 text-xs">
            <PartyLogo
              partyId={cand.party}
              partyColor={color}
              countryId={countryId}
              size="h-2 w-2"
            />
            {cand.characterName}
          </span>
        ))}
      </div>
    </div>
  );
}

export interface LineSeries {
  id: string;
  name: string;
  color: string;
  partyId?: string;
  countryId?: CountryId;
}

function roundCoord(n: number) {
  return Math.round(n * 1000) / 1000;
}

function edgeKey(p0: { x: number; y: number }, p1: { x: number; y: number }) {
  return `${roundCoord(p0.x)},${roundCoord(p0.y)},${roundCoord(p1.x)},${roundCoord(p1.y)}`;
}

/** Stripe repeat length in viewBox units for coincident seat-history segments. */
const TIE_STRIPE_PERIOD = 14;

function collectSeriesCoords(
  snapshots: VoteTurnSnapshot[],
  series: LineSeries[],
  yValues: (id: string, snap: VoteTurnSnapshot) => number | null,
  xScale: (i: number) => number,
  yScale: (v: number) => number
) {
  return series.map(({ id, color }) => {
    const coords = snapshots.map((snap, si) => {
      const v = yValues(id, snap);
      return { x: xScale(si), y: v !== null ? yScale(v) : null };
    });
    const segments: { x: number; y: number }[][] = [];
    let cur: { x: number; y: number }[] = [];
    for (const pt of coords) {
      if (pt.y !== null) cur.push({ x: pt.x, y: pt.y });
      else if (cur.length) {
        segments.push(cur);
        cur = [];
      }
    }
    if (cur.length) segments.push(cur);
    const last = [...coords].reverse().find((p) => p.y !== null);
    return { id, color, segments, last };
  });
}

export function LineGraph({
  snapshots,
  series,
  yValues,
  yMin = 0,
  yMax,
  yLabel,
  xLabel,
  gridCount = 4,
  stripeCoincidentSegments = false,
  thresholdLine,
}: {
  snapshots: VoteTurnSnapshot[];
  series: LineSeries[];
  yValues: (id: string, snap: VoteTurnSnapshot) => number | null;
  yMin?: number;
  yMax: number;
  yLabel: (v: number) => string;
  xLabel: (snap: VoteTurnSnapshot) => string;
  gridCount?: number;
  /** When true, identical line segments (same endpoints) are drawn once with alternating colors (e.g. tied seat counts). */
  stripeCoincidentSegments?: boolean;
  /** Optional horizontal reference line (e.g. 270-to-win threshold). */
  thresholdLine?: { value: number; label: string };
}) {
  const W = 560,
    H = 180,
    PAD = { top: 16, right: 24, bottom: 32, left: 52 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const yRange = Math.max(yMax - yMin, 1);

  const xScale = (i: number) =>
    snapshots.length < 2 ? PAD.left : PAD.left + (i / (snapshots.length - 1)) * innerW;
  const yScale = (v: number) => PAD.top + innerH - ((v - yMin) / yRange) * innerH;

  const gridVals = Array.from({ length: gridCount + 1 }, (_, i) =>
    Math.round(yMin + (yRange / gridCount) * i)
  );
  const labelCount = Math.min(snapshots.length, 6);
  const xLabels = Array.from({ length: labelCount }, (_, i) => {
    const idx = Math.round((i * (snapshots.length - 1)) / Math.max(1, labelCount - 1));
    return { x: xScale(idx), label: xLabel(snapshots[idx]) };
  });

  const reactId = React.useId().replace(/:/g, "");
  const seriesIndex = new Map(series.map((s, i) => [s.id, i] as const));

  type Edge = {
    p0: { x: number; y: number };
    p1: { x: number; y: number };
    color: string;
    id: string;
  };

  const edgeStripeData =
    stripeCoincidentSegments && snapshots.length >= 2
      ? (() => {
          const packed = collectSeriesCoords(snapshots, series, yValues, xScale, yScale);
          const buckets = new Map<string, Edge[]>();
          for (const { id, color, segments } of packed) {
            for (const seg of segments) {
              for (let i = 0; i < seg.length - 1; i++) {
                const p0 = seg[i];
                const p1 = seg[i + 1];
                if (Math.hypot(p1.x - p0.x, p1.y - p0.y) < 1e-6) continue;
                const k = edgeKey(p0, p1);
                const arr = buckets.get(k) ?? [];
                arr.push({ p0, p1, color, id });
                buckets.set(k, arr);
              }
            }
          }
          const tied: {
            p0: { x: number; y: number };
            p1: { x: number; y: number };
            colors: string[];
          }[] = [];
          const solo: Edge[] = [];
          for (const [, edges] of buckets) {
            if (edges.length >= 2) {
              const ids = [...new Set(edges.map((e) => e.id))].sort(
                (a, b) => (seriesIndex.get(a) ?? 0) - (seriesIndex.get(b) ?? 0)
              );
              const colorList = ids.map((sid) => series.find((s) => s.id === sid)!.color);
              tied.push({ p0: edges[0].p0, p1: edges[0].p1, colors: colorList });
            } else {
              solo.push(edges[0]);
            }
          }
          const dotBuckets = new Map<string, { id: string; color: string }[]>();
          for (const { id, color, last } of packed) {
            if (!last || last.y === null) continue;
            const dk = `${roundCoord(last.x)},${roundCoord(last.y)}`;
            const arr = dotBuckets.get(dk) ?? [];
            arr.push({ id, color });
            dotBuckets.set(dk, arr);
          }
          const tiedValid = tied
            .map((t) => {
              const dx = t.p1.x - t.p0.x;
              const dy = t.p1.y - t.p0.y;
              const len = Math.hypot(dx, dy);
              if (len < 1e-6) return null;
              return { ...t, ux: dx / len, uy: dy / len };
            })
            .filter((x): x is NonNullable<typeof x> => x !== null);
          return { tiedValid, solo, dotBuckets };
        })()
      : null;

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} className="overflow-visible">
      {gridVals.map((v) => (
        <g key={v}>
          <line
            x1={PAD.left}
            y1={yScale(v)}
            x2={PAD.left + innerW}
            y2={yScale(v)}
            stroke={v === 0 ? "var(--card-border)" : "var(--card-border)"}
            strokeDasharray={v === 0 ? "0" : "4 4"}
          />
          <text
            x={PAD.left - 5}
            y={yScale(v) + 4}
            textAnchor="end"
            fontSize={9}
            fill="var(--muted)"
          >
            {yLabel(v)}
          </text>
        </g>
      ))}
      <line
        x1={PAD.left}
        y1={PAD.top}
        x2={PAD.left}
        y2={PAD.top + innerH}
        stroke="var(--card-border)"
      />
      <line
        x1={PAD.left}
        y1={PAD.top + innerH}
        x2={PAD.left + innerW}
        y2={PAD.top + innerH}
        stroke="var(--card-border)"
      />
      {xLabels.map(({ x, label }, i) => (
        <text key={i} x={x} y={H - 4} textAnchor="middle" fontSize={9} fill="var(--muted)">
          {label}
        </text>
      ))}
      {thresholdLine != null &&
        thresholdLine.value >= yMin &&
        thresholdLine.value <= yMax &&
        (() => {
          const ty = yScale(thresholdLine.value);
          return (
            <g>
              <line
                x1={PAD.left}
                y1={ty}
                x2={PAD.left + innerW}
                y2={ty}
                stroke="#f59e0b"
                strokeWidth={1.5}
                strokeDasharray="4 3"
              />
              <text
                x={PAD.left + innerW + 3}
                y={ty + 4}
                fill="#f59e0b"
                fontSize={9}
                fontWeight={600}
              >
                {thresholdLine.label}
              </text>
            </g>
          );
        })()}
      {edgeStripeData ? (
        <>
          <defs>
            {edgeStripeData.tiedValid.map((t, idx) => {
              const x2 = t.p0.x + t.ux * TIE_STRIPE_PERIOD;
              const y2 = t.p0.y + t.uy * TIE_STRIPE_PERIOD;
              const n = t.colors.length;
              const stops: React.ReactNode[] = [];
              for (let i = 0; i < n; i++) {
                const a = (i / n) * 100;
                const b = ((i + 1) / n) * 100;
                stops.push(
                  <stop key={`${i}-a`} offset={`${a}%`} stopColor={t.colors[i]} />,
                  <stop key={`${i}-b`} offset={`${b}%`} stopColor={t.colors[i]} />
                );
              }
              return (
                <linearGradient
                  key={idx}
                  id={`${reactId}-tie-${idx}`}
                  x1={t.p0.x}
                  y1={t.p0.y}
                  x2={x2}
                  y2={y2}
                  gradientUnits="userSpaceOnUse"
                  spreadMethod="repeat"
                >
                  {stops}
                </linearGradient>
              );
            })}
          </defs>
          {edgeStripeData.tiedValid.map((t, idx) => (
            <line
              key={`tie-line-${idx}`}
              x1={t.p0.x}
              y1={t.p0.y}
              x2={t.p1.x}
              y2={t.p1.y}
              stroke={`url(#${reactId}-tie-${idx})`}
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
          {edgeStripeData.solo.map((e, idx) => (
            <line
              key={`solo-${e.id}-${idx}`}
              x1={e.p0.x}
              y1={e.p0.y}
              x2={e.p1.x}
              y2={e.p1.y}
              stroke={e.color}
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
          {Array.from(edgeStripeData.dotBuckets.entries()).map(([dk, dots]) => {
            const [sx, sy] = dk.split(",").map(Number);
            const r = 4;
            if (dots.length >= 2) {
              const ids = [...new Set(dots.map((d) => d.id))].sort(
                (a, b) => (seriesIndex.get(a) ?? 0) - (seriesIndex.get(b) ?? 0)
              );
              const colorList = ids.map((sid) => series.find((s) => s.id === sid)!.color);
              const n = colorList.length;
              let ang = -Math.PI / 2;
              const wedges: React.ReactNode[] = [];
              for (let i = 0; i < n; i++) {
                const a0 = ang;
                const a1 = ang + (2 * Math.PI) / n;
                const x0 = sx + r * Math.cos(a0);
                const y0 = sy + r * Math.sin(a0);
                const x1 = sx + r * Math.cos(a1);
                const y1 = sy + r * Math.sin(a1);
                wedges.push(
                  <path
                    key={i}
                    d={`M ${sx} ${sy} L ${x0} ${y0} A ${r} ${r} 0 0 1 ${x1} ${y1} Z`}
                    fill={colorList[i]}
                  />
                );
                ang = a1;
              }
              return (
                <g key={dk}>
                  {wedges}
                  <circle
                    cx={sx}
                    cy={sy}
                    r={r}
                    fill="none"
                    stroke="var(--card)"
                    strokeWidth={1.5}
                  />
                </g>
              );
            }
            const d0 = dots[0];
            return (
              <circle
                key={dk}
                cx={sx}
                cy={sy}
                r={r}
                fill={d0.color}
                stroke="var(--card)"
                strokeWidth={1.5}
              />
            );
          })}
        </>
      ) : (
        collectSeriesCoords(snapshots, series, yValues, xScale, yScale).map(
          ({ id, color, segments, last }) => (
            <g key={id}>
              {segments.map((seg, si) => (
                <polyline
                  key={si}
                  points={seg.map((p) => `${p.x},${p.y}`).join(" ")}
                  fill="none"
                  stroke={color}
                  strokeWidth={2.5}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              ))}
              {last && last.y !== null && (
                <circle
                  cx={last.x}
                  cy={last.y}
                  r={4}
                  fill={color}
                  stroke="var(--card)"
                  strokeWidth={1.5}
                />
              )}
            </g>
          )
        )
      )}
    </svg>
  );
}

type EvTurnSnapshot = { turn: number; electoralVotesByCandidate: Record<string, number> };

export function GeneralVoteCharts({
  snapshots,
  series,
  evByTurn,
  totalSeats = null,
}: {
  snapshots: VoteTurnSnapshot[];
  series: LineSeries[];
  evByTurn?: EvTurnSnapshot[];
  /** When >1, enables seat-projection history for multi-seat general races. */
  totalSeats?: number | null;
}) {
  const hasEvChart = (evByTurn?.length ?? 0) >= 2;
  const hasSnapshotsChart = snapshots.length >= 2;
  const snapshotsWithSeats = snapshots.filter(
    (s) => s.seatsEstimate != null && Object.keys(s.seatsEstimate).length > 0
  );
  const hasSeatHistory = (totalSeats ?? 0) > 1 && snapshotsWithSeats.length >= 2;

  const [activeChart, setActiveChart] = useState<"share" | "votes" | "ev" | "seats">(() =>
    hasEvChart ? "ev" : "share"
  );

  /** User intent (`activeChart`) clamped to whichever series actually has enough points to plot. */
  const chartToShow = useMemo<"share" | "votes" | "ev" | "seats">(() => {
    if (activeChart === "ev" && hasEvChart) return "ev";
    if (activeChart === "seats" && hasSeatHistory) return "seats";
    if (activeChart === "share" && hasSnapshotsChart) return "share";
    if (activeChart === "votes" && hasSnapshotsChart) return "votes";
    if (hasEvChart) return "ev";
    if (hasSnapshotsChart) return "share";
    if (hasSeatHistory) return "seats";
    return "share";
  }, [activeChart, hasEvChart, hasSnapshotsChart, hasSeatHistory]);

  if (!hasEvChart && !hasSnapshotsChart) {
    return (
      <div className="flex items-center justify-center h-20 text-xs text-muted/50 italic">
        Charts appear once two or more turns have been counted
      </div>
    );
  }

  const allShareVals = snapshots.flatMap((snap) =>
    series.map((s) => snap.sharesPct[s.id]).filter((v): v is number => v != null)
  );
  const rawMin = allShareVals.length ? Math.min(...allShareVals) : 0;
  const rawMax = allShareVals.length ? Math.max(...allShareVals) : 100;
  const rawRange = rawMax - rawMin;
  const padding = Math.max(rawRange * 0.15, 2);
  const sharePctMin = rawRange < 40 ? Math.max(0, Math.floor(rawMin - padding)) : 0;
  const sharePctMax = rawRange < 40 ? Math.min(100, Math.ceil(rawMax + padding)) : 100;
  const voteMax = Math.max(
    1,
    ...snapshots.flatMap((snap) => series.map((s) => snap.cumulativeVotes[s.id] ?? 0))
  );

  const seatYMax = Math.max(
    1,
    totalSeats && totalSeats > 1 ? totalSeats : 0,
    ...snapshots.flatMap((snap) =>
      snap.seatsEstimate ? series.map((s) => snap.seatsEstimate![s.id] ?? 0) : []
    )
  );
  const roundedVoteMax = (() => {
    const mag = Math.pow(10, Math.floor(Math.log10(voteMax)));
    return Math.ceil(voteMax / mag) * mag;
  })();
  const fmtVoteAxis = (v: number) => {
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
    if (v >= 1_000) return `${(v / 1_000).toFixed(0)}k`;
    return String(v);
  };

  const isZoomed = sharePctMin > 0 || sharePctMax < 100;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex flex-wrap gap-2">
          {hasEvChart && (
            <button
              type="button"
              onClick={() => setActiveChart("ev")}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
                chartToShow === "ev"
                  ? "bg-primary/20 border-primary/50 text-primary"
                  : "bg-card border-card-border text-muted hover:text-foreground"
              }`}
            >
              <BarChart2 className="h-3 w-3" />
              Electoral Votes
            </button>
          )}
          <button
            type="button"
            disabled={!hasSnapshotsChart}
            onClick={() => hasSnapshotsChart && setActiveChart("share")}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
              chartToShow === "share"
                ? "bg-primary/20 border-primary/50 text-primary"
                : "bg-card border-card-border text-muted hover:text-foreground"
            } ${!hasSnapshotsChart ? "opacity-40 cursor-not-allowed pointer-events-none" : ""}`}
          >
            <Vote className="h-3 w-3" />
            Vote Share %
          </button>
          <button
            type="button"
            disabled={!hasSnapshotsChart}
            onClick={() => hasSnapshotsChart && setActiveChart("votes")}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
              chartToShow === "votes"
                ? "bg-primary/20 border-primary/50 text-primary"
                : "bg-card border-card-border text-muted hover:text-foreground"
            } ${!hasSnapshotsChart ? "opacity-40 cursor-not-allowed pointer-events-none" : ""}`}
          >
            <TrendingUp className="h-3 w-3" />
            Cumulative Votes
          </button>
          {hasSeatHistory && (
            <button
              type="button"
              onClick={() => setActiveChart("seats")}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
                chartToShow === "seats"
                  ? "bg-primary/20 border-primary/50 text-primary"
                  : "bg-card border-card-border text-muted hover:text-foreground"
              }`}
            >
              <LayoutList className="h-3 w-3" />
              Seats over time
            </button>
          )}
        </div>
        {chartToShow === "share" && isZoomed && (
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-secondary/10 border border-secondary/30 text-secondary text-[10px] font-medium">
            <ZoomIn className="h-3 w-3" />
            Auto-scaled
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-x-5 gap-y-1.5 mb-3 p-2 rounded-lg bg-card-muted border border-card-border">
        {series.map((s) => (
          <span key={s.id} className="flex items-center gap-1.5 text-xs">
            {s.partyId ? (
              <PartyLogo
                partyId={s.partyId}
                partyColor={s.color}
                countryId={s.countryId}
                size="h-3 w-3"
              />
            ) : (
              <span
                className="h-3 w-3 rounded-full shrink-0 ring-1 ring-black/20"
                style={{ backgroundColor: s.color }}
              />
            )}
            <span style={{ color: s.color }} className="font-medium">
              {s.name}
            </span>
          </span>
        ))}
      </div>

      {chartToShow === "ev" && hasEvChart && evByTurn ? (
        <LineGraph
          snapshots={evByTurn as unknown as VoteTurnSnapshot[]}
          series={series}
          yValues={(id, snap) =>
            (snap as unknown as EvTurnSnapshot).electoralVotesByCandidate[id] ?? null
          }
          yMax={538}
          yLabel={(v) => `${v}`}
          xLabel={(snap) => `T${snap.turn}`}
          gridCount={4}
          thresholdLine={{ value: 270, label: "270 to win" }}
        />
      ) : chartToShow === "share" && hasSnapshotsChart ? (
        <LineGraph
          snapshots={snapshots}
          series={series}
          yValues={(id, snap) => snap.sharesPct[id] ?? null}
          yMin={sharePctMin}
          yMax={sharePctMax}
          yLabel={(v) => `${v}%`}
          xLabel={(snap) => `T${snap.turn}`}
          gridCount={4}
        />
      ) : chartToShow === "votes" && hasSnapshotsChart ? (
        <LineGraph
          snapshots={snapshots}
          series={series}
          yValues={(id, snap) => snap.cumulativeVotes[id] ?? null}
          yMax={roundedVoteMax}
          yLabel={fmtVoteAxis}
          xLabel={(snap) => `T${snap.turn}`}
          gridCount={4}
        />
      ) : chartToShow === "seats" && hasSeatHistory ? (
        <LineGraph
          snapshots={snapshots}
          series={series}
          yValues={(id, snap) => snap.seatsEstimate?.[id] ?? null}
          yMin={0}
          yMax={seatYMax}
          yLabel={(v) => `${v}`}
          xLabel={(snap) => `T${snap.turn}`}
          gridCount={4}
          stripeCoincidentSegments
        />
      ) : null}
    </div>
  );
}
