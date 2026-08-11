"use client";

import type { Dispatch, SetStateAction } from "react";
import type { CrisisEffect } from "@/lib/db/types/crisis";
import { CORPORATION_TYPE_LABELS } from "@/lib/constants/corporations";
import type { CorporationType } from "@/lib/constants/corporations";
import { SECTOR_STRATEGIES } from "@/lib/constants/sectorStrategies";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import { useRegisteredCountries } from "@/contexts/RegisteredCountriesContext";
import type { FormEffect, FormState } from "./crisisAdminTypes";
import { makeEmptyEffect } from "./crisisAdminTypes";

function camelToTitle(s: string): string {
  return s
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

const METRIC_CATEGORIES = [
  {
    id: "economic",
    label: "Economic",
    fields: [
      "unemploymentRate",
      "medianIncome",
      "gdpGrowth",
      "povertyRate",
      "costOfLiving",
      "smallBusinessFormation",
    ],
  },
  {
    id: "education",
    label: "Education",
    fields: ["testPerformance", "educationSpending", "literacyRate", "workforceSkill"],
  },
  {
    id: "healthcare",
    label: "Healthcare",
    fields: ["physicianRate", "lifeExpectancy", "preventableMortality", "publicHealthPreparedness"],
  },
  {
    id: "infrastructure",
    label: "Infrastructure",
    fields: [
      "roadCondition",
      "broadbandAccess",
      "publicTransit",
      "waterQuality",
      "powerGridReliability",
    ],
  },
  {
    id: "publicSafety",
    label: "Public Safety",
    fields: ["crimeRate", "violentCrimeRate", "policePerCapita", "incarcerationRate"],
  },
  {
    id: "environment",
    label: "Environment",
    fields: [
      "airQuality",
      "renewableEnergy",
      "carbonEmissions",
      "recyclingRate",
      "climateResilience",
    ],
  },
  {
    id: "social",
    label: "Social",
    fields: [
      "socialMobility",
      "incomeInequality",
      "homelessnessRate",
      "foodInsecurity",
      "civicParticipation",
      "socialCohesion",
    ],
  },
  {
    id: "governance",
    label: "Governance",
    fields: [
      "governmentTransparency",
      "budgetBalance",
      "corruptionIndex",
      "voterTurnout",
      "publicTrust",
    ],
  },
  {
    id: "population",
    label: "Population",
    fields: ["populationGrowth", "urbanizationRate", "medianAge", "migrationRate"],
  },
  {
    id: "mediaInformation",
    label: "Media & Information",
    fields: [
      "mediaPolarization",
      "disinformationRisk",
      "pressFreedom",
      "socialMediaSentiment",
      "newsTrust",
    ],
  },
] as const;

interface CreateCrisisModalProps {
  form: FormState;
  setForm: Dispatch<SetStateAction<FormState>>;
  submitting: boolean;
  onSubmit: () => void;
  onClose: () => void;
}

export function CreateCrisisModal({
  form,
  setForm,
  submitting,
  onSubmit,
  onClose,
}: CreateCrisisModalProps) {
  const registered = useRegisteredCountries();

  const updateEffect = (index: number, patch: Partial<FormEffect>) => {
    setForm((f) => {
      const effects = [...f.effects];
      effects[index] = { ...effects[index], ...patch };
      return { ...f, effects };
    });
  };

  const addEffect = () => setForm((f) => ({ ...f, effects: [...f.effects, makeEmptyEffect()] }));

  const removeEffect = (i: number) =>
    setForm((f) => ({ ...f, effects: f.effects.filter((_, idx) => idx !== i) }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-card border border-border rounded-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold">Create Crisis</h3>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="text-muted hover:text-foreground"
          >
            ✕
          </button>
        </div>

        {/* Name */}
        <div>
          <label className="block text-sm text-muted mb-1">Name</label>
          <input
            className="w-full rounded border border-border bg-background px-2 py-1 text-sm"
            value={form.name}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                name: e.target.value,
                wireMessageOnStart: e.target.value,
              }))
            }
          />
        </div>

        {/* Description */}
        <div>
          <label className="block text-sm text-muted mb-1">Description</label>
          <textarea
            className="w-full rounded border border-border bg-background px-2 py-1 text-sm"
            rows={3}
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          />
        </div>

        {/* Scope */}
        <div>
          <label className="block text-sm text-muted mb-1">Scope</label>
          <div className="flex gap-4">
            {(["global", "country", "region"] as const).map((s) => (
              <label key={s} className="flex items-center gap-1.5 text-sm">
                <input
                  type="radio"
                  checked={form.scope === s}
                  onChange={() =>
                    setForm((f) => ({ ...f, scope: s, countryIds: [], regionIds: [] }))
                  }
                />
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </label>
            ))}
          </div>
        </div>

        {/* Country selector */}
        {(form.scope === "country" || form.scope === "region") && (
          <div>
            <label className="block text-sm text-muted mb-1">Target Countries</label>
            <div className="flex flex-wrap gap-3">
              {registered.map((countryId) => (
                <label key={countryId} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={form.countryIds.includes(countryId)}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        countryIds: e.target.checked
                          ? [...f.countryIds, countryId]
                          : f.countryIds.filter((id) => id !== countryId),
                      }))
                    }
                  />
                  {COUNTRY_CONFIGS[countryId].name}
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Region IDs */}
        {form.scope === "region" && (
          <div>
            <label className="block text-sm text-muted mb-1">
              Region IDs (comma-separated state slugs, e.g. CA, TX, London)
            </label>
            <input
              className="w-full rounded border border-border bg-background px-2 py-1 text-sm"
              value={form.regionIds.join(", ")}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  regionIds: e.target.value
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean),
                }))
              }
            />
          </div>
        )}

        {/* Duration */}
        <div>
          <label className="block text-sm text-muted mb-1">Duration</label>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-1.5 text-sm">
              <input
                type="radio"
                checked={!form.durationFixed}
                onChange={() => setForm((f) => ({ ...f, durationFixed: false }))}
              />
              Indefinite
            </label>
            <label className="flex items-center gap-1.5 text-sm">
              <input
                type="radio"
                checked={form.durationFixed}
                onChange={() => setForm((f) => ({ ...f, durationFixed: true }))}
              />
              Fixed:
            </label>
            <input
              type="number"
              min={1}
              className="w-20 rounded border border-border bg-background px-2 py-1 text-sm disabled:opacity-40"
              value={form.durationTurns}
              disabled={!form.durationFixed}
              onChange={(e) => setForm((f) => ({ ...f, durationTurns: e.target.value }))}
            />
            <span className="text-sm text-muted">turns</span>
          </div>
        </div>

        {/* Wire messages */}
        <div>
          <label className="block text-sm text-muted mb-1">Wire message (start)</label>
          <input
            className="w-full rounded border border-border bg-background px-2 py-1 text-sm"
            value={form.wireMessageOnStart}
            onChange={(e) => setForm((f) => ({ ...f, wireMessageOnStart: e.target.value }))}
          />
        </div>
        <div>
          <label className="block text-sm text-muted mb-1">Wire message (end, optional)</label>
          <input
            className="w-full rounded border border-border bg-background px-2 py-1 text-sm"
            value={form.wireMessageOnEnd}
            onChange={(e) => setForm((f) => ({ ...f, wireMessageOnEnd: e.target.value }))}
          />
        </div>

        {/* Effects builder */}
        <div>
          <label className="block text-sm text-muted mb-2">Effects</label>
          <div className="space-y-3">
            {form.effects.map((effect, i) => (
              <div key={i} className="border border-border/50 rounded p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted font-medium">Effect {i + 1}</span>
                  {form.effects.length > 1 && (
                    <button
                      onClick={() => removeEffect(i)}
                      className="text-red-400 text-xs hover:underline"
                    >
                      Remove
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs text-muted mb-1">Effect type</label>
                    <select
                      className="w-full rounded border border-border bg-background px-2 py-1 text-sm"
                      value={effect.effectType}
                      onChange={(e) =>
                        updateEffect(i, {
                          effectType: e.target.value as "flat" | "tick",
                        })
                      }
                    >
                      <option value="tick">Per-turn (tick)</option>
                      <option value="flat">One-time (flat)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-muted mb-1">Target</label>
                    <select
                      className="w-full rounded border border-border bg-background px-2 py-1 text-sm"
                      value={effect.targetType}
                      onChange={(e) =>
                        updateEffect(i, {
                          targetType: e.target.value as CrisisEffect["targetType"],
                          metricCategory: null,
                          metricField: null,
                          sectorType: null,
                          strategyId: null,
                        })
                      }
                    >
                      <option value="metric">Metric</option>
                      <option value="approval">Government Approval</option>
                      <option value="profitMargin">Profit Margin</option>
                      <option value="inflation">Inflation Rate</option>
                    </select>
                  </div>
                </div>

                {effect.targetType === "metric" && (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs text-muted mb-1">Category</label>
                      <select
                        className="w-full rounded border border-border bg-background px-2 py-1 text-sm"
                        value={effect.metricCategory ?? "economic"}
                        onChange={(e) =>
                          updateEffect(i, {
                            metricCategory: e.target.value,
                            metricField: null,
                          })
                        }
                      >
                        {METRIC_CATEGORIES.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-muted mb-1">Field</label>
                      <select
                        className="w-full rounded border border-border bg-background px-2 py-1 text-sm"
                        value={effect.metricField ?? ""}
                        onChange={(e) => updateEffect(i, { metricField: e.target.value })}
                      >
                        <option value="">Select field...</option>
                        {(
                          METRIC_CATEGORIES.find((c) => c.id === effect.metricCategory)?.fields ??
                          []
                        ).map((f) => (
                          <option key={f} value={f}>
                            {camelToTitle(f)}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}

                {effect.targetType === "profitMargin" && (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs text-muted mb-1">Sector (optional)</label>
                      <select
                        className="w-full rounded border border-border bg-background px-2 py-1 text-sm"
                        value={effect.sectorType ?? ""}
                        onChange={(e) =>
                          updateEffect(i, {
                            sectorType: e.target.value || null,
                            strategyId: null,
                          })
                        }
                      >
                        <option value="">All Sectors</option>
                        {(
                          Object.entries(CORPORATION_TYPE_LABELS) as [CorporationType, string][]
                        ).map(([id, label]) => (
                          <option key={id} value={id}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-muted mb-1">Strategy (optional)</label>
                      <select
                        className="w-full rounded border border-border bg-background px-2 py-1 text-sm disabled:opacity-40"
                        value={effect.strategyId ?? ""}
                        disabled={!effect.sectorType}
                        onChange={(e) => updateEffect(i, { strategyId: e.target.value || null })}
                      >
                        <option value="">
                          {effect.sectorType ? "All Strategies" : "— Select a sector first —"}
                        </option>
                        {effect.sectorType &&
                          SECTOR_STRATEGIES[effect.sectorType as CorporationType].map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                      </select>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs text-muted mb-1">
                      Value{effect.targetType === "profitMargin" ? " (% pts)" : ""}
                    </label>
                    <input
                      type="text"
                      inputMode="decimal"
                      className="w-full rounded border border-border bg-background px-2 py-1 text-sm"
                      value={effect.value}
                      onChange={(e) => updateEffect(i, { value: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-muted mb-1">Label</label>
                    <input
                      className="w-full rounded border border-border bg-background px-2 py-1 text-sm"
                      value={effect.label}
                      onChange={(e) => updateEffect(i, { label: e.target.value })}
                    />
                  </div>
                </div>
              </div>
            ))}
            <button onClick={addEffect} className="text-sm text-primary hover:underline">
              + Add Effect
            </button>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-border">
          <button
            onClick={onClose}
            className="rounded border border-border px-4 py-1.5 text-sm hover:border-foreground/40"
          >
            Cancel
          </button>
          <button
            onClick={onSubmit}
            disabled={submitting}
            className="rounded border border-primary bg-primary px-4 py-1.5 text-sm text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {submitting ? "Creating..." : "Create Crisis"}
          </button>
        </div>
      </div>
    </div>
  );
}
