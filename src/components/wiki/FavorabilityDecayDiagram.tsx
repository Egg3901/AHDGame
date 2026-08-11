"use client";

import {
  calculateFavorabilityAboveThresholdPenalty,
  FAVORABILITY_NATURAL_DECAY_THRESHOLD,
} from "@shared/constants/formulas";

/**
 * Visual diagram showing favorability decay when above 60%.
 * User-facing: no code references.
 */
export function FavorabilityDecayDiagram() {
  const points = [100, 90, 80, 70, 60, 50].map((fav) => ({
    fav,
    decay: calculateFavorabilityAboveThresholdPenalty(fav),
  }));

  return (
    <div className="my-6 rounded-lg border border-card-border bg-card/40 p-4">
      <h4 className="mb-3 text-sm font-semibold text-foreground">
        Favorability trends toward {FAVORABILITY_NATURAL_DECAY_THRESHOLD}%
      </h4>
      <p className="mb-4 text-xs text-muted">
        Favorability is stable at or below {FAVORABILITY_NATURAL_DECAY_THRESHOLD}%. Above that, it
        naturally drifts down each turn. The higher you are, the faster it drops.
      </p>
      <div className="space-y-2">
        {points.map(({ fav, decay }) => (
          <div key={fav} className="flex items-center gap-4">
            <span className="w-12 text-sm font-medium text-foreground">{fav}%</span>
            <div className="h-2 flex-1 max-w-[200px] rounded bg-card-border">
              <div
                className="h-full rounded bg-primary/60"
                style={{ width: `${(fav / 100) * 100}%` }}
              />
            </div>
            <span className={`w-16 text-xs ${decay > 0 ? "text-error" : "text-muted"}`}>
              {decay > 0 ? `−${decay}/turn` : "stable"}
            </span>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-muted">
        Run advertisements to push above the floor or recover after attacks. Diminishing returns
        still apply above 70%.
      </p>
    </div>
  );
}
