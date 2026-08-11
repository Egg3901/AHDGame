"use client";

import type { WizardState } from "./types";
import { COMMITTEE_NAMES } from "./constants";

interface Step5CommitteeProps {
  positions: WizardState["positions"];
  policyDomain: string;
  onChange: (positions: WizardState["positions"]) => void;
}

export function Step5Committee({ positions, policyDomain, onChange }: Step5CommitteeProps) {
  // Auto-generate if empty
  if (positions.length === 0) {
    const committeeName = COMMITTEE_NAMES[policyDomain] || "General";
    const defaultPositions: WizardState["positions"] = [
      {
        positionId: "house_chair",
        name: `Chair, House ${committeeName} Committee`,
        chamber: "house",
      },
      {
        positionId: "house_ranking",
        name: `Ranking Member, House ${committeeName} Committee`,
        chamber: "house",
      },
      {
        positionId: "senate_chair",
        name: `Chair, Senate ${committeeName} Committee`,
        chamber: "senate",
      },
      {
        positionId: "senate_ranking",
        name: `Ranking Member, Senate ${committeeName} Committee`,
        chamber: "senate",
      },
    ];
    // Set immediately
    setTimeout(() => onChange(defaultPositions), 0);
  }

  const updatePosition = (index: number, name: string) => {
    const newPositions = [...positions];
    newPositions[index] = { ...newPositions[index], name };
    onChange(newPositions);
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-medium">Committee Positions</h3>
        <p className="text-xs text-muted mt-1">
          Auto-generated based on policy domain. Edit names if needed.
        </p>
      </div>

      <div className="space-y-3">
        {positions.map((pos, index) => (
          <div key={pos.positionId} className="flex items-center gap-3">
            <span className="text-xs text-muted w-24 capitalize">
              {pos.chamber} {pos.positionId.includes("chair") ? "Chair" : "Ranking"}
            </span>
            <input
              type="text"
              value={pos.name}
              onChange={(e) => updatePosition(index, e.target.value)}
              className="flex-1 rounded border border-card-border bg-card px-2 py-1.5 text-sm"
            />
          </div>
        ))}
      </div>
    </div>
  );
}
