"use client";

import { ENERGY_SOURCES } from "@/lib/constants/cabinetEnergy";
import { SOURCE_COLOR } from "./energyUi";

/** Horizontal stacked bar of the generation mix by source, with a legend. */
export function MixBar({ bySource, total }: { bySource: Record<string, number>; total: number }) {
  const segs = ENERGY_SOURCES.map((s) => ({
    id: s.id,
    label: s.label,
    cap: bySource[s.id] ?? 0,
  })).filter((x) => x.cap > 0);
  return (
    <div>
      <div className="flex h-4 w-full overflow-hidden rounded-full border border-card-border bg-card-muted">
        {total > 0 &&
          segs.map((s) => (
            <div
              key={s.id}
              style={{ width: `${(s.cap / total) * 100}%`, background: SOURCE_COLOR[s.id] }}
              title={s.label}
            />
          ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
        {segs.map((s) => (
          <span key={s.id} className="flex items-center gap-1.5 text-[11px] text-muted">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: SOURCE_COLOR[s.id] }} />
            {s.label} {total > 0 ? Math.round((s.cap / total) * 100) : 0}%
          </span>
        ))}
      </div>
    </div>
  );
}
