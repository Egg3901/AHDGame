"use client";

import { useState } from "react";

/** Single-arc mini donut for general-election candidates. */
export function MiniDonut({
  pct,
  color,
  size = 38,
}: {
  pct: number;
  color: string;
  size?: number;
}) {
  const sw = 5;
  const r = (size - sw) / 2;
  const circ = 2 * Math.PI * r;
  const cx = size / 2;
  const cy = size / 2;
  const filled = Math.min(1, pct / 100) * circ;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth={sw}
        className="text-card-elevated"
      />
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={sw}
        strokeDasharray={`${filled} ${circ - filled}`}
        strokeLinecap="butt"
      />
      <text
        x={cx}
        y={cy}
        textAnchor="middle"
        dominantBaseline="central"
        style={{
          fontSize: 8,
          fontWeight: 700,
          fill: "currentColor",
          transform: `rotate(90deg)`,
          transformOrigin: `${cx}px ${cy}px`,
        }}
      >
        {Math.round(pct)}%
      </text>
    </svg>
  );
}

/** Unified color-coded pie chart for general election vote share on cards. */
export function GeneralPieChart({
  slices,
  size = 72,
}: {
  slices: { pct: number; color: string; label: string }[];
  size?: number;
}) {
  const [hovered, setHovered] = useState<number | null>(null);

  if (slices.length === 0) return null;

  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 1;

  if (slices.length === 1) {
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={cx} cy={cy} r={r} fill={slices[0].color} />
      </svg>
    );
  }

  // Pre-compute paths outside of JSX to avoid mutating cursor during render
  const paths: { d: string; color: string; label: string; pct: number }[] = [];
  let cursor = -Math.PI / 2;
  for (const s of slices) {
    const angle = (s.pct / 100) * 2 * Math.PI;
    if (angle <= 0) continue;
    const x1 = cx + r * Math.cos(cursor);
    const y1 = cy + r * Math.sin(cursor);
    cursor += angle;
    const x2 = cx + r * Math.cos(cursor);
    const y2 = cy + r * Math.sin(cursor);
    const large = angle > Math.PI ? 1 : 0;
    paths.push({
      d: `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`,
      color: s.color,
      label: s.label,
      pct: s.pct,
    });
  }

  const h = hovered !== null ? paths[hovered] : null;

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="rounded-full overflow-visible"
      >
        {paths.map((p, i) => (
          <path
            key={i}
            d={p.d}
            fill={p.color}
            stroke="var(--card)"
            strokeWidth={hovered === i ? 1 : 0.5}
            style={{
              opacity: hovered === null || hovered === i ? 1 : 0.4,
              transform: hovered === i ? `scale(1.06)` : `scale(1)`,
              transformOrigin: `${cx}px ${cy}px`,
              transition: `opacity 0.12s ease, transform 0.12s ease`,
              cursor: "pointer",
            }}
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
          />
        ))}
      </svg>
      {h && (
        <div
          className="absolute left-1/2 -translate-x-1/2 -bottom-8 pointer-events-none z-50 whitespace-nowrap rounded border border-card-border bg-card px-2 py-0.5 text-[10px] font-medium shadow"
          style={{ color: h.color }}
        >
          {h.label} · {h.pct.toFixed(1)}%
        </div>
      )}
    </div>
  );
}

/** Multi-slice donut for a single party's primary — one arc per candidate. */
export function PrimaryPartyDonut({
  slices,
  size = 52,
}: {
  slices: { color: string; pct: number }[];
  size: number;
}) {
  const sw = 7;
  const r = (size - sw) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const GAP_DEG = slices.length > 1 ? 4 : 0;
  const totalPct = slices.reduce((s, sl) => s + sl.pct, 0);

  // Single-slice (unopposed): SVG arc paths can't represent a full 360° circle
  // (start === end point degenerates), so use a stroked ring instead.
  if (slices.length === 1) {
    const circ = 2 * Math.PI * r;
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth={sw}
          className="text-card-elevated"
        />
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke={slices[0].color}
          strokeWidth={sw}
          strokeDasharray={`${circ} 0`}
        />
      </svg>
    );
  }

  let cursor = -90;
  const paths = slices.map((sl) => {
    const sweep = (sl.pct / totalPct) * 360 - GAP_DEG;
    if (sweep <= 0) {
      // eslint-disable-next-line react-hooks/immutability
      cursor += (sl.pct / totalPct) * 360;
      return null;
    }
    const startDeg = cursor + GAP_DEG / 2;
    const endDeg = startDeg + sweep;
    const x1 = cx + r * Math.cos(toRad(startDeg));
    const y1 = cy + r * Math.sin(toRad(startDeg));
    const x2 = cx + r * Math.cos(toRad(endDeg));
    const y2 = cy + r * Math.sin(toRad(endDeg));
    const large = sweep > 180 ? 1 : 0;
    cursor += (sl.pct / totalPct) * 360;
    return {
      d: `M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${large},1 ${x2},${y2} Z`,
      color: sl.color,
    };
  });

  // Center hole
  const holeR = r - sw;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={cx} cy={cy} r={r} fill="currentColor" className="text-card-elevated" />
      {paths.map((p, i) => p && <path key={i} d={p.d} fill={p.color} />)}
      <circle cx={cx} cy={cy} r={Math.max(0, holeR)} fill="currentColor" className="text-card" />
    </svg>
  );
}
