"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import type { AdvocacyConfig } from "@/lib/constants/cabinetMechanicsTypes";

interface AdvocacyTogglePanelProps {
  config: AdvocacyConfig;
  active: boolean;
  canAct: boolean;
  positionId: string;
  countryCode: string;
  onUpdate: () => void;
}

export function AdvocacyTogglePanel({
  config,
  active,
  canAct,
  positionId,
  countryCode,
  onUpdate,
}: AdvocacyTogglePanelProps) {
  const [toggled, setToggled] = useState(active);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(
    null
  );

  const isDirty = toggled !== active;

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
          body: JSON.stringify({ advocacyActive: toggled }),
        }
      );
      if (!res.ok) {
        const json = (await res.json()) as { error?: string };
        setFeedback({ type: "error", message: json.error ?? "Failed to save" });
        return;
      }
      setFeedback({
        type: "success",
        message: toggled ? "Advocacy enabled." : "Advocacy disabled.",
      });
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

      <div className="flex items-center gap-4">
        {/* Toggle switch */}
        <button
          type="button"
          role="switch"
          aria-checked={toggled}
          disabled={!canAct}
          onClick={() => setToggled((v) => !v)}
          className={[
            "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
            toggled ? "bg-primary" : "bg-card-border",
            !canAct ? "cursor-not-allowed opacity-50" : "cursor-pointer",
          ]
            .join(" ")
            .trim()}
        >
          <span
            className={[
              "inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200",
              toggled ? "translate-x-6" : "translate-x-1",
            ].join(" ")}
          />
        </button>

        <span className={`text-sm font-medium ${toggled ? "text-foreground" : "text-muted"}`}>
          {toggled ? "Active" : "Inactive"}
        </span>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <Button
          variant="primary"
          disabled={!isDirty || !canAct || saving}
          isLoading={saving}
          onClick={handleSave}
        >
          Save
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
  );
}
