"use client";

import { formatUnits } from "../lib/helpers";
import type { DemandDriver } from "../types";

interface DemandDriverBannerProps {
  demandDriver: DemandDriver | null;
  unit: string;
}

export default function DemandDriverBanner({ demandDriver, unit }: DemandDriverBannerProps) {
  if (!demandDriver) return null;

  return (
    <div className="rounded-xl border border-primary/20 bg-primary/5 px-5 py-3 mb-4">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs font-bold text-primary uppercase tracking-wider">
          {demandDriver.label}
        </span>
      </div>
      <p className="text-sm text-muted">{demandDriver.description}</p>
      {demandDriver.sourceUnits != null && demandDriver.sourceUnits > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <span className="font-semibold text-foreground">{demandDriver.sourceLabel}:</span>
          <span className="font-bold text-primary">
            {formatUnits(demandDriver.sourceUnits, unit)}/day
          </span>
          <span className="text-muted">
            ({demandDriver.sourceShare?.toFixed(1) ?? "0.0"}% of total demand)
          </span>
        </div>
      )}
    </div>
  );
}
