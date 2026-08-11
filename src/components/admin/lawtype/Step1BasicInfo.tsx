"use client";

import type { WizardState } from "./types";

interface Step1BasicInfoProps {
  state: WizardState;
  updateField: <K extends keyof WizardState>(field: K, value: WizardState[K]) => void;
  isEditing: boolean;
  policyDomains: string[];
}

export function Step1BasicInfo({
  state,
  updateField,
  isEditing,
  policyDomains,
}: Step1BasicInfoProps) {
  return (
    <div className="space-y-4">
      <h3 className="font-medium">Basic Information</h3>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-sm font-medium mb-1">
            ID <span className="text-red-400">*</span>
          </label>
          <input
            type="text"
            value={state._id}
            onChange={(e) =>
              updateField("_id", e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"))
            }
            disabled={isEditing}
            placeholder="us_federal_education_funding"
            className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm disabled:opacity-50"
          />
          <p className="text-[10px] text-muted mt-1">
            snake_case, cannot be changed after creation
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">
            Name <span className="text-red-400">*</span>
          </label>
          <input
            type="text"
            value={state.name}
            onChange={(e) => updateField("name", e.target.value)}
            placeholder="Federal Education Funding"
            className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Description</label>
        <textarea
          value={state.description}
          onChange={(e) => updateField("description", e.target.value)}
          placeholder="Bills affecting federal K-12 and higher education spending"
          rows={2}
          className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-sm font-medium mb-1">
            Policy Domain <span className="text-red-400">*</span>
          </label>
          <select
            value={state.policyDomain}
            onChange={(e) => updateField("policyDomain", e.target.value)}
            className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm capitalize"
          >
            {policyDomains.map((d) => (
              <option key={d} value={d} className="capitalize">
                {d}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Sub-Category</label>
          <input
            type="text"
            value={state.subCategory}
            onChange={(e) => updateField("subCategory", e.target.value)}
            placeholder="Federal funding"
            className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium mb-2">Allowed Scope</label>
        <div className="space-y-2">
          {[
            {
              value: "national" as const,
              label: "National Only",
              desc: "Congress only. Effect: 1/50th per state.",
            },
            {
              value: "state" as const,
              label: "State Only",
              desc: "State legislatures only. Effect: 100% to passing state.",
            },
            {
              value: "both" as const,
              label: "National & State",
              desc: "Can be proposed at either level.",
            },
          ].map((opt) => (
            <label key={opt.value} className="flex items-start gap-3 cursor-pointer">
              <input
                type="radio"
                name="allowedScope"
                value={opt.value}
                checked={state.allowedScope === opt.value}
                onChange={() => updateField("allowedScope", opt.value)}
                className="mt-1"
              />
              <div>
                <span className="text-sm font-medium">{opt.label}</span>
                <p className="text-[10px] text-muted">{opt.desc}</p>
              </div>
            </label>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Budget Cost (%)</label>
        <div className="flex items-center gap-3">
          <input
            type="number"
            min={0}
            max={100}
            step={0.1}
            value={state.budgetCost}
            onChange={(e) => updateField("budgetCost", parseFloat(e.target.value) || 0)}
            placeholder="0"
            className="w-32 rounded-lg border border-card-border bg-background px-3 py-2 text-sm"
          />
          <span className="text-sm text-muted">%</span>
        </div>
        <p className="text-[10px] text-yellow-400/80 mt-1">
          Budgets not yet implemented. This value is stored but has no effect.
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Budget Category</label>
        <select
          value={state.budgetCategory}
          onChange={(e) => updateField("budgetCategory", e.target.value)}
          className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm"
        >
          <option value="">Select category...</option>
          <option value="healthcare">Healthcare</option>
          <option value="education">Education</option>
          <option value="defense">Defense</option>
          <option value="infrastructure">Infrastructure</option>
          <option value="socialSecurity">Social Security</option>
          <option value="transportation">Transportation</option>
          <option value="publicSafety">Public Safety</option>
          <option value="environment">Environment</option>
          <option value="other">Other</option>
        </select>
        <p className="text-[10px] text-muted mt-1">
          Which spending category this legislation falls under.
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium mb-2">Persistence</label>
        <div className="space-y-2">
          {[
            {
              value: false,
              label: "This Iteration",
              desc: "Will be deleted on game reset. Good for testing.",
              color: "yellow",
            },
            {
              value: true,
              label: "Permanent",
              desc: "Saved to seed file. Will persist after game resets.",
              color: "green",
            },
          ].map((opt) => (
            <label
              key={String(opt.value)}
              className={`flex items-start gap-3 cursor-pointer rounded-lg border p-3 transition-colors ${
                state.isPermanent === opt.value
                  ? opt.color === "green"
                    ? "border-green-500/40 bg-green-500/10"
                    : "border-yellow-500/40 bg-yellow-500/10"
                  : "border-card-border bg-background hover:border-card-border/80"
              }`}
            >
              <input
                type="radio"
                name="isPermanent"
                checked={state.isPermanent === opt.value}
                onChange={() => updateField("isPermanent", opt.value)}
                className="mt-1"
              />
              <div>
                <span
                  className={`text-sm font-medium ${
                    state.isPermanent === opt.value
                      ? opt.color === "green"
                        ? "text-green-400"
                        : "text-yellow-400"
                      : ""
                  }`}
                >
                  {opt.label}
                </span>
                <p className="text-[10px] text-muted">{opt.desc}</p>
              </div>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
