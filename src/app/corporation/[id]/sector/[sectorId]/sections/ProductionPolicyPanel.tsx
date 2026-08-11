"use client";

import { Slider } from "@/components/ui";
import { getPolicyEffectInfo } from "@/lib/utils/productionPolicy";
import type { SectorData } from "../types";

interface ProductionPolicyPanelProps {
  sector: SectorData;
  isCeo: boolean;
  policyDraft: number;
  policySaving: boolean;
  policyMessage: string;
  onPolicyChange: (value: number) => void;
  onSave: () => void;
}

export default function ProductionPolicyPanel({
  sector,
  isCeo,
  policyDraft,
  policySaving,
  policyMessage,
  onPolicyChange,
  onSave,
}: ProductionPolicyPanelProps) {
  const effects = getPolicyEffectInfo(sector.productionPolicyLevel);

  return (
    <div className="rounded-xl border border-card-border bg-card p-6">
      <h2 className="mb-1 text-lg font-bold text-foreground">Production Policy</h2>
      <p className="text-xs text-muted mb-4">
        Output intensity level. High policy favors output over input efficiency; low policy
        aggressively cuts input costs. Trends toward target at 1 point per turn.
      </p>
      <div className="flex items-center gap-3 mb-2">
        <span className="text-xs text-muted w-24">
          Active:{" "}
          <span
            className={
              sector.productionPolicyLevel >= 0
                ? "text-success font-medium"
                : "text-error font-medium"
            }
          >
            {sector.productionPolicyLevel >= 0 ? "+" : ""}
            {sector.productionPolicyLevel}%
          </span>
        </span>
        <span className="text-xs text-muted">
          Target:{" "}
          <span className="text-foreground font-medium">
            {sector.productionPolicy >= 0 ? "+" : ""}
            {sector.productionPolicy}%
          </span>
        </span>
      </div>
      {/* Effect breakdown */}
      <div className="mb-4 grid grid-cols-3 gap-2 rounded-lg border border-card-border bg-background/50 p-3">
        <div className="text-center">
          <div className="text-xs text-muted">Revenue</div>
          <div
            className={`text-sm font-semibold ${effects.revenue.multiplier >= 1 ? "text-success" : "text-error"}`}
          >
            {effects.revenue.label}
          </div>
        </div>
        <div className="text-center">
          <div className="text-xs text-muted">Output (Supply)</div>
          <div
            className={`text-sm font-semibold ${effects.output.multiplier >= 1 ? "text-success" : "text-error"}`}
          >
            {effects.output.label}
          </div>
        </div>
        <div className="text-center">
          <div className="text-xs text-muted">Input (Demand)</div>
          <div
            className={`text-sm font-semibold ${effects.input.multiplier >= 1 ? "text-warning" : "text-success"}`}
          >
            {effects.input.label}
          </div>
        </div>
      </div>
      {isCeo && (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <Slider
              min={-25}
              max={25}
              step={1}
              value={policyDraft}
              onChange={(e) => onPolicyChange(Number(e.target.value))}
              variant={policyDraft >= 0 ? "success" : "error"}
              className="flex-1"
            />
            <input
              type="number"
              min={-25}
              max={25}
              step={1}
              value={policyDraft}
              onChange={(e) => onPolicyChange(Math.max(-25, Math.min(25, Number(e.target.value))))}
              className="w-20 rounded-lg border border-card-border bg-background px-3 py-2 text-sm focus:border-primary/60 focus:outline-none"
            />
            <span className="text-sm text-muted">%</span>
            <button
              onClick={onSave}
              disabled={policySaving}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {policySaving ? "Saving..." : "Set Target"}
            </button>
          </div>
          {policyMessage && (
            <p
              className={`text-xs font-medium ${
                policyMessage.startsWith("Target") ? "text-success" : "text-error"
              }`}
            >
              {policyMessage}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
