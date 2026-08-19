"use client";

import { STRANDED_WARN_TURNS } from "@/lib/corporations/strandedPlant";
import { DELIVERY_LIMITED_MIN_SHARE } from "@/components/corporation/plantsPresentation";

interface StrandedPlantBannerProps {
  /** Consecutive turns the sector cleared under half its output. */
  lowFillTurns: number;
  /** Last turn's sold fraction, 0-1, null before the first plants turn. */
  soldFraction: number | null;
  /**
   * Last turn's delivery-limited share, 0-1. Above 1% the banner names freight
   * as the cause instead of oversupply: the advice below is the opposite in
   * that case, so getting it wrong sends the player to shrink a plant whose
   * goods buyers are still waiting for.
   */
  deliveryLimitedFraction?: number;
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
  deliveryLimitedFraction = 0,
  isCeo,
}: StrandedPlantBannerProps) {
  if (lowFillTurns < STRANDED_WARN_TURNS) return null;

  const soldPct = soldFraction != null ? Math.round(soldFraction * 100) : null;
  const deliveryLimited = deliveryLimitedFraction > DELIVERY_LIMITED_MIN_SHARE;
  const deliveryPct = Math.round(deliveryLimitedFraction * 100);

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
          <p className="text-sm font-semibold text-foreground">
            {deliveryLimited
              ? "This plant cannot deliver its output"
              : "This plant cannot sell its output"}
          </p>
          <p className="mt-0.5 text-xs text-muted">
            For {lowFillTurns} turns in a row this sector has sold less than half of what it makes
            {soldPct != null ? ` (last turn: ${soldPct}%)` : ""}.{" "}
            {deliveryLimited
              ? `Last turn ${deliveryPct}% of what it offered had no freight to carry it, so that output earned no revenue while its production costs still landed. Buyers still want it.`
              : "The local market is oversupplied for its goods, so extra output earns no revenue this turn while its production costs still land."}{" "}
            Its margin still looks healthy because margin only counts the units that do sell.
          </p>
          {isCeo && (
            <p className="mt-1.5 text-xs text-muted">
              {deliveryLimited
                ? "Options: build or expand logistics capacity in this state so the freight exists to move the goods, or build your next capacity nearer the buyers. Shrinking this plant gives up output the market is still short of."
                : "Options: stockpile storable goods for a temporary glut, set growth to zero and let the plant shrink, mothball it in the Plant panel, list it for sale, or abandon it in the panels below. Building capacity in a state where the goods are scarce will sell far better."}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
