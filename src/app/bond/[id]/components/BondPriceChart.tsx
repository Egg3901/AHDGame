"use client";

import { useCurrency } from "@/contexts/CurrencyContext";
import type { PricePoint } from "./bondTypes";

export function BondPriceChart({ data }: { data: PricePoint[] }) {
  const { formatPrice } = useCurrency();
  const w = 600;
  const h = 200;
  const pad = { top: 20, right: 20, bottom: 30, left: 54 };
  const innerW = w - pad.left - pad.right;
  const innerH = h - pad.top - pad.bottom;

  const prices = data.map((d) => d.marketPrice);
  const minP = Math.min(...prices) * 0.95;
  const maxP = Math.max(...prices) * 1.05;
  const range = maxP - minP || 1;

  const turns = data.map((d) => d.turn);
  const minT = Math.min(...turns);
  const maxT = Math.max(...turns);
  const tRange = maxT - minT || 1;

  const points = data.map((d) => ({
    x: pad.left + ((d.turn - minT) / tRange) * innerW,
    y: pad.top + innerH - ((d.marketPrice - minP) / range) * innerH,
    ...d,
  }));

  const linePath = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(" ");
  const areaPath = `${linePath} L ${points[points.length - 1].x.toFixed(1)} ${(pad.top + innerH).toFixed(1)} L ${points[0].x.toFixed(1)} ${(pad.top + innerH).toFixed(1)} Z`;

  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((t) => ({
    y: pad.top + innerH * (1 - t),
    label: formatPrice(minP + t * range),
  }));

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-auto">
      <defs>
        <linearGradient id="bondChartGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-primary)" stopOpacity="0.18" />
          <stop offset="100%" stopColor="var(--color-primary)" stopOpacity="0" />
        </linearGradient>
      </defs>

      {gridLines.map((gl) => (
        <g key={gl.y}>
          <line
            x1={pad.left}
            x2={pad.left + innerW}
            y1={gl.y}
            y2={gl.y}
            stroke="var(--color-card-border)"
            strokeDasharray="4 4"
            strokeOpacity="0.6"
          />
          <text
            x={pad.left - 6}
            y={gl.y + 3.5}
            textAnchor="end"
            fontSize="9"
            fill="var(--color-muted)"
          >
            {gl.label}
          </text>
        </g>
      ))}

      <path d={areaPath} fill="url(#bondChartGrad)" />
      <path
        d={linePath}
        fill="none"
        stroke="var(--color-primary)"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {[0, 0.5, 1].map((t) => {
        const turn = Math.round(minT + t * tRange);
        const x = pad.left + t * innerW;
        return (
          <text key={t} x={x} y={h - 8} textAnchor="middle" fontSize="9" fill="var(--color-muted)">
            T{turn}
          </text>
        );
      })}
    </svg>
  );
}
