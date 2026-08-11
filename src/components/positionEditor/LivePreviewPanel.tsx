"use client";
import {
  formatLeanValue,
  getLeanLabel,
  getSocialLeanLabel,
  getDisplayLean,
} from "@/lib/utils/demographics";
import { LeanSpectrum } from "./LeanSpectrum";
import type { DerivedComposition } from "@/lib/positionEditor/types";

export function LivePreviewPanel({ derived }: { derived: DerivedComposition }) {
  const display = getDisplayLean(derived.stateEconomicLean, derived.stateSocialLean);
  return (
    <div className="sticky top-4 rounded-xl border border-card-border bg-card p-4 shadow-card">
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
        Live State Lean
      </p>
      <p className="mb-3 text-[11px] text-muted">Recomputed on every change · no calculate step</p>
      <div className="space-y-3 text-sm">
        <div>
          <div className="flex justify-between">
            <span className="text-muted">Economic</span>
            <span className="tabular-nums text-foreground">
              {formatLeanValue(derived.stateEconomicLean)} ·{" "}
              {getLeanLabel(derived.stateEconomicLean)}
            </span>
          </div>
          <LeanSpectrum value={derived.stateEconomicLean} axis="economic" />
        </div>
        <div>
          <div className="flex justify-between">
            <span className="text-muted">Social</span>
            <span className="tabular-nums text-foreground">
              {formatLeanValue(derived.stateSocialLean)} ·{" "}
              {getSocialLeanLabel(derived.stateSocialLean)}
            </span>
          </div>
          <LeanSpectrum value={derived.stateSocialLean} axis="social" />
        </div>
        <div className="flex justify-between border-t border-card-border pt-2">
          <span className="text-muted">Display</span>
          <span className="tabular-nums text-foreground">{formatLeanValue(display)}</span>
        </div>
      </div>
    </div>
  );
}
