"use client";

import { useMemo } from "react";
import type { CaucusListEntry } from "./caucusTypes";
import { formatMembershipPct } from "./caucusUtils";

export function CaucusMembershipShareCard({
  caucuses,
  selectedSlug,
  onSelect,
}: {
  caucuses: CaucusListEntry[];
  selectedSlug: string | null;
  onSelect: (slug: string) => void;
}) {
  const totalMembers = caucuses.reduce((sum, caucus) => sum + caucus.memberCounts.total, 0);

  const slices = useMemo(() => {
    if (totalMembers <= 0)
      return [] as Array<{
        id: string;
        slug: string;
        name: string;
        color: string;
        count: number;
        percentage: string;
        path: string;
        labelX: number;
        labelY: number;
      }>;

    const size = 208;
    const center = size / 2;
    const radius = size * 0.38;
    let cursor = -Math.PI / 2;

    return caucuses.map((caucus) => {
      const count = caucus.memberCounts.total;
      const angle = (count / totalMembers) * Math.PI * 2;
      const start = cursor;
      const end = cursor + angle;
      cursor = end;

      const x1 = center + radius * Math.cos(start);
      const y1 = center + radius * Math.sin(start);
      const x2 = center + radius * Math.cos(end);
      const y2 = center + radius * Math.sin(end);
      const largeArc = angle > Math.PI ? 1 : 0;
      const path = [
        `M ${center} ${center}`,
        `L ${x1} ${y1}`,
        `A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2}`,
        "Z",
      ].join(" ");
      const mid = start + angle / 2;
      const labelRadius = radius * 0.66;

      return {
        id: caucus.id,
        slug: caucus.slug,
        name: caucus.name,
        color: caucus.color,
        count,
        percentage: formatMembershipPct(count, totalMembers),
        path,
        labelX: center + labelRadius * Math.cos(mid),
        labelY: center + labelRadius * Math.sin(mid),
      };
    });
  }, [caucuses, totalMembers]);

  if (totalMembers <= 0 || slices.length === 0) return null;

  return (
    <div className="rounded-lg border border-card-border bg-card p-4">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-heading-sm font-semibold text-foreground">Caucus Membership Share</h3>
          <p className="mt-1 text-sm text-muted">
            Share of all caucus-aligned members across the party&apos;s active caucuses.
          </p>
        </div>
        <div className="rounded-md border border-card-border bg-card-muted px-2.5 py-1.5 text-right">
          <div className="text-body-xs font-semibold uppercase tracking-widest text-muted">
            Caucused Members
          </div>
          <div className="mt-0.5 text-base font-bold tabular-nums text-foreground">
            {totalMembers}
          </div>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[240px_1fr]">
        <div className="mx-auto flex w-full max-w-[240px] items-center justify-center">
          <div className="h-[208px] w-[208px]">
            <svg
              viewBox="0 0 208 208"
              className="h-full w-full"
              role="img"
              aria-label="Caucus membership share pie chart"
            >
              {slices.map((slice) => {
                const isSelected = slice.slug === selectedSlug;
                return (
                  <g key={slice.id}>
                    <path
                      d={slice.path}
                      fill={slice.color}
                      opacity={selectedSlug && !isSelected ? 0.55 : 1}
                      className="cursor-pointer transition-opacity"
                      onClick={() => onSelect(slice.slug)}
                    />
                    {caucuses.length <= 6 && (
                      <text
                        x={slice.labelX}
                        y={slice.labelY}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        className="fill-background text-[10px] font-semibold"
                      >
                        {slice.percentage}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
          </div>
        </div>

        <div className="space-y-2">
          {slices
            .slice()
            .sort((a, b) => b.count - a.count)
            .map((slice) => {
              const isSelected = slice.slug === selectedSlug;
              return (
                <button
                  key={slice.id}
                  type="button"
                  onClick={() => onSelect(slice.slug)}
                  className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors ${
                    isSelected
                      ? "border-primary/50 bg-primary/10"
                      : "border-card-border bg-card-muted hover:border-primary/30"
                  }`}
                >
                  <span
                    className="h-3 w-3 shrink-0 rounded-full border border-background/40"
                    style={{ backgroundColor: slice.color }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-foreground">
                      {slice.name}
                    </div>
                    <div className="text-body-sm text-muted">
                      {slice.count} members
                      {isSelected ? " • selected" : ""}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-bold tabular-nums text-foreground">
                      {slice.percentage}
                    </div>
                    <div className="text-body-xs text-muted">
                      {slice.count}/{totalMembers}
                    </div>
                  </div>
                </button>
              );
            })}
        </div>
      </div>
    </div>
  );
}
