"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import type { RegionalTargetConfig } from "@/lib/constants/cabinetMechanicsTypes";

interface RegionRow {
  regionId: string;
  regionName: string;
}

interface RegionalTargetPanelProps {
  config: RegionalTargetConfig;
  regionData: RegionRow[];
  currentRegionId: string | null;
  canAct: boolean;
  positionId: string;
  countryCode: string;
  onUpdate: () => void;
}

export function RegionalTargetPanel({
  config,
  regionData,
  currentRegionId,
  canAct,
  positionId,
  countryCode,
  onUpdate,
}: RegionalTargetPanelProps) {
  const [selected, setSelected] = useState<string>(currentRegionId ?? "");
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(
    null
  );

  const isDirty = selected !== (currentRegionId ?? "");

  async function handleSave() {
    if (!isDirty || !canAct) return;
    setSaving(true);
    setFeedback(null);
    try {
      const res = await fetch(
        `/api/country/${countryCode}/executive/cabinet/${positionId}/setting`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ targetRegionId: selected || null }),
        }
      );
      if (!res.ok) {
        const json = (await res.json()) as { error?: string };
        setFeedback({ type: "error", message: json.error ?? "Failed to save" });
        return;
      }
      setFeedback({ type: "success", message: "Target updated." });
      onUpdate();
    } catch {
      setFeedback({ type: "error", message: "Network error" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border border-card-border bg-card p-6">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-foreground">{config.name}</h2>
        <p className="text-sm text-muted mt-1">{config.description}</p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-4">
        <div className="flex-1">
          <label
            htmlFor="regional-target-select"
            className="block text-xs font-medium text-muted mb-1"
          >
            Target Region
          </label>
          <select
            id="regional-target-select"
            value={selected}
            disabled={!canAct}
            onChange={(e) => setSelected(e.target.value)}
            className={[
              "w-full rounded-lg border border-card-border bg-card-elevated px-3 py-2 text-sm text-foreground",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
              !canAct ? "cursor-not-allowed opacity-50" : "",
            ]
              .join(" ")
              .trim()}
          >
            <option value="">— No target —</option>
            {regionData.map((r) => (
              <option key={r.regionId} value={r.regionId}>
                {r.regionName}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-3">
          <Button
            variant="primary"
            disabled={!isDirty || !canAct || saving}
            isLoading={saving}
            onClick={handleSave}
          >
            Set Target
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
    </div>
  );
}
