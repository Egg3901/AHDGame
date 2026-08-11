"use client";

import { useEffect, useState } from "react";
import type { EconomicModelView } from "@/lib/economicModels/present";
import type { EconomicModelState } from "@/lib/constants/economicModels";
import { corpAlignmentModifier, corpAlignmentLabel } from "@/lib/economicModels/effects";
import { fetchJson } from "@/lib/observability/fetchJson";

interface CorpEconomicModelBadgeProps {
  countryId: string;
  /** The corporation's (primary) sector type. */
  sectorType: string;
}

/**
 * §6.2 (P7b): shows how the country's economic model treats this corp's sector —
 * Favored / Disfavored, with the live operating-margin modifier. Hidden when the
 * country has no model, is "mixed", or the sector is off-model-neutral.
 */
export function CorpEconomicModelBadge({ countryId, sectorType }: CorpEconomicModelBadgeProps) {
  const [view, setView] = useState<EconomicModelView | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchJson<EconomicModelView>(`/api/country/${countryId}/economic-model`, {
      feature: "economic-model",
    })
      .then((d) => {
        if (!cancelled) setView(d);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [countryId]);

  if (!view) return null;
  // The alignment helpers read only `current` + `intensity` from the state.
  const state = { current: view.current, intensity: view.intensity } as EconomicModelState;
  const label = corpAlignmentLabel(state, sectorType);
  if (label === "neutral") return null;

  const mod = corpAlignmentModifier(state, sectorType);
  const pct = Math.round(mod * 1000) / 10;
  const favored = label === "favored";

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${
        favored
          ? "border-success/40 bg-success/10 text-success"
          : "border-error/40 bg-error/10 text-error"
      }`}
      title={`${view.currentName} (intensity ${view.intensity}/100)`}
    >
      {favored ? "Favored" : "Disfavored"} under {view.currentName}
      <span className="tabular-nums">
        {pct >= 0 ? "+" : ""}
        {pct}% margin
      </span>
    </span>
  );
}

export default CorpEconomicModelBadge;
