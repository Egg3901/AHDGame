import type { DistrictSquares } from "@/lib/db/types/congressionalDistrict";
import type { Pool } from "@/lib/redistricting/pools";
import { POOL_COLORS } from "@/lib/redistricting/cardView";

const SEGMENTS: { pool: Pool; suffix: string; label: string }[] = [
  { pool: "left", suffix: "L", label: "left" },
  { pool: "grey", suffix: "G", label: "grey" },
  { pool: "right", suffix: "R", label: "right" },
];

/** Inline label shows only when a segment is at least this wide (≈ 2 squares). */
const LABEL_MIN_PERCENT = 11;

/**
 * Horizontal stacked bar of a district's 16 squares (left / grey / right). Each
 * segment carries its count inline when wide enough, and always via tooltip.
 */
export function DistrictLeanBar({
  squares,
  height = "h-7",
}: {
  squares: DistrictSquares;
  height?: string;
}) {
  return (
    <div
      className={`flex ${height} w-full overflow-hidden rounded-md border border-card-border`}
      role="img"
      aria-label={`${squares.left} left, ${squares.grey} grey, ${squares.right} right`}
    >
      {SEGMENTS.map(({ pool, suffix, label }) => {
        const count = squares[pool];
        if (count <= 0) return null;
        const pct = (count / 16) * 100;
        return (
          <div
            key={pool}
            className="flex items-center justify-center text-[11px] font-bold text-white transition-[width]"
            style={{ width: `${pct}%`, backgroundColor: POOL_COLORS[pool] }}
            title={`${count} ${label}`}
          >
            {pct >= LABEL_MIN_PERCENT ? `${count}${suffix}` : ""}
          </div>
        );
      })}
    </div>
  );
}
