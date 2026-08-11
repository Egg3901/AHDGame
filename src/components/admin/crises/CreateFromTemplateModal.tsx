"use client";

import type { Dispatch, SetStateAction } from "react";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import { useRegisteredCountries } from "@/contexts/RegisteredCountriesContext";
import { ALL_CRISIS_TEMPLATES, getTemplateDuration } from "@/lib/crises/templates";

interface CreateFromTemplateModalProps {
  selectedTemplate: string;
  setSelectedTemplate: (key: string) => void;
  templateTargetCountries: string[];
  setTemplateTargetCountries: Dispatch<SetStateAction<string[]>>;
  templateRegionIds: string;
  setTemplateRegionIds: (value: string) => void;
  templateDuration: string;
  setTemplateDuration: (value: string) => void;
  templateSubmitting: boolean;
  onSubmit: () => void;
  onClose: () => void;
  onCancel: () => void;
}

export function CreateFromTemplateModal({
  selectedTemplate,
  setSelectedTemplate,
  templateTargetCountries,
  setTemplateTargetCountries,
  templateRegionIds,
  setTemplateRegionIds,
  templateDuration,
  setTemplateDuration,
  templateSubmitting,
  onSubmit,
  onClose,
  onCancel,
}: CreateFromTemplateModalProps) {
  const registered = useRegisteredCountries();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-card border border-border rounded-lg p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold">Create Crisis from Template</h3>
          <button onClick={onClose} className="text-muted hover:text-foreground">
            ✕
          </button>
        </div>

        {/* Template selection */}
        <div>
          <label className="block text-sm text-muted mb-1">Template</label>
          <select
            className="w-full rounded border border-border bg-background px-2 py-1 text-sm"
            value={selectedTemplate}
            onChange={(e) => {
              const key = e.target.value;
              setSelectedTemplate(key);
              setTemplateTargetCountries([]);
              setTemplateRegionIds("");
              const template = key ? ALL_CRISIS_TEMPLATES[key] : null;
              const duration = template ? getTemplateDuration(template, template.scope) : null;
              setTemplateDuration(duration != null ? String(duration) : "");
            }}
          >
            <option value="">Select a template...</option>
            {Object.entries(ALL_CRISIS_TEMPLATES).map(([key, template]) => (
              <option key={key} value={key}>
                {template.name} ({template.scope})
              </option>
            ))}
          </select>
          {selectedTemplate && (
            <p className="mt-1 text-xs text-muted">
              {ALL_CRISIS_TEMPLATES[selectedTemplate].description}
            </p>
          )}
        </div>

        {/* Preview of what the template will apply, so admins aren't
            committing a one-click crisis blind. */}
        {selectedTemplate && (
          <div className="rounded border border-border/60 bg-background/40 p-3 space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded bg-card-elevated border border-border px-1.5 py-0.5 text-muted">
                Duration:{" "}
                {(() => {
                  const t = ALL_CRISIS_TEMPLATES[selectedTemplate];
                  const d = getTemplateDuration(t, t.scope);
                  return d ? `${d} turns` : "Indefinite";
                })()}
              </span>
              {ALL_CRISIS_TEMPLATES[selectedTemplate].interactionDefinition && (
                <span className="rounded border border-purple-500/40 bg-purple-500/10 px-1.5 py-0.5 text-purple-400">
                  Interactive decision tree
                </span>
              )}
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted mb-1">
                Effects ({ALL_CRISIS_TEMPLATES[selectedTemplate].effects.length})
              </p>
              <ul className="space-y-0.5">
                {ALL_CRISIS_TEMPLATES[selectedTemplate].effects.map((e, i) => (
                  <li key={i} className="flex items-center gap-2 text-xs">
                    <span
                      className={`font-mono tabular-nums ${
                        e.value < 0 ? "text-red-400" : "text-green-400"
                      }`}
                    >
                      {e.value > 0 ? "+" : ""}
                      {e.value}
                    </span>
                    <span className="text-muted">
                      {e.label}
                      <span className="ml-1 opacity-60">
                        ({e.effectType === "tick" ? "per-turn" : "one-time"})
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {/* Target countries for non-global templates */}
        {selectedTemplate && ALL_CRISIS_TEMPLATES[selectedTemplate].scope !== "global" && (
          <div>
            <label className="block text-sm text-muted mb-1">
              Target Countries
              {ALL_CRISIS_TEMPLATES[selectedTemplate].scope === "country" && (
                <span className="text-amber-400"> *</span>
              )}
            </label>
            <div className="flex flex-wrap gap-3">
              {registered.map((countryId) => (
                <label key={countryId} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={templateTargetCountries.includes(countryId)}
                    onChange={(e) =>
                      setTemplateTargetCountries((prev) =>
                        e.target.checked
                          ? [...prev, countryId]
                          : prev.filter((id) => id !== countryId)
                      )
                    }
                  />
                  {COUNTRY_CONFIGS[countryId].name}
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Region IDs for regional templates */}
        {selectedTemplate && ALL_CRISIS_TEMPLATES[selectedTemplate].scope === "region" && (
          <div>
            <label className="block text-sm text-muted mb-1">
              Region IDs (comma-separated state slugs)
            </label>
            <input
              className="w-full rounded border border-border bg-background px-2 py-1 text-sm"
              value={templateRegionIds}
              onChange={(e) => setTemplateRegionIds(e.target.value)}
              placeholder="e.g. CA, TX, London"
            />
          </div>
        )}

        {/* Duration override */}
        {selectedTemplate && (
          <div>
            <label className="block text-sm text-muted mb-1">
              Duration (turns)
              <span className="ml-1 text-xs opacity-60">
                — defaults to{" "}
                {getTemplateDuration(
                  ALL_CRISIS_TEMPLATES[selectedTemplate],
                  ALL_CRISIS_TEMPLATES[selectedTemplate].scope
                ) ?? "indefinite"}{" "}
                for {ALL_CRISIS_TEMPLATES[selectedTemplate].scope} scope
              </span>
            </label>
            <input
              type="number"
              min="1"
              className="w-full rounded border border-border bg-background px-2 py-1 text-sm"
              value={templateDuration}
              onChange={(e) => setTemplateDuration(e.target.value)}
              placeholder="Override duration, or leave blank for indefinite"
            />
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t border-border">
          <button
            onClick={onCancel}
            className="rounded border border-border px-4 py-1.5 text-sm hover:border-foreground/40"
          >
            Cancel
          </button>
          <button
            onClick={onSubmit}
            disabled={templateSubmitting || !selectedTemplate}
            className="rounded border border-primary bg-primary px-4 py-1.5 text-sm text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {templateSubmitting ? "Creating..." : "Create from Template"}
          </button>
        </div>
      </div>
    </div>
  );
}
