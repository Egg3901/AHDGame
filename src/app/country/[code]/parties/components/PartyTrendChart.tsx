"use client";

import { useState } from "react";
import { rawTurnToLarpDate } from "@/lib/utils/formatters";
import { useGameTurnStatus } from "@/hooks/useGameEvents";
import type { CalendarClock } from "@/lib/utils/gameDate";
import type { PartyTrendPoint } from "../partiesTypes";

interface PartyTrendChartProps {
  history: PartyTrendPoint[];
  partyName: string;
  partyColor: string;
  series: "membership" | "organization";
  includeNpps: boolean;
}

const WIDTH = 680;
const HEIGHT = 220;
const PAD_LEFT = 52;
const PAD_RIGHT = 12;
const PAD_TOP = 14;
const PAD_BOTTOM = 30;
const INNER_W = WIDTH - PAD_LEFT - PAD_RIGHT;
const INNER_H = HEIGHT - PAD_TOP - PAD_BOTTOM;
const MEMBERSHIP_COLOR = "var(--color-info)";

/**
 * History turns are stored RAW and this chart had neither the world's starting
 * year nor its founding-phase offset: every label fell back to the 2019 constant
 * and sat a game year ahead of the status bar (#1208). Both come from the shared
 * turn-status poll, which every consumer on the page already reuses.
 */
function compactTurnLabel(
  turn: number,
  startingYear: number | undefined,
  clock: CalendarClock
): string {
  const label = rawTurnToLarpDate(turn, startingYear, clock);
  const match = label.match(/^Week (\d+), (\d+)$/);
  if (!match) return label;
  return `W${match[1]} '${match[2].slice(-2)}`;
}

function formatValue(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? rounded.toLocaleString("en-US") : rounded.toFixed(1);
}

