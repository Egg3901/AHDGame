"use client";

/**
 * SP2 §5 — the metric-detail Historical series chart: a dependency-free inline
 * SVG line over the national trend snapshots. Deliberately minimal: the value
 * band auto-scales with headroom, endpoints are labeled, and the series color
 * rides the semantic primary token so all themes work.
 */

export function HistorySparkline({ points }: { points: Array<{ turn: number; value: number }> }) {
  if (points.length < 2) return null;

  const width = 600;
  const height = 120;
  const padX = 6;
  const padY = 10;

  const values = points.map((p) => p.value);
  const min = Math.max(0, Math.min(...values) - 2);
  const max = Math.min(100, Math.max(...values) + 2);
  const span = Math.max(max - min, 1);

  const x = (i: number) => padX + (i / (points.length - 1)) * (width - padX * 2);
  const y = (v: number) => height - padY - ((v - min) / span) * (height - padY * 2);
  const path = points.map((p, i) => `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");

  const first = points[0];
  const last = points[points.length - 1];

  return (
    <div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-32 w-full"
        role="img"
        aria-label={`Trend from ${first.value} at turn ${first.turn} to ${last.value} at turn ${last.turn}`}
      >
        <line
          x1={padX}
          y1={height - padY}
          x2={width - padX}
          y2={height - padY}
          stroke="var(--card-border)"
          strokeWidth="1"
        />
        <polyline
          points={path}
          fill="none"
          stroke="var(--primary)"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <circle cx={x(points.length - 1)} cy={y(last.value)} r="3" fill="var(--primary)" />
      </svg>
      <div className="mt-1 flex justify-between text-body-xs tabular-nums text-muted">
        <span>
          Turn {first.turn.toLocaleString("en-US")} · {first.value}
        </span>
        <span>
          Turn {last.turn.toLocaleString("en-US")} ·{" "}
          <strong className="text-foreground">{last.value}</strong>
        </span>
      </div>
    </div>
  );
}
