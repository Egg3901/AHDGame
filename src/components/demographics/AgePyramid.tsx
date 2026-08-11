"use client";

import { useState } from "react";
import { buildAgePyramid, type PyramidBand } from "@/lib/demographics/pyramidBins";
import type { AgeSexVector } from "@/lib/demographics/cohortVector";

const MALE = "#60a5fa";
const FEMALE = "#f472b6";

function EmptyPyramid() {
  return (
    <div className="rounded-lg border border-card-border bg-card p-6 text-center text-sm text-muted">
      No population data available.
    </div>
  );
}

export function AgePyramid({
  ages,
  bandSize = 5,
}: {
  ages: AgeSexVector | null;
  bandSize?: number;
}) {
  const [hovered, setHovered] = useState<number | null>(null);

  if (!ages || (ages.male?.length ?? 0) === 0) return <EmptyPyramid />;
  const pyramid = buildAgePyramid(ages, bandSize);
  if (pyramid.total === 0) return <EmptyPyramid />;

  const scale = pyramid.maxCellPct || 1; // half-width axis denominator
  const half = (cellPct: number) => (cellPct / scale) * 50; // % of the row's half-width

  return (
    <div className="rounded-lg border border-card-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h4 className="text-[11px] font-semibold uppercase tracking-widest text-muted">
          Age &amp; Sex Pyramid
        </h4>
        <div className="flex gap-3 text-[11px]">
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full" style={{ background: MALE }} />
            <span>Male</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full" style={{ background: FEMALE }} />
            <span>Female</span>
          </span>
        </div>
      </div>

      <div className="space-y-0.5">
        {/* Oldest band at the top — reverse the band list for the canonical pyramid shape. */}
        {[...pyramid.bands].reverse().map((b: PyramidBand, ri) => {
          const i = pyramid.bands.length - 1 - ri; // original index
          const isHov = hovered === i;
          return (
            <div
              key={b.label}
              className="flex items-center gap-1 text-[10px]"
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
            >
              {/* male wing (right-aligned, grows left) */}
              <div className="flex flex-1 justify-end">
                <div
                  className="h-3 rounded-l-sm transition-all"
                  style={{
                    width: `${half(b.malePct)}%`,
                    background: MALE,
                    opacity: isHov ? 1 : 0.85,
                  }}
                  title={`Male ${b.label}: ${b.male.toLocaleString("en-US")} (${b.malePct.toFixed(1)}%)`}
                />
              </div>
              <span className="w-10 shrink-0 text-center tabular-nums text-muted">{b.label}</span>
              {/* female wing (left-aligned, grows right) */}
              <div className="flex flex-1 justify-start">
                <div
                  className="h-3 rounded-r-sm transition-all"
                  style={{
                    width: `${half(b.femalePct)}%`,
                    background: FEMALE,
                    opacity: isHov ? 1 : 0.85,
                  }}
                  title={`Female ${b.label}: ${b.female.toLocaleString("en-US")} (${b.femalePct.toFixed(1)}%)`}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
