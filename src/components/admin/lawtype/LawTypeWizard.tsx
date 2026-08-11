"use client";

import { useState } from "react";
import type { LegislationType } from "@/lib/db/types";
import type { WizardState } from "./types";
import { POLICY_DOMAINS } from "./constants";
import { Step1BasicInfo } from "./Step1BasicInfo";
import { Step2MetricEffects } from "./Step2MetricEffects";
import { Step3Demographics } from "./Step3Demographics";
import { Step4PolicyOptions } from "./Step4PolicyOptions";
import { Step5Committee } from "./Step5Committee";
import type {
  LegislationEffectTargetV2,
  DemographicTargeting,
  LegislationPolicyOption,
} from "@/lib/db/types";

interface LawTypeWithMeta extends LegislationType {
  source?: "seed" | "admin";
  isPermanent?: boolean;
}

interface LawTypeWizardProps {
  initialData: LawTypeWithMeta | null;
  onClose: (saved: boolean) => void;
}

const STEPS = [
  { id: 1, name: "Basic Info" },
  { id: 2, name: "Metric Effects" },
  { id: 3, name: "Demographics" },
  { id: 4, name: "Policy Options" },
  { id: 5, name: "Committee" },
];

export function LawTypeWizard({ initialData, onClose }: LawTypeWizardProps) {
  const isEditing = !!initialData;
  const [currentStep, setCurrentStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [state, setState] = useState<WizardState>(() => ({
    _id: initialData?._id || "",
    name: initialData?.name || "",
    description: initialData?.description || "",
    policyDomain: initialData?.policyDomain || "economic",
    subCategory: initialData?.subCategory || "",
    allowedScope: initialData?.allowedScope || "both",
    effectTargets: initialData?.effectTargets || [],
    demographicTargeting: initialData?.demographicTargeting || [],
    policyOptions: initialData?.policyOptions || [],
    positions: initialData?.positions || [],
    budgetCost: initialData?.budgetCost || 0,
    budgetCategory: initialData?.budgetCategory || "",
    isPermanent: initialData?.isPermanent || false,
  }));

  const updateField = <K extends keyof WizardState>(field: K, value: WizardState[K]) => {
    setState((prev) => ({ ...prev, [field]: value }));
  };

  const canProceed = (step: number): boolean => {
    switch (step) {
      case 1:
        return !!(state._id && state.name && state.policyDomain);
      case 2:
        return true; // Effects are optional (narrative-only laws)
      case 3:
        return true; // Demographics are optional
      case 4:
        return state.policyOptions.length >= 3;
      case 5:
        return true;
      default:
        return false;
    }
  };

  const handleSave = async () => {
    setError("");
    setSaving(true);

    try {
      const url = isEditing ? `/api/admin/law-types/${state._id}` : "/api/admin/law-types";
      const method = isEditing ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(state),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to save");
        return;
      }

      onClose(true);
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">
          {isEditing ? `Edit: ${initialData.name}` : "Create New Law Type"}
        </h2>
        <button
          onClick={() => onClose(false)}
          className="text-muted hover:text-foreground transition-colors"
        >
          Cancel
        </button>
      </div>

      {/* Step Indicator */}
      <div className="flex gap-1">
        {STEPS.map((step) => (
          <button
            key={step.id}
            onClick={() => setCurrentStep(step.id)}
            disabled={step.id > currentStep && !canProceed(step.id - 1)}
            className={`flex-1 py-2 text-xs font-medium rounded-lg transition-colors ${
              currentStep === step.id
                ? "bg-primary/20 text-primary"
                : step.id < currentStep
                  ? "bg-green-500/20 text-green-400"
                  : "bg-card text-muted"
            }`}
          >
            {step.id}. {step.name}
          </button>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Step Content */}
      <div className="rounded-xl border border-card-border bg-card p-6">
        {currentStep === 1 && (
          <Step1BasicInfo
            state={state}
            updateField={updateField}
            isEditing={isEditing}
            policyDomains={POLICY_DOMAINS}
          />
        )}
        {currentStep === 2 && (
          <Step2MetricEffects
            effectTargets={state.effectTargets}
            onChange={(effects: LegislationEffectTargetV2[]) =>
              updateField("effectTargets", effects)
            }
          />
        )}
        {currentStep === 3 && (
          <Step3Demographics
            targeting={state.demographicTargeting}
            onChange={(targeting: DemographicTargeting[]) =>
              updateField("demographicTargeting", targeting)
            }
          />
        )}
        {currentStep === 4 && (
          <Step4PolicyOptions
            options={state.policyOptions}
            typeId={state._id}
            onChange={(options: LegislationPolicyOption[]) => updateField("policyOptions", options)}
          />
        )}
        {currentStep === 5 && (
          <Step5Committee
            positions={state.positions}
            policyDomain={state.policyDomain}
            onChange={(positions: WizardState["positions"]) => updateField("positions", positions)}
          />
        )}
      </div>

      {/* Navigation */}
      <div className="flex justify-between">
        <button
          onClick={() => setCurrentStep((s) => Math.max(1, s - 1))}
          disabled={currentStep === 1}
          className="rounded-lg border border-card-border bg-card px-4 py-2 text-sm font-medium text-muted hover:text-foreground transition-colors disabled:opacity-50"
        >
          Back
        </button>

        {currentStep < 5 ? (
          <button
            onClick={() => setCurrentStep((s) => s + 1)}
            disabled={!canProceed(currentStep)}
            className="rounded-lg border border-primary/40 bg-primary/10 px-4 py-2 text-sm font-medium text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
          >
            Continue
          </button>
        ) : (
          <button
            onClick={handleSave}
            disabled={saving || !canProceed(4)}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {saving ? "Saving..." : isEditing ? "Save Changes" : "Create Law Type"}
          </button>
        )}
      </div>
    </div>
  );
}
