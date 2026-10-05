"use client";

import type { RecentPollEntry } from "./RecentPolls";

const WIDTH = 600;
const HEIGHT = 180;
const PAD_LEFT = 40;
const PAD_RIGHT = 14;
const PAD_TOP = 12;
const PAD_BOTTOM = 40;
const INNER_W = WIDTH - PAD_LEFT - PAD_RIGHT;
const INNER_H = HEIGHT - PAD_TOP - PAD_BOTTOM;
const Y_TICKS = [0, 10, 20, 35, 50];

const toX = (i: number, n: number) => PAD_LEFT + (n <= 1 ? INNER_W / 2 : (i / (n - 1)) * INNER_W);
const toY = (appeal: number) => PAD_TOP + ((50 - Math.max(0, Math.min(50, appeal))) / 50) * INNER_H;

/**
 * Overall appeal across the player's recent polls, oldest to newest, on the
 * same 0 to 50 scale and band colors as the results. Same plot geometry as the
 * approval chart (SVG, axis labels, hover values as native titles).
 */
export function PollTrendChart({ polls }: { polls: RecentPollEntry[] }) {
  // Stored newest first; plot oldest to newest left to right.
  const ordered = polls.slice().reverse();
  if (ordered.length < 2) {
    return (
      <p className="mt-3 text-body-sm text-muted">
        Commission another poll to see how your appeal is trending.
      </p>
    );
  }
  const points = ordered.map((p, i) => ({ x: toX(i, ordered.length), y: toY(p.overallAppeal), p }));
  const line = points.map((pt) => `${pt.x},${pt.y}`).join(" ");
  const first = ordered[0].overallAppeal;
  const last = ordered[ordered.length - 1].overallAppeal;
  const delta = last - first;

  return (
    <figure className="mt-3">
      <figcaption className="mb-1 flex flex-wrap items-baseline gap-x-3 text-body-sm text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-5 rounded-full bg-secondary" aria-hidden />
          Overall appeal (0 to 50)
        </span>
        <span className={delta >= 0 ? "text-success" : "text-error"}>
          {delta >= 0 ? "Up" : "Down"} {Math.abs(delta).toFixed(1)} since the oldest saved poll
        </span>
      </figcaption>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-auto w-full"
        role="img"
        aria-label={`Overall appeal across your last ${ordered.length} polls, from ${first.toFixed(1)} to ${last.toFixed(1)}`}
      >
        {Y_TICKS.map((v) => (
          <g key={v}>
            <line
              x1={PAD_LEFT}
              x2={WIDTH - PAD_RIGHT}
              y1={toY(v)}
              y2={toY(v)}
              stroke="var(--card-border)"
              strokeWidth={1}
            />
            <text
              x={PAD_LEFT - 6}
              y={toY(v) + 4}
              textAnchor="end"
              fontSize={11}
              fill="var(--muted)"
            >
              {v}
            </text>
          </g>
        ))}
        <polyline
          points={line}
          fill="none"
          stroke="var(--secondary)"
          strokeWidth={2}
          strokeLinejoin="round"
        />
        {points.map((pt, i) => (
          <g key={`${pt.p.takenAt}-${i}`}>
            <circle cx={pt.x} cy={pt.y} r={4} fill="var(--secondary)">
              <title>{`Poll ${i + 1}: ${pt.p.overallAppeal.toFixed(1)} appeal`}</title>
            </circle>
            <text x={pt.x} y={HEIGHT - 22} textAnchor="middle" fontSize={11} fill="var(--muted)">
              {i + 1}
            </text>
          </g>
        ))}
        <text
          x={PAD_LEFT + INNER_W / 2}
          y={HEIGHT - 4}
          textAnchor="middle"
          fontSize={11}
          fill="var(--muted)"
        >
          Poll number, oldest to newest
        </text>
      </svg>
    </figure>
  );
}
