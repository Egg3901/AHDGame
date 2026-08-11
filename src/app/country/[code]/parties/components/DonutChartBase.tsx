"use client";

import { useState } from "react";
import { SliceItem } from "../partiesTypes";

export function DonutChartBase({
  items,
  centerLabel,
  formatValue,
  size = 180,
}: {
  items: SliceItem[];
  centerLabel: string;
  formatValue: (v: number) => string;
  size?: number;
}) {
  const [hovered, setHovered] = useState<string | null>(null);

  const total = items.reduce((s, p) => s + p.value, 0);
  if (total === 0) return null;

  const sorted = [...items].sort((a, b) => b.value - a.value);

  const SIZE = size;
  const CX = SIZE / 2;
  const CY = SIZE / 2;
  const R_OUTER = SIZE * 0.409;
  const R_INNER = SIZE * 0.245;
  const GAP = 2;

  type Slice = {
    item: SliceItem;
    startDeg: number;
    endDeg: number;
    midDeg: number;
    path: string;
  };
  const slices: Slice[] = [];
  let cursor = -90;

  for (const item of sorted) {
    const pct = item.value / total;
    const sweep = pct * 360 - GAP;
    if (sweep <= 0) {
      cursor += pct * 360;
      continue;
    }
    const startDeg = cursor + GAP / 2;
    const endDeg = startDeg + sweep;
    const midDeg = (startDeg + endDeg) / 2;
    const toRad = (d: number) => (d * Math.PI) / 180;
    const x1 = CX + R_OUTER * Math.cos(toRad(startDeg));
    const y1 = CY + R_OUTER * Math.sin(toRad(startDeg));
    const x2 = CX + R_OUTER * Math.cos(toRad(endDeg));
    const y2 = CY + R_OUTER * Math.sin(toRad(endDeg));
    const ix1 = CX + R_INNER * Math.cos(toRad(endDeg));
    const iy1 = CY + R_INNER * Math.sin(toRad(endDeg));
    const ix2 = CX + R_INNER * Math.cos(toRad(startDeg));
    const iy2 = CY + R_INNER * Math.sin(toRad(startDeg));
    const large = sweep > 180 ? 1 : 0;
    const path = [
      `M ${x1} ${y1}`,
      `A ${R_OUTER} ${R_OUTER} 0 ${large} 1 ${x2} ${y2}`,
      `L ${ix1} ${iy1}`,
      `A ${R_INNER} ${R_INNER} 0 ${large} 0 ${ix2} ${iy2}`,
      "Z",
    ].join(" ");
    slices.push({ item, startDeg, endDeg, midDeg, path });
    cursor += pct * 360;
  }

  const hov = hovered ? sorted.find((p) => p.id === hovered) : null;

  const fontSize = SIZE * 0.1;
  const subSize = SIZE * 0.052;

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative shrink-0">
        <svg
          width={SIZE}
          height={SIZE}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          className="overflow-visible"
        >
          {slices.map(({ item, path, midDeg }) => {
            const isHov = hovered === item.id;
            const toRad = (d: number) => (d * Math.PI) / 180;
            const pullDist = isHov ? 5 : 0;
            const tx = pullDist * Math.cos(toRad(midDeg));
            const ty = pullDist * Math.sin(toRad(midDeg));
            return (
              <path
                key={item.id}
                d={path}
                fill={item.color}
                opacity={hovered && !isHov ? 0.35 : 1}
                transform={`translate(${tx}, ${ty})`}
                style={{ transition: "opacity 0.2s, transform 0.2s" }}
                className="cursor-pointer"
                onMouseEnter={() => setHovered(item.id)}
                onMouseLeave={() => setHovered(null)}
              />
            );
          })}
          <text
            x={CX}
            y={CY - subSize * 0.6}
            textAnchor="middle"
            className="fill-foreground font-bold"
            style={{ fontSize }}
          >
            {hov ? formatValue(hov.value) : formatValue(total)}
          </text>
          <text
            x={CX}
            y={CY + subSize * 1.2}
            textAnchor="middle"
            className="fill-muted"
            style={{ fontSize: subSize }}
          >
            {hov ? hov.abbreviation : centerLabel}
          </text>
          {hov && (
            <text
              x={CX}
              y={CY + subSize * 2.6}
              textAnchor="middle"
              className="fill-muted"
              style={{ fontSize: subSize * 0.9 }}
            >
              {((hov.value / total) * 100).toFixed(1)}%
            </text>
          )}
        </svg>
      </div>
      <div className="w-full space-y-1.5">
        {sorted.map((item) => {
          const pct = total > 0 ? ((item.value / total) * 100).toFixed(1) : "0.0";
          const isHov = hovered === item.id;
          return (
            <button
              key={item.id}
              onMouseEnter={() => setHovered(item.id)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => setHovered(isHov ? null : item.id)}
              className="flex items-center gap-2 w-full text-left transition-opacity"
              style={{ opacity: hovered && !isHov ? 0.4 : 1 }}
            >
              <span
                className="h-2.5 w-2.5 rounded-full shrink-0"
                style={{ backgroundColor: item.color }}
              />
              <span className="text-xs font-medium truncate">{item.name}</span>
              <span className="ml-auto text-xs text-muted tabular-nums shrink-0">
                {formatValue(item.value)} <span className="text-muted/50">({pct}%)</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
