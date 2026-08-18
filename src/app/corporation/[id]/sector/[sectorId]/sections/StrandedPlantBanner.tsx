"use client";

import { STRANDED_WARN_TURNS } from "@/lib/corporations/strandedPlant";

interface StrandedPlantBannerProps {
  /** Consecutive turns the sector cleared under half its output. */
  lowFillTurns: number;
  /** Last turn's sold fraction, 0-1, null before the first plants turn. */
  soldFraction: number | null;
  isCeo: boolean;
}

/**
 * Live warning shown while a plant is chronically stranded: it has sold less
 * than half of what it makes for STRANDED_WARN_TURNS straight. Not dismissable
 * and not stored — it reflects a current condition and disappears on its own
 * once the plant starts clearing again. The margin figure cannot warn the
 * player here (units that do sell still carry a healthy margin), so without
 * this the first visible symptom is a bank balance that never grows.
 */
export default function StrandedPlantBanner({
  lowFillTurns,
  soldFraction,
  isCeo,
}: StrandedPlantBannerProps) {
  if (lowFillTurns < STRANDED_WARN_TURNS) return null;

  const soldPct = soldFraction != null ? Math.round(soldFraction * 100) : null;

  return (
    <div
      role="status"
      aria-label="Stranded plant warning"
      className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4"
    >
      <div className="flex items-start gap-2">
        <span aria-hidden className="text-base leading-none">
          ⚠️
        </span>
        <div>
          <p className="text-sm font-semibold text-foreground">This plant cannot sell its output</p>
          <p className="mt-0.5 text-xs text-muted">
            For {lowFillTurns} turns in a row this sector has sold less than half of what it makes
            {soldPct != null ? ` (last turn: ${soldPct}%)` : ""}. The local market is oversupplied
            for its goods, so extra output earns no revenue this turn while its production costs
            still land. Its margin still looks healthy because margin only counts the units that do
            sell.
          </p>
          {isCeo && (
            <p className="mt-1.5 text-xs text-muted">
              Options: stockpile storable goods for a temporary glut, set growth to zero and let the
              plant shrink, mothball it in the Plant panel, list it for sale, or abandon it in the
              panels below. Building capacity in a state where the goods are scarce will sell far
              better.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
