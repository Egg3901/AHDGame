"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useCurrency } from "@/contexts/CurrencyContext";
import { bypassNextImageOptimization } from "@/lib/images/bypassImageOptimization";
import type { Holder } from "./bondTypes";

const HOLDER_COLORS = [
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
  "#f59e0b",
  "#22c55e",
  "#14b8a6",
  "#ef4444",
  "#6366f1",
  "#f97316",
  "#06b6d4",
  "#84cc16",
  "#a855f7",
];
const PUBLIC_FLOAT_COLOR = "#6b7280";
const ITEMS_PER_PAGE = 10;

export function BondOwnersSection({
  holders,
  publicFloat,
  totalUnits,
  marketPrice,
}: {
  holders: Holder[];
  publicFloat: number;
  totalUnits: number;
  marketPrice: number;
}) {
  const { formatAmount } = useCurrency();
  const [hovered, setHovered] = useState<number | null>(null);
  const [page, setPage] = useState(0);

  type Slice = { label: string; units: number; color: string; pct: number };
  const slices: Slice[] = holders.map((h, i) => ({
    label: h.name,
    units: h.units,
    color: HOLDER_COLORS[i % HOLDER_COLORS.length],
    pct: h.percentage,
  }));
  if (publicFloat > 0) {
    slices.push({
      label: "Public Float",
      units: publicFloat,
      color: PUBLIC_FLOAT_COLOR,
      pct: totalUnits > 0 ? (publicFloat / totalUnits) * 100 : 0,
    });
  }

  // ── Donut ──────────────────────────────────────────────────────────────────
  const size = 200;
  const cx = size / 2;
  const cy = size / 2;
  const R = 82;
  const r = 50;
  const total = slices.reduce((s, sl) => s + sl.units, 0);

  const sliceAngles = slices.reduce<{ start: number; end: number }[]>((acc, slice) => {
    const prevEnd = acc.length > 0 ? acc[acc.length - 1].end : -Math.PI / 2;
    const angle = total > 0 ? (slice.units / total) * 2 * Math.PI : 0;
    return [...acc, { start: prevEnd, end: prevEnd + angle }];
  }, []);

  const segments = slices.map((slice, idx) => {
    const { start: startAngle, end: endAngle } = sliceAngles[idx];
    const angle = endAngle - startAngle;

    const isHovered = hovered === idx;
    const isDimmed = hovered !== null && !isHovered;

    if (angle >= 2 * Math.PI - 0.001) {
      return (
        <g key={slice.label}>
          <circle
            cx={cx}
            cy={cy}
            r={R}
            fill={slice.color}
            opacity={isDimmed ? 0.45 : 1}
            style={{ transition: "opacity 0.12s" }}
            onMouseEnter={() => setHovered(idx)}
            className="cursor-pointer"
          />
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="var(--color-card)"
            style={{ pointerEvents: "none" }}
          />
        </g>
      );
    }

    const x1 = cx + R * Math.cos(startAngle);
    const y1 = cy + R * Math.sin(startAngle);
    const x2 = cx + R * Math.cos(endAngle);
    const y2 = cy + R * Math.sin(endAngle);
    const x3 = cx + r * Math.cos(endAngle);
    const y3 = cy + r * Math.sin(endAngle);
    const x4 = cx + r * Math.cos(startAngle);
    const y4 = cy + r * Math.sin(startAngle);
    const largeArc = angle > Math.PI ? 1 : 0;
    const d = `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${R} ${R} 0 ${largeArc} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} L ${x3.toFixed(2)} ${y3.toFixed(2)} A ${r} ${r} 0 ${largeArc} 0 ${x4.toFixed(2)} ${y4.toFixed(2)} Z`;

    return (
      <path
        key={slice.label}
        d={d}
        fill={slice.color}
        stroke="var(--color-card)"
        strokeWidth={2}
        opacity={isDimmed ? 0.45 : 1}
        style={{ transition: "opacity 0.12s" }}
        onMouseEnter={() => setHovered(idx)}
        className="cursor-pointer"
      />
    );
  });

  const hoveredSlice = hovered !== null ? slices[hovered] : null;
  const truncate = (s: string, max = 14) => (s.length > max ? s.slice(0, max - 1) + "…" : s);

  // ── Pagination ─────────────────────────────────────────────────────────────
  const allRows = [
    ...holders.map((h, i) => ({ h, colorIdx: i, isFloat: false })),
    ...(publicFloat > 0 ? [{ h: null as Holder | null, colorIdx: -1, isFloat: true }] : []),
  ];
  const totalPages = Math.ceil(allRows.length / ITEMS_PER_PAGE);
  const pageRows = allRows.slice(page * ITEMS_PER_PAGE, (page + 1) * ITEMS_PER_PAGE);

  return (
    <div className="rounded-xl border border-card-border bg-card overflow-hidden">
      <div className="px-6 py-4 border-b border-card-border flex items-center justify-between">
        <h2 className="text-lg font-bold text-foreground">Bond Ownership</h2>
        <span className="text-xs text-muted tabular-nums">
          {totalUnits.toLocaleString("en-US")} total units
        </span>
      </div>

      <div className="p-6">
        <div className="flex flex-col lg:flex-row gap-8">
          {/* Donut + legend */}
          <div className="flex flex-col sm:flex-row lg:flex-col items-center gap-5 shrink-0">
            <svg
              viewBox={`0 0 ${size} ${size}`}
              className="w-44 h-44 shrink-0"
              onMouseLeave={() => setHovered(null)}
            >
              {segments}
              {hoveredSlice ? (
                <>
                  <text
                    x={cx}
                    y={cy - 7}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fontSize="13"
                    fontWeight="700"
                    fill="var(--color-foreground)"
                  >
                    {hoveredSlice.pct.toFixed(1)}%
                  </text>
                  <text
                    x={cx}
                    y={cy + 10}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fontSize="8.5"
                    fill="var(--color-muted)"
                  >
                    {truncate(hoveredSlice.label)}
                  </text>
                </>
              ) : (
                <>
                  <text
                    x={cx}
                    y={cy - 7}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fontSize="11"
                    fontWeight="600"
                    fill="var(--color-foreground)"
                  >
                    {total.toLocaleString("en-US")}
                  </text>
                  <text
                    x={cx}
                    y={cy + 10}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fontSize="8.5"
                    fill="var(--color-muted)"
                  >
                    total units
                  </text>
                </>
              )}
            </svg>
            <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm max-w-xs">
              {slices.map((slice, idx) => (
                <button
                  key={slice.label}
                  type="button"
                  onMouseEnter={() => setHovered(idx)}
                  onMouseLeave={() => setHovered(null)}
                  className={`flex items-center gap-2 text-left transition-opacity ${
                    hovered !== null && hovered !== idx ? "opacity-40" : "opacity-100"
                  }`}
                >
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-sm shrink-0"
                    style={{ backgroundColor: slice.color }}
                  />
                  <span className="text-foreground">{slice.label}</span>
                  <span className="text-muted tabular-nums">{slice.pct.toFixed(1)}%</span>
                </button>
              ))}
            </div>
          </div>

          {/* Holder table */}
          <div className="flex-1 min-w-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-card-border">
                  {["Holder", "Units", "% Total", "Mkt Value"].map((h, i) => (
                    <th
                      key={h}
                      className={`pb-2.5 text-[10px] font-bold uppercase tracking-wider text-muted ${i === 0 ? "text-left" : "text-right"}`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-card-border">
                {pageRows.map(({ h, colorIdx, isFloat }, _rowIdx) => {
                  if (isFloat) {
                    return (
                      <tr key="float">
                        <td className="py-2.5 pr-4">
                          <div className="flex items-center gap-2.5">
                            <span
                              className="inline-block h-2.5 w-2.5 rounded-sm shrink-0"
                              style={{ backgroundColor: PUBLIC_FLOAT_COLOR }}
                            />
                            <div className="h-7 w-7 rounded-full bg-card-elevated border border-card-border flex items-center justify-center text-muted shrink-0">
                              <svg
                                width="12"
                                height="12"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                              >
                                <circle cx="12" cy="12" r="10" />
                                <line x1="12" y1="8" x2="12" y2="16" />
                                <line x1="8" y1="12" x2="16" y2="12" />
                              </svg>
                            </div>
                            <div>
                              <span className="font-medium text-foreground">Public Float</span>
                              <span className="block text-[10px] text-muted uppercase tracking-wide">
                                Available
                              </span>
                            </div>
                          </div>
                        </td>
                        <td className="py-2.5 text-right tabular-nums font-medium text-foreground">
                          {publicFloat.toLocaleString("en-US")}
                        </td>
                        <td className="py-2.5 text-right tabular-nums text-muted">
                          {totalUnits > 0 ? ((publicFloat / totalUnits) * 100).toFixed(1) : "0.0"}%
                        </td>
                        <td className="py-2.5 text-right tabular-nums text-foreground">
                          {formatAmount(publicFloat * marketPrice)}
                        </td>
                      </tr>
                    );
                  }
                  const holder = h!;
                  const href =
                    holder.type === "character" && holder.sequentialId != null
                      ? `/character/${holder.id}`
                      : holder.type === "corporation" && holder.sequentialId != null
                        ? `/corporation/${holder.sequentialId}`
                        : null;
                  const imgSrc = holder.type === "character" ? holder.avatarUrl : holder.logoUrl;
                  return (
                    <tr key={holder.id}>
                      <td className="py-2.5 pr-4">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span
                            className="inline-block h-2.5 w-2.5 rounded-sm shrink-0"
                            style={{
                              backgroundColor: HOLDER_COLORS[colorIdx % HOLDER_COLORS.length],
                            }}
                          />
                          <div className="h-7 w-7 rounded-full overflow-hidden bg-card-elevated border border-card-border shrink-0 flex items-center justify-center text-muted">
                            {imgSrc ? (
                              <Image
                                src={imgSrc}
                                alt={holder.name}
                                width={28}
                                height={28}
                                className="h-full w-full object-cover"
                                unoptimized={bypassNextImageOptimization(imgSrc)}
                              />
                            ) : (
                              <svg
                                width="12"
                                height="12"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                              >
                                <circle cx="12" cy="8" r="4" />
                                <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
                              </svg>
                            )}
                          </div>
                          <div className="min-w-0">
                            {href ? (
                              <Link
                                href={href}
                                className="font-medium text-foreground hover:text-primary transition-colors truncate block"
                              >
                                {holder.name}
                              </Link>
                            ) : (
                              <span className="font-medium text-foreground truncate block">
                                {holder.name}
                              </span>
                            )}
                            <span className="text-[10px] text-muted uppercase tracking-wide">
                              {holder.type === "character" ? "Character" : "Corporation"}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="py-2.5 text-right tabular-nums font-medium text-foreground">
                        {holder.units.toLocaleString("en-US")}
                      </td>
                      <td className="py-2.5 text-right tabular-nums text-muted">
                        {holder.percentage.toFixed(1)}%
                      </td>
                      <td className="py-2.5 text-right tabular-nums text-foreground">
                        {formatAmount(holder.value)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-4 pt-3 border-t border-card-border">
                <span className="text-xs text-muted">
                  {page * ITEMS_PER_PAGE + 1}–
                  {Math.min((page + 1) * ITEMS_PER_PAGE, allRows.length)} of {allRows.length}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={page === 0}
                    className="px-2.5 py-1 rounded-lg border border-card-border text-xs text-muted hover:text-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    ← Prev
                  </button>
                  {Array.from({ length: totalPages }, (_, i) => (
                    <button
                      key={i}
                      onClick={() => setPage(i)}
                      className={`px-2.5 py-1 rounded-lg text-xs transition-colors ${
                        i === page
                          ? "bg-primary text-white"
                          : "border border-card-border text-muted hover:text-foreground"
                      }`}
                    >
                      {i + 1}
                    </button>
                  ))}
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                    disabled={page === totalPages - 1}
                    className="px-2.5 py-1 rounded-lg border border-card-border text-xs text-muted hover:text-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Next →
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
