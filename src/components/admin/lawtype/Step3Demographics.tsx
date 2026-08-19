"use client";

import type { DemographicTargeting } from "@/lib/db/types";
import { DEMOGRAPHIC_BUCKETS } from "./constants";

interface Step3DemographicsProps {
  targeting: DemographicTargeting[];
  onChange: (targeting: DemographicTargeting[]) => void;
}

export function Step3Demographics({ targeting, onChange }: Step3DemographicsProps) {
  const toggleGroup = (groupId: string) => {
    const existing = targeting.find((t) => t.groupId === groupId);
    if (existing) {
      onChange(targeting.filter((t) => t.groupId !== groupId));
    } else {
      onChange([...targeting, { groupId, weight: "medium", stance: "support" }]);
    }
  };

  const updateWeight = (groupId: string, weight: DemographicTargeting["weight"]) => {
    onChange(targeting.map((t) => (t.groupId === groupId ? { ...t, weight } : t)));
  };

  const updateStance = (groupId: string, stance: DemographicTargeting["stance"]) => {
    onChange(targeting.map((t) => (t.groupId === groupId ? { ...t, stance } : t)));
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-medium">Demographic Targeting</h3>
        <p className="text-xs text-muted mt-1">
          Select which parts of the electorate care most about this law. This amplifies
          appeal/opposition for matching voters. Buckets are listed for every country, so pick the
          ones that exist in the countries this law is for.
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {DEMOGRAPHIC_BUCKETS.map((group) => {
          const selected = targeting.find((t) => t.groupId === group.id);
          return (
            <div
              key={group.id}
              className={`rounded-lg border p-3 transition-colors ${
                selected ? "border-primary/40 bg-primary/5" : "border-card-border bg-background"
              }`}
            >
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!selected}
                  onChange={() => toggleGroup(group.id)}
                />
                <span className="text-sm font-medium">{group.label}</span>
                <span className="text-[10px] text-muted">{group.dim}</span>
              </label>

              {selected && (
                <div className="mt-2 ml-6 space-y-2">
                  <div className="flex gap-3">
                    <span className="text-[10px] text-muted w-14">Stance:</span>
                    <div className="flex gap-3">
                      {(["support", "oppose"] as const).map((s) => (
                        <label
                          key={s}
                          className={`flex items-center gap-1 text-xs cursor-pointer ${
                            selected.stance === s
                              ? s === "support"
                                ? "text-green-400"
                                : "text-red-400"
                              : ""
                          }`}
                        >
                          <input
                            type="radio"
                            name={`stance-${group.id}`}
                            checked={selected.stance === s}
                            onChange={() => updateStance(group.id, s)}
                          />
                          {s === "support" ? "Support" : "Oppose"}
                        </label>
                      ))}
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <span className="text-[10px] text-muted w-14">Weight:</span>
                    <div className="flex gap-3">
                      {(["low", "medium", "high"] as const).map((w) => (
                        <label key={w} className="flex items-center gap-1 text-xs cursor-pointer">
                          <input
                            type="radio"
                            name={`weight-${group.id}`}
                            checked={selected.weight === w}
                            onChange={() => updateWeight(group.id, w)}
                          />
                          {w}
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
