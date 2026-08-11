"use client";

import type { LegislationPolicyOption } from "@/lib/db/types";

interface Step4PolicyOptionsProps {
  options: LegislationPolicyOption[];
  typeId: string;
  onChange: (options: LegislationPolicyOption[]) => void;
}

export function Step4PolicyOptions({ options, typeId, onChange }: Step4PolicyOptionsProps) {
  const addOption = () => {
    const newId = `${typeId}_opt_${options.length}`;
    onChange([
      ...options,
      { id: newId, name: "", stance: "center", effectDirection: 0, economic: 0, social: 0 },
    ]);
  };

  const updateOption = (index: number, updates: Partial<LegislationPolicyOption>) => {
    const newOptions = [...options];
    newOptions[index] = { ...newOptions[index], ...updates };
    onChange(newOptions);
  };

  const removeOption = (index: number) => {
    onChange(options.filter((_, i) => i !== index));
  };

  const moveOption = (index: number, direction: -1 | 1) => {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= options.length) return;
    const newOptions = [...options];
    [newOptions[index], newOptions[newIndex]] = [newOptions[newIndex], newOptions[index]];
    onChange(newOptions);
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-medium">Policy Options</h3>
        <p className="text-xs text-muted mt-1">
          Define 5-7 policy stances from left to right. At least 3 required (left, center, right).
        </p>
      </div>

      {options.map((opt, index) => (
        <div
          key={index}
          className="rounded-lg border border-card-border bg-background p-4 space-y-3"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted">Option #{index + 1}</span>
            <div className="flex gap-1">
              <button
                onClick={() => moveOption(index, -1)}
                disabled={index === 0}
                className="text-xs text-muted hover:text-foreground disabled:opacity-30"
              >
                ↑
              </button>
              <button
                onClick={() => moveOption(index, 1)}
                disabled={index === options.length - 1}
                className="text-xs text-muted hover:text-foreground disabled:opacity-30"
              >
                ↓
              </button>
              <button
                onClick={() => removeOption(index)}
                className="text-xs text-red-400 hover:text-red-300 ml-2"
              >
                Remove
              </button>
            </div>
          </div>

          <input
            type="text"
            value={opt.name}
            onChange={(e) => updateOption(index, { name: e.target.value })}
            placeholder="Policy option name"
            className="w-full rounded border border-card-border bg-card px-2 py-1.5 text-sm"
          />

          <div className="grid gap-3 sm:grid-cols-4">
            <div>
              <label className="block text-xs font-medium mb-1">Stance</label>
              <select
                value={opt.stance}
                onChange={(e) =>
                  updateOption(index, {
                    stance: e.target.value as LegislationPolicyOption["stance"],
                  })
                }
                className="w-full rounded border border-card-border bg-card px-2 py-1.5 text-sm"
              >
                <option value="left">Left</option>
                <option value="center">Center</option>
                <option value="right">Right</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium mb-1">Effect</label>
              <select
                value={opt.effectDirection}
                onChange={(e) =>
                  updateOption(index, {
                    effectDirection: parseInt(
                      e.target.value
                    ) as LegislationPolicyOption["effectDirection"],
                  })
                }
                className="w-full rounded border border-card-border bg-card px-2 py-1.5 text-sm"
              >
                <option value={1}>Positive (+)</option>
                <option value={0}>Neutral (0)</option>
                <option value={-1}>Negative (-)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium mb-1">Economic</label>
              <input
                type="number"
                min={-3}
                max={3}
                value={opt.economic}
                onChange={(e) => updateOption(index, { economic: parseInt(e.target.value) || 0 })}
                className="w-full rounded border border-card-border bg-card px-2 py-1.5 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-medium mb-1">Social</label>
              <input
                type="number"
                min={-3}
                max={3}
                value={opt.social}
                onChange={(e) => updateOption(index, { social: parseInt(e.target.value) || 0 })}
                className="w-full rounded border border-card-border bg-card px-2 py-1.5 text-sm"
              />
            </div>
          </div>
        </div>
      ))}

      <button
        onClick={addOption}
        className="w-full rounded-lg border border-dashed border-card-border py-3 text-sm text-muted hover:text-foreground hover:border-foreground/30 transition-colors"
      >
        + Add Policy Option
      </button>

      {options.length < 3 && (
        <p className="text-xs text-yellow-400">At least 3 options required (left, center, right)</p>
      )}
    </div>
  );
}
