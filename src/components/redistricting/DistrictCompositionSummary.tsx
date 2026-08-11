import type { DistrictSquares } from "@/lib/db/types/congressionalDistrict";
import type { RedistrictCaps } from "@/lib/redistricting/caps";
import {
  summarizeComposition,
  LEAN_CATEGORIES,
  LEAN_CATEGORY_META,
  POOL_COLORS,
  type LeanCategory,
  type CompositionSummary,
} from "@/lib/redistricting/cardView";
import { computeEfficiencyGap } from "@/lib/redistricting/legality";

/**
 * Seat projection by the district's actual lean: left-won / right-won, with only
 * exact ties as toss-ups. (Counting by safe/lean/competitive *category* would
 * hide a thin +1/+2 win — common when a tight deviation cap keeps a gerrymander's
 * pickups just inside the competitive band — as a toss-up, making a "Max" redraw
 * look like it won nothing.)
 */
function seatProjection(districts: DistrictSquares[]): {
  left: number;
  right: number;
  tossup: number;
} {
  let left = 0;
  let right = 0;
  let tossup = 0;
  for (const d of districts) {
    const netLean = d.right - d.left;
    if (netLean > 0) right += 1;
    else if (netLean < 0) left += 1;
    else tossup += 1;
  }
  return { left, right, tossup };
}

function DeltaArrow({ delta }: { delta: number }) {
  if (delta === 0) return null;
  const up = delta > 0;
  return (
    <span
      className={up ? "text-success" : "text-error"}
      aria-label={`${up ? "up" : "down"} ${Math.abs(delta)}`}
    >
      {up ? "↑" : "↓"}
      {Math.abs(delta)}
    </span>
  );
}

function CategoryBar({
  summary,
  before,
}: {
  summary: CompositionSummary;
  before?: CompositionSummary;
}) {
  return (
    <div
      className="flex h-6 w-full overflow-hidden rounded-md border border-card-border"
      role="img"
      aria-label={LEAN_CATEGORIES.map(
        (c) => `${LEAN_CATEGORY_META[c].label} ${summary.counts[c]}`
      ).join(", ")}
    >
      {LEAN_CATEGORIES.map((c) => {
        const pct = summary.percents[c];
        if (pct <= 0) return null;
        const meta = LEAN_CATEGORY_META[c];
        const delta = before ? summary.counts[c] - before.counts[c] : 0;
        return (
          <div
            key={c}
            className="flex items-center justify-center text-[10px] font-semibold text-white"
            style={{ width: `${pct}%`, backgroundColor: meta.color }}
            title={`${meta.label}: ${summary.counts[c]} (${pct.toFixed(0)}%)${
              delta ? ` ${delta > 0 ? "+" : ""}${delta} vs before` : ""
            }`}
          >
            {pct >= 8 ? summary.counts[c] : ""}
          </div>
        );
      })}
    </div>
  );
}

function CategoryLegend({
  summary,
  before,
}: {
  summary: CompositionSummary;
  before?: CompositionSummary;
}) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
      {LEAN_CATEGORIES.map((c: LeanCategory) => {
        const meta = LEAN_CATEGORY_META[c];
        const delta = before ? summary.counts[c] - before.counts[c] : 0;
        return (
          <span key={c} className="flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: meta.color }}
            />
            <span className="text-muted">{meta.label}</span>
            <span className="font-medium text-foreground">
              {summary.counts[c]} ({summary.percents[c].toFixed(0)}%)
            </span>
            {before && <DeltaArrow delta={delta} />}
          </span>
        );
      })}
    </div>
  );
}

/**
 * Statewide composition: a stacked bar of districts by lean category, a legend
 * with counts/percentages, the efficiency gap vs its cap, and a seat projection.
 * Pass `before` (the pre-redraw map) to show a second bar with delta arrows.
 */
export function DistrictCompositionSummary({
  districts,
  caps,
  before,
  title,
  proposedLabel = "Proposed",
}: {
  districts: DistrictSquares[];
  caps?: RedistrictCaps;
  before?: DistrictSquares[];
  title?: string;
  proposedLabel?: string;
}) {
  const summary = summarizeComposition(districts);
  const beforeSummary = before ? summarizeComposition(before) : undefined;
  const proj = seatProjection(districts);
  const gap = computeEfficiencyGap(districts);
  const gapOver = caps ? gap > caps.efficiencyGapCeiling + 1e-9 : false;

  return (
    <div className="space-y-3 rounded-lg border border-card-border bg-card px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">
          {title ?? "Statewide composition"}
        </span>
        <span className="text-[11px] text-muted">
          Projected seats:{" "}
          <span style={{ color: POOL_COLORS.left }} className="font-semibold">
            L {proj.left}
          </span>{" "}
          ·{" "}
          <span style={{ color: POOL_COLORS.right }} className="font-semibold">
            R {proj.right}
          </span>{" "}
          · <span className="font-semibold text-foreground">Tossup {proj.tossup}</span>
        </span>
      </div>

      {beforeSummary && (
        <div className="space-y-1">
          <span className="text-[10px] uppercase tracking-wide text-muted">Before</span>
          <CategoryBar summary={beforeSummary} />
        </div>
      )}
      <div className="space-y-1">
        {beforeSummary && (
          <span className="text-[10px] uppercase tracking-wide text-muted">{proposedLabel}</span>
        )}
        <CategoryBar summary={summary} before={beforeSummary} />
      </div>

      <CategoryLegend summary={summary} before={beforeSummary} />

      {caps && (
        <div className="flex items-center gap-2 text-[11px]">
          <span className="text-muted">Efficiency gap</span>
          <span className={gapOver ? "font-semibold text-error" : "font-semibold text-foreground"}>
            {(gap * 100).toFixed(1)}%
          </span>
          <span className="text-muted">/ cap {(caps.efficiencyGapCeiling * 100).toFixed(0)}%</span>
          {gapOver && <span className="text-error">over</span>}
        </div>
      )}
    </div>
  );
}
