"use client";

export type PoliticalOperationsTab = "overview" | "stateElection" | "presidentialElection";

interface Props {
  activeTab: PoliticalOperationsTab;
  onChange: (tab: PoliticalOperationsTab) => void;
}

export function PoliticalOperationsTabs({ activeTab, onChange }: Props) {
  const tabs: Array<{ id: PoliticalOperationsTab; label: string; disabled: boolean }> = [
    { id: "overview", label: "Overview", disabled: false },
    { id: "stateElection", label: "State Election", disabled: true },
    { id: "presidentialElection", label: "Presidential Election", disabled: false },
  ];

  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-card-border" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={activeTab === t.id}
          disabled={t.disabled}
          onClick={() => !t.disabled && onChange(t.id)}
          className={`shrink-0 whitespace-nowrap px-4 py-2 text-sm font-medium transition-colors ${
            t.disabled
              ? "cursor-not-allowed text-muted/50"
              : activeTab === t.id
                ? "border-b-2 border-primary text-primary"
                : "text-muted hover:text-foreground"
          }`}
          title={t.disabled ? "Available in a future update" : undefined}
        >
          {t.label}
        </button>
      ))}
    </nav>
  );
}
