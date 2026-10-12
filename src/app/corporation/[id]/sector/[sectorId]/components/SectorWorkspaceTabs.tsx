"use client";

import { BarChart3, BriefcaseBusiness, Factory, Settings2, UsersRound } from "lucide-react";

export type WorkspaceTab = "overview" | "operations" | "market" | "people" | "management";

export default function SectorWorkspaceTabs({
  activeTab,
  onChange,
  isCeo,
  labourEnabled,
}: {
  activeTab: WorkspaceTab;
  onChange: (tab: WorkspaceTab) => void;
  isCeo: boolean;
  labourEnabled: boolean;
}) {
  return (
    <div className="flex gap-1 overflow-x-auto" role="tablist" aria-label="Sector workspace">
      {(
        [
          ["overview", "Overview", BarChart3],
          ["operations", "Operations", Factory],
          ["market", "Market & supply", BriefcaseBusiness],
          ...(labourEnabled ? [["people", "People", UsersRound]] : []),
          ...(isCeo ? [["management", "Manage", Settings2]] : []),
        ] as [WorkspaceTab, string, typeof BarChart3][]
      ).map(([id, label, Icon]) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={activeTab === id}
          onClick={() => onChange(id)}
          className={`inline-flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
            activeTab === id
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted hover:bg-card-elevated hover:text-foreground"
          }`}
        >
          <Icon className="h-4 w-4" />
          {label}
        </button>
      ))}
    </div>
  );
}
