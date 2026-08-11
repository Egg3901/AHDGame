"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import type { EmergencyMechanicConfig } from "@/lib/constants/cabinetMechanicsTypes";
import { getCabinetActionCopy } from "./actionCopy";
import { MINISTERIAL_ACTION_RESET_HINT } from "@/lib/cabinet/ministerialActionPool";

interface RegionRow {
  regionId: string;
  regionName: string;
  metrics: Record<string, number>;
}

interface EmergencyMechanicPanelProps {
  config: EmergencyMechanicConfig;
  regionData: RegionRow[];
  actionsRemaining: number;
  canAct: boolean;
  positionId: string;
  countryCode: string;
  onUpdate: () => void;
}

export function EmergencyMechanicPanel({
  config,
  regionData,
  actionsRemaining,
  canAct,
  positionId,
  countryCode,
  onUpdate,
}: EmergencyMechanicPanelProps) {
  const [selectedRegion, setSelectedRegion] = useState("");
  const [declaring, setDeclaring] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const canDeclare = canAct && actionsRemaining >= 1;
  const actionCopy = getCabinetActionCopy(countryCode);

  const eligibleRegions = config.regionMetricThreshold
    ? regionData.filter((region) => {
        const value = region.metrics[config.regionMetricThreshold!.metric];
        return value !== undefined && value > config.regionMetricThreshold!.above;
      })
    : regionData;

  async function handleDeclare() {
    if (!canDeclare || declaring) return;
    setDeclaring(true);
    setFeedback(null);

    try {
      const response = await fetch(
        `/api/country/${countryCode}/executive/cabinet/${positionId}/order`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            orderId: `emergency_${positionId}`,
            targetRegionId: selectedRegion || null,
          }),
        }
      );
      if (!response.ok) {
        const json = (await response.json()) as { error?: string };
        setFeedback({
          type: "error",
          message: json.error ?? "Failed to declare emergency",
        });
        return;
      }
      setFeedback({ type: "success", message: "Emergency declared." });
      onUpdate();
    } catch {
      setFeedback({ type: "error", message: "Network error" });
    } finally {
      setDeclaring(false);
    }
  }

  return (
    <div className="rounded-xl border border-error/30 bg-card p-6">
      <div className="mb-4 flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-error/10">
          <svg
            className="h-4 w-4 text-error"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
            />
          </svg>
        </div>
        <div>
          <h2 className="text-lg font-semibold text-foreground">{config.name}</h2>
          <p className="mt-1 text-sm text-muted">{config.description}</p>
          <p className="mt-1 text-xs text-error">
            Cost: 1 {actionCopy.singular} - Duration: {config.duration} turns
          </p>
        </div>
      </div>

      {config.regionMetricThreshold && eligibleRegions.length === 0 && (
        <div className="mb-3 rounded-lg border border-muted/30 bg-card-elevated p-3 text-sm text-muted">
          No regions currently meet the threshold for this emergency action.
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-4">
        {regionData.length > 0 && (
          <div className="flex-1">
            <label
              htmlFor="emergency-region-select"
              className="mb-1 block text-xs font-medium text-muted"
            >
              {config.regionMetricThreshold ? "Eligible Region" : "Target Region"}
            </label>
            <select
              id="emergency-region-select"
              value={selectedRegion}
              disabled={!canDeclare}
              onChange={(event) => setSelectedRegion(event.target.value)}
              className={[
                "w-full rounded-lg border border-card-border bg-card-elevated px-3 py-2 text-sm text-foreground",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
                !canDeclare ? "cursor-not-allowed opacity-50" : "",
              ]
                .join(" ")
                .trim()}
            >
              <option value="">- Select region -</option>
              {/* When a threshold gates this mechanic, only eligible regions are
                  offered — falling back to all regions would bypass the gate
                  (it previously always fell back: the threshold key was the bare
                  metric id while the briefing keys are category-qualified). */}
              {(config.regionMetricThreshold ? eligibleRegions : regionData).map((region) => (
                <option key={region.regionId} value={region.regionId}>
                  {region.regionName}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="flex items-center gap-3">
          <Button
            variant="primary"
            disabled={!canDeclare || declaring || (regionData.length > 0 && !selectedRegion)}
            isLoading={declaring}
            onClick={handleDeclare}
            className="bg-error hover:bg-error/80"
          >
            Declare
          </Button>
          {feedback && (
            <span
              className={`text-sm ${feedback.type === "success" ? "text-success" : "text-error"}`}
            >
              {feedback.message}
            </span>
          )}
        </div>
      </div>

      {!canDeclare && canAct && (
        <p className="mt-3 text-xs text-muted">
          No {actionCopy.plural} remaining today. {MINISTERIAL_ACTION_RESET_HINT}
        </p>
      )}
    </div>
  );
}
