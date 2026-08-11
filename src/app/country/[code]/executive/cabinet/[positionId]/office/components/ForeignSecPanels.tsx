"use client";

import { useState } from "react";
import { Button } from "@/components/ui";

interface CurrentSettings {
  targetCountryId: string | null;
  aidPriority: string | null;
}

interface ForeignSecPanelsProps {
  currentSettings: CurrentSettings | null;
  targetCountries: Array<{ id: string; label: string }>;
  canAct: boolean;
  positionId: string;
  countryCode: string;
  onUpdate: () => void;
}

const AID_PRIORITIES = [
  {
    id: "economic",
    label: "Economic Development",
    description: "Focus overseas aid on economic growth programmes and trade partnerships.",
  },
  {
    id: "humanitarian",
    label: "Humanitarian Aid",
    description: "Prioritise emergency relief and humanitarian assistance abroad.",
  },
  {
    id: "security",
    label: "Security Cooperation",
    description: "Channel aid into security partnerships and peacekeeping contributions.",
  },
] as const;

export function ForeignSecPanels({
  currentSettings,
  targetCountries,
  canAct,
  positionId,
  countryCode,
  onUpdate,
}: ForeignSecPanelsProps) {
  const [selectedCountry, setSelectedCountry] = useState<string>(
    currentSettings?.targetCountryId ?? ""
  );
  const [selectedPriority, setSelectedPriority] = useState<string>(
    currentSettings?.aidPriority ?? ""
  );
  const [savingCountry, setSavingCountry] = useState(false);
  const [savingPriority, setSavingPriority] = useState(false);
  const [countryFeedback, setCountryFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [priorityFeedback, setPriorityFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const countryDirty = selectedCountry !== (currentSettings?.targetCountryId ?? "");
  const priorityDirty = selectedPriority !== (currentSettings?.aidPriority ?? "");

  async function postSetting(
    body: Record<string, unknown>
  ): Promise<{ ok: boolean; error?: string }> {
    const res = await fetch(`/api/country/${countryCode}/executive/cabinet/${positionId}/setting`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const json = (await res.json()) as { error?: string };
      return { ok: false, error: json.error ?? "Failed to save" };
    }
    return { ok: true };
  }

  async function handleSaveCountry() {
    if (!countryDirty || !canAct) return;
    setSavingCountry(true);
    setCountryFeedback(null);
    try {
      const result = await postSetting({ targetCountryId: selectedCountry || null });
      if (!result.ok) {
        setCountryFeedback({ type: "error", message: result.error ?? "Failed to save" });
        return;
      }
      setCountryFeedback({ type: "success", message: "Trade envoy updated." });
      onUpdate();
    } catch {
      setCountryFeedback({ type: "error", message: "Network error" });
    } finally {
      setSavingCountry(false);
    }
  }

  async function handleSavePriority() {
    if (!priorityDirty || !canAct) return;
    setSavingPriority(true);
    setPriorityFeedback(null);
    try {
      const result = await postSetting({ aidPriority: selectedPriority || null });
      if (!result.ok) {
        setPriorityFeedback({ type: "error", message: result.error ?? "Failed to save" });
        return;
      }
      setPriorityFeedback({ type: "success", message: "Aid priority updated." });
      onUpdate();
    } catch {
      setPriorityFeedback({ type: "error", message: "Network error" });
    } finally {
      setSavingPriority(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-card-border bg-card p-6">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-foreground">Trade Envoy</h2>
          <p className="mt-1 text-sm text-muted">
            Designate a bilateral trade partner to receive a focused diplomatic and trade
            relationship bonus.
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-4">
          <div className="flex-1">
            <label
              htmlFor="trade-envoy-select"
              className="mb-1 block text-xs font-medium text-muted"
            >
              Partner Country
            </label>
            <select
              id="trade-envoy-select"
              value={selectedCountry}
              disabled={!canAct}
              onChange={(e) => setSelectedCountry(e.target.value)}
              className={[
                "w-full rounded-lg border border-card-border bg-card-elevated px-3 py-2 text-sm text-foreground",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
                !canAct ? "cursor-not-allowed opacity-50" : "",
              ]
                .join(" ")
                .trim()}
            >
              <option value="">- None -</option>
              {targetCountries.map((country) => (
                <option key={country.id} value={country.id}>
                  {country.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-3">
            <Button
              variant="primary"
              disabled={!countryDirty || !canAct || savingCountry}
              isLoading={savingCountry}
              onClick={handleSaveCountry}
            >
              Save
            </Button>
            {countryFeedback && (
              <span
                className={`text-sm ${countryFeedback.type === "success" ? "text-success" : "text-error"}`}
              >
                {countryFeedback.message}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-card-border bg-card p-6">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-foreground">Aid Priority</h2>
          <p className="mt-1 text-sm text-muted">
            Set the strategic focus for the country&apos;s overseas development assistance.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          {AID_PRIORITIES.map((option) => {
            const isActive = selectedPriority === option.id;
            return (
              <button
                key={option.id}
                type="button"
                disabled={!canAct}
                onClick={() => setSelectedPriority(option.id)}
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
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-sm font-semibold text-foreground">{option.label}</span>
                  {isActive && (
                    <span className="text-[10px] font-bold uppercase tracking-wide text-primary">
                      Active
                    </span>
                  )}
                </div>
                <p className="text-xs leading-snug text-muted">{option.description}</p>
              </button>
            );
          })}
        </div>

        <div className="mt-4 flex items-center gap-3">
          <Button
            variant="primary"
            disabled={!priorityDirty || !canAct || savingPriority}
            isLoading={savingPriority}
            onClick={handleSavePriority}
          >
            Apply Priority
          </Button>
          {priorityFeedback && (
            <span
              className={`text-sm ${priorityFeedback.type === "success" ? "text-success" : "text-error"}`}
            >
              {priorityFeedback.message}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
