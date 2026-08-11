"use client";

import type { LegislationEffectTargetV2 } from "@/lib/db/types";
import { METRIC_OPTIONS } from "./constants";

interface Step2MetricEffectsProps {
  effectTargets: LegislationEffectTargetV2[];
  onChange: (effects: LegislationEffectTargetV2[]) => void;
}

export function Step2MetricEffects({ effectTargets, onChange }: Step2MetricEffectsProps) {
  const addEffect = () => {
    onChange([
      ...effectTargets,
      {
        metricCategoryId: "economic" as LegislationEffectTargetV2["metricCategoryId"],
        metricId: "unemploymentRate",
        strength: "moderate",
      },
    ]);
  };

  const updateEffect = (index: number, updates: Partial<LegislationEffectTargetV2>) => {
    const newEffects = [...effectTargets];
    newEffects[index] = { ...newEffects[index], ...updates };

    // Reset metricId if category changed
    if (
      updates.metricCategoryId &&
      !METRIC_OPTIONS[updates.metricCategoryId]?.includes(newEffects[index].metricId)
    ) {
      newEffects[index].metricId = METRIC_OPTIONS[updates.metricCategoryId][0];
    }

    onChange(newEffects);
  };

  const removeEffect = (index: number) => {
    onChange(effectTargets.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-medium">Metric Effects</h3>
        <p className="text-xs text-muted mt-1">
          Effects apply uniformly to all 50 states. National metrics are derived from state
          averages.
        </p>
      </div>

      {effectTargets.map((effect, index) => (
        <div
          key={index}
          className="rounded-lg border border-card-border bg-background p-4 space-y-3"
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="block text-xs font-medium mb-1">Category</label>
              <select
                value={effect.metricCategoryId}
                onChange={(e) =>
                  updateEffect(index, {
                    metricCategoryId: e.target
                      .value as LegislationEffectTargetV2["metricCategoryId"],
                  })
                }
                className="w-full rounded border border-card-border bg-card px-2 py-1.5 text-sm"
              >
                {Object.keys(METRIC_OPTIONS).map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium mb-1">Metric</label>
              <select
                value={effect.metricId}
                onChange={(e) => updateEffect(index, { metricId: e.target.value })}
                className="w-full rounded border border-card-border bg-card px-2 py-1.5 text-sm"
              >
                {METRIC_OPTIONS[effect.metricCategoryId]?.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium mb-1">Strength</label>
              <div className="flex gap-2">
                {(["weak", "moderate", "strong"] as const).map((s) => (
                  <label key={s} className="flex items-center gap-1 text-xs cursor-pointer">
                    <input
                      type="radio"
                      checked={effect.strength === s}
                      onChange={() => updateEffect(index, { strength: s })}
                    />
                    {s} ({s === "weak" ? "0.5x" : s === "moderate" ? "1x" : "1.5x"})
                  </label>
                ))}
              </div>
            </div>
          </div>

          <button
            onClick={() => removeEffect(index)}
            className="text-xs text-red-400 hover:text-red-300"
          >
            Remove
          </button>
        </div>
      ))}

      <button
        onClick={addEffect}
        className="w-full rounded-lg border border-dashed border-card-border py-3 text-sm text-muted hover:text-foreground hover:border-foreground/30 transition-colors"
      >
        + Add Metric Effect
      </button>
    </div>
  );
}
