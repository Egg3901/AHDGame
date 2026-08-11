"use client";
import { useState } from "react";
import { StatSlider } from "../StatSlider";
import type { EditorStateConfig } from "@/lib/positionEditor/types";

export function Layer1Tab({
  config,
  onChange,
  onNormalize,
}: {
  config: EditorStateConfig;
  onChange: (
    dim: string,
    key: string,
    field: "share" | "turnout" | "economicLean" | "socialLean",
    value: number
  ) => void;
  onNormalize: (dim: string) => void;
}) {
  const DIMS = config.dims;
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const archetypesFor = (dim: string, key: string) =>
    config.archetypes
      .map((a) => {
        const w = a.weights.find((w) => w.dim === dim && w.key === key);
        return w ? { name: a.name, w: w.w } : null;
      })
      .filter(Boolean) as { name: string; w: number }[];

  return (
    <div className="space-y-6">
      {DIMS.map((dim) => {
        const entries = Object.entries(config.layer1[dim]);
        const sum = entries.reduce((s, [, e]) => s + e.share, 0);
        const ok = Math.abs(sum - 100) < 0.5;
        const delta = sum - 100;
        return (
          <div
            key={dim}
            className={`rounded-xl border bg-card p-4 shadow-card ${ok ? "border-card-border" : "border-error"}`}
          >
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">{dim}</h3>
              <div className="flex items-center gap-2">
                {!ok && (
                  <button
                    onClick={() => onNormalize(dim)}
                    className="rounded border border-error/40 bg-error/10 px-2 py-0.5 text-[11px] font-medium text-error transition-colors hover:bg-error/20"
                  >
                    Normalize
                  </button>
                )}
                <span className={`text-xs tabular-nums ${ok ? "text-success" : "text-error"}`}>
                  Σ {sum.toFixed(1)}{" "}
                  {ok ? "✓" : `— off by ${delta > 0 ? "+" : ""}${delta.toFixed(1)}, needs 100`}
                </span>
              </div>
            </div>
            {entries.map(([key, e]) => {
              const archetypes = archetypesFor(dim, key);
              const expandKey = `${dim}.${key}`;
              const isExpanded = expanded[expandKey];
              return (
                <div key={key} className="border-t border-card-border py-2 first:border-t-0">
                  <p className="text-xs font-medium text-foreground">
                    {key}
                    {archetypes.length > 0 ? (
                      <button
                        onClick={() =>
                          setExpanded((prev) => ({ ...prev, [expandKey]: !prev[expandKey] }))
                        }
                        className="ml-2 text-[10px] text-muted hover:text-foreground transition-colors"
                      >
                        {isExpanded ? "▾" : "▸"} feeds {archetypes.length} archetype
                        {archetypes.length !== 1 ? "s" : ""}
                      </button>
                    ) : (
                      <span className="ml-2 text-[10px] text-muted">feeds no archetypes</span>
                    )}
                  </p>
                  {isExpanded && archetypes.length > 0 && (
                    <div className="mb-1 mt-1 rounded border border-card-border bg-background/50 px-2 py-1">
                      {archetypes.map(({ name, w }) => (
                        <div key={name} className="flex items-center justify-between py-0.5">
                          <span className="text-[11px] text-foreground">{name}</span>
                          <span className="text-[11px] tabular-nums text-muted">
                            ×{w.toFixed(2)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  <StatSlider
                    label="Share % (preview only — census, not saved)"
                    value={e.share}
                    min={0}
                    max={100}
                    step={1}
                    onChange={(v) => onChange(dim, key, "share", v)}
                  />
                  <StatSlider
                    label="Turnout %"
                    value={e.turnout}
                    min={0}
                    max={100}
                    step={1}
                    onChange={(v) => onChange(dim, key, "turnout", v)}
                  />
                  <StatSlider
                    label="Economic"
                    value={e.economicLean}
                    min={-5}
                    max={5}
                    axis="economic"
                    onChange={(v) => onChange(dim, key, "economicLean", v)}
                  />
                  <StatSlider
                    label="Social"
                    value={e.socialLean}
                    min={-5}
                    max={5}
                    axis="social"
                    onChange={(v) => onChange(dim, key, "socialLean", v)}
                  />
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
