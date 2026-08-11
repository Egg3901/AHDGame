"use client";
import { useState } from "react";
import { Button } from "@/components/ui";
import { StatSlider } from "../StatSlider";
import type { EditorStateConfig } from "@/lib/positionEditor/types";

export function CompositionTab({
  config,
  onWeight,
  onAdd,
  onRemove,
  onCivic,
}: {
  config: EditorStateConfig;
  onWeight: (archetypeId: string, index: number, value: number) => void;
  onAdd: (archetypeId: string, dim: string, key: string) => void;
  onRemove: (archetypeId: string, index: number) => void;
  onCivic: (archetypeId: string, value: number) => void;
}) {
  const [picker, setPicker] = useState<string | null>(null);
  const DIMS = config.dims;
  return (
    <div className="space-y-4">
      {config.archetypes.map((a) => (
        <div key={a.id} className="rounded-xl border border-card-border bg-card p-4 shadow-card">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">{a.name}</h3>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setPicker(picker === a.id ? null : a.id)}
            >
              ＋ add value
            </Button>
          </div>
          {picker === a.id && (
            <div className="mb-2 flex flex-wrap gap-1">
              {DIMS.flatMap((dim) =>
                Object.keys(config.layer1[dim]).map((key) => (
                  <button
                    key={`${dim}.${key}`}
                    onClick={() => {
                      onAdd(a.id, dim, key);
                      setPicker(null);
                    }}
                    className="rounded border border-card-border px-1.5 py-0.5 text-[11px] text-muted transition-colors hover:border-primary/50 hover:text-foreground"
                  >
                    {dim}:{key}
                  </button>
                ))
              )}
            </div>
          )}
          {a.weights.map((w, i) => (
            <div
              key={`${w.dim}.${w.key}.${i}`}
              className="flex items-center gap-2 border-t border-card-border py-1 first:border-t-0"
            >
              <span className="w-44 text-xs text-muted">
                {w.dim}:{w.key}
              </span>
              <input
                type="number"
                step={0.05}
                value={w.w}
                onChange={(e) => onWeight(a.id, i, Number(e.target.value))}
                className="ahd-num w-20 rounded-md border border-card-border bg-background px-2 py-1 text-right text-sm tabular-nums focus:border-primary focus:outline-none"
              />
              <button
                onClick={() => onRemove(a.id, i)}
                className="rounded p-1 text-error transition-colors hover:bg-error/10"
                aria-label="remove"
              >
                🗑
              </button>
            </div>
          ))}
          <div className="mt-2">
            <StatSlider
              label="Civic multiplier"
              value={a.civicMultiplier}
              min={0.5}
              max={1.2}
              step={0.05}
              onChange={(v) => onCivic(a.id, v)}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
