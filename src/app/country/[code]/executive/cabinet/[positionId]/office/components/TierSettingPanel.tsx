"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import type { TierSettingConfig } from "@/lib/constants/cabinetMechanicsTypes";
import { ActingLockNote, useActingLock } from "./ActingLock";

interface TierSettingPanelProps {
  config: TierSettingConfig;
  currentValue: string;
  canAct: boolean;
  positionId: string;
  countryCode: string;
  onUpdate: () => void;
  /**
   * When set, this panel drives an extra portfolio lever and persists to
   * `tierSettings[tierKey]`. Omit for the seat's primary `tierSetting`.
   */
  tierKey?: string;
  /**
   * Set when an acting secretary may not move this lever. Folds into `canAct`
   * and renders as the explanation under the button, so the reason travels with
   * the disabled state instead of only living in the API's 403.
   */
  lockReason?: string | null;
}

export function TierSettingPanel({
  config,
  currentValue,
  canAct: canActProp,
  positionId,
  countryCode,
  onUpdate,
  tierKey,
  lockReason,
}: TierSettingPanelProps) {
  // One gate from here down: the seat's own permission and the acting bar read
  // the same way to every control below, so none can disagree with another.
  const contextLock = useActingLock("stance");
  const lock = lockReason ?? contextLock;
  const canAct = canActProp && !lock;

  const [selected, setSelected] = useState(currentValue);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(
    null
  );

  const isDirty = selected !== currentValue;

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
          body: JSON.stringify(
            tierKey ? { tierSettings: { [tierKey]: selected } } : { tierSetting: selected }
          ),
        }
      );
      if (!res.ok) {
        const json = (await res.json()) as { error?: string };
        setFeedback({ type: "error", message: json.error ?? "Failed to save" });
        return;
      }
      setFeedback({ type: "success", message: "Setting saved." });
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

      <div className="grid gap-3 sm:grid-cols-3">
        {config.options.map((option) => {
          const isActive = selected === option.id;
          return (
            <button
              key={option.id}
              type="button"
              disabled={!canAct}
              onClick={() => setSelected(option.id)}
              className={[
                "rounded-lg border p-4 text-left transition-all duration-150",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
                isActive
                  ? "border-primary bg-primary/10 ring-1 ring-primary/40"
                  : "border-card-border bg-card-elevated hover:border-muted/40",
                !canAct ? "cursor-not-allowed opacity-50" : "cursor-pointer",
              ]
                .join(" ")
                .trim()}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="font-semibold text-foreground text-sm">{option.label}</span>
                {isActive && (
                  <span className="text-[10px] font-bold uppercase tracking-wide text-primary">
                    Active
                  </span>
                )}
              </div>
              <p className="text-xs text-muted leading-snug">{option.description}</p>
            </button>
          );
        })}
      </div>

      <div className="mt-4 flex items-center gap-3">
        <Button
          variant="primary"
          disabled={!isDirty || !canAct || saving}
          isLoading={saving}
          onClick={handleSave}
        >
          Apply Setting
        </Button>
        {feedback && (
          <span
            className={`text-sm ${feedback.type === "success" ? "text-success" : "text-error"}`}
          >
            {feedback.message}
          </span>
        )}
      </div>

      <ActingLockNote reason={lock} />
    </div>
  );
}