export function PartyTrendChart({
  history,
  partyName,
  partyColor,
  series,
  includeNpps,
}: PartyTrendChartProps) {
  const [hovered, setHovered] = useState<number | null>(null);
  // Above the early return below — hooks cannot be called conditionally.
  const turnStatus = useGameTurnStatus();
  const startingYear = turnStatus?.startingYear;
  const clock: CalendarClock = {
    preIterationTurns: turnStatus?.preIterationTurns,
    preIterationActive: turnStatus?.preIterationActive,
  };

  if (history.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center rounded-xl border border-card-border bg-card-muted/30 text-sm text-muted">
        No history has been recorded yet.
      </div>
    );
  }

  const seriesLabel =
    series === "organization"
      ? "Organization"
      : includeNpps
        ? "Membership (with NPPs)"
        : "Membership (players only)";
  const latest = history[history.length - 1];

  const getValue = (point: PartyTrendPoint): number =>
    series === "organization"
      ? point.organization
      : includeNpps
        ? point.memberCount
        : point.playerCount;

  const values = history.map(getValue);
  const maxVal = Math.max(1, ...values);
  const minVal = 0;
  const range = Math.max(1, maxVal - minVal);

  const toX = (index: number): number => {
    if (history.length <= 1) return PAD_LEFT + INNER_W / 2;
    return PAD_LEFT + (index / (history.length - 1)) * INNER_W;
  };

  const toY = (value: number): number => PAD_TOP + ((maxVal - value) / range) * INNER_H;

  const orgPoints = history.map((point, index) => ({
    x: toX(index),
    y: toY(point.organization),
    ...point,
  }));
  const memberPoints = history.map((point, index) => ({
    x: toX(index),
    y: toY(getValue(point)),
    ...point,
  }));

  const seriesPolyline = memberPoints.map((point) => `${point.x},${point.y}`).join(" ");

  const yTicks = Array.from({ length: 5 }, (_, i) => (maxVal * i) / 4);
  const xLabelIndices: number[] = [];
  if (history.length <= 5) {
    history.forEach((_, i) => xLabelIndices.push(i));
  } else {
    const step = Math.floor((history.length - 1) / 4);
    for (let i = 0; i <= 4; i++) {
      xLabelIndices.push(Math.min(i * step, history.length - 1));
    }
    if (!xLabelIndices.includes(history.length - 1)) {
      xLabelIndices[xLabelIndices.length - 1] = history.length - 1;
    }
  }

  const hoveredOrg = hovered !== null ? orgPoints[hovered] : null;
  const hoveredMember = hovered !== null ? memberPoints[hovered] : null;
  const slug = partyName.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  const orgGradientId = `partyTrendOrg-${slug}`;
  const memberGradientId = `partyTrendMember-${slug}`;

  return (
    <div className="relative select-none">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-foreground">{partyName}</p>
          <p className="text-xs text-muted">
            {seriesLabel} across the last {history.length} turns.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-card-border bg-background px-2.5 py-1">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: partyColor }} />
            {seriesLabel} {formatValue(getValue(latest))}
          </span>
        </div>
      </div>

      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full"
        style={{ height: HEIGHT }}
        onMouseLeave={() => setHovered(null)}
      >
        <defs>
          <linearGradient id={orgGradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={partyColor} stopOpacity={0.22} />
            <stop offset="100%" stopColor={partyColor} stopOpacity={0} />
          </linearGradient>
          <linearGradient id={memberGradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={MEMBERSHIP_COLOR} stopOpacity={0.18} />
            <stop offset="100%" stopColor={MEMBERSHIP_COLOR} stopOpacity={0} />
          </linearGradient>
        </defs>

        {yTicks.map((tick) => {
          const y = toY(tick);
          return (
            <g key={tick}>
              <line
                x1={PAD_LEFT}
                y1={y}
                x2={WIDTH - PAD_RIGHT}
                y2={y}
                stroke="currentColor"
                strokeWidth={1}
                strokeDasharray="4 3"
                className="text-card-border/50"
              />
              <text
                x={PAD_LEFT - 6}
                y={y + 3}
                textAnchor="end"
                fontSize={9}
                className="fill-muted/70"
              >
                {formatValue(tick)}
              </text>
            </g>
          );
        })}

        <polygon
          points={`${memberPoints[0].x},${PAD_TOP + INNER_H} ${seriesPolyline} ${
            memberPoints[memberPoints.length - 1].x
          },${PAD_TOP + INNER_H}`}
          fill={`url(#${series === "organization" ? orgGradientId : memberGradientId})`}
        />

        <polyline
          points={seriesPolyline}
          fill="none"
          stroke={series === "organization" ? partyColor : MEMBERSHIP_COLOR}
          strokeWidth={2.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {orgPoints.map((point, index) => {
          const prevX = index > 0 ? orgPoints[index - 1].x : point.x;
          const nextX = index < orgPoints.length - 1 ? orgPoints[index + 1].x : point.x;
          const hitX = (prevX + point.x) / 2;
          const hitW = (nextX + point.x) / 2 - hitX;
          return (
            <rect
              key={index}
              x={hitX}
              y={PAD_TOP}
              width={Math.max(hitW, 8)}
              height={INNER_H}
              fill="transparent"
              onMouseEnter={() => setHovered(index)}
            />
          );
        })}

        {hoveredOrg && hoveredMember && (
          <>
            <line
              x1={hoveredOrg.x}
              y1={PAD_TOP}
              x2={hoveredOrg.x}
              y2={PAD_TOP + INNER_H}
              stroke="currentColor"
              strokeWidth={1}
              strokeDasharray="3 2"
              className="text-muted/60"
            />
            <circle
              cx={hoveredMember.x}
              cy={hoveredMember.y}
              r={4}
              fill={series === "organization" ? partyColor : MEMBERSHIP_COLOR}
            />
          </>
        )}

        {xLabelIndices.map((index) => (
          <text
            key={index}
            x={orgPoints[index].x}
            y={HEIGHT - 7}
            textAnchor="middle"
            fontSize={9}
            className="fill-muted/70"
          >
            {compactTurnLabel(history[index].turn, startingYear, clock)}
          </text>
        ))}
      </svg>

      {hovered !== null && hoveredOrg && hoveredMember && (
        <div className="pointer-events-none absolute top-2 right-3 rounded-md border border-card-border bg-card px-3 py-2 text-xs shadow-card">
          <div className="mb-1 text-muted">
            {rawTurnToLarpDate(history[hovered].turn, startingYear, clock)}
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="inline-flex items-center gap-1.5">
              <span
                className="h-2 w-2 rounded-full"
                style={{
                  backgroundColor: series === "organization" ? partyColor : MEMBERSHIP_COLOR,
                }}
              />
              {seriesLabel}
            </span>
            <span
              className="font-semibold tabular-nums"
              style={{ color: series === "organization" ? partyColor : MEMBERSHIP_COLOR }}
            >
              {formatValue(getValue(history[hovered]))}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
