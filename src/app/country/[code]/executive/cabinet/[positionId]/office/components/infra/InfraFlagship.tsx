"use client";

import { useState } from "react";
import type { ProjectView, InfraSummaryView } from "../../useCabinetOffice";
import { PipelineTab } from "./PipelineTab";
import { InfraBudgetTab } from "./InfraBudgetTab";

type SubTab = "pipeline" | "budget";
const SUB_TABS: Array<{ id: SubTab; label: string }> = [
  { id: "pipeline", label: "Pipeline" },
  { id: "budget", label: "Budget" },
];

export function InfraFlagship({
  countryCode,
  positionId,
  projects,
  infraSummary,
  canAct,
  currencySymbol,
  regions,
  onUpdate,
}: {
  countryCode: string;
  positionId: string;
  projects: ProjectView[];
  infraSummary: InfraSummaryView;
  canAct: boolean;
  currencySymbol: string;
  regions: Array<{ id: string; name: string }>;
  onUpdate: () => void;
}) {
  const [tab, setTab] = useState<SubTab>("pipeline");
  const siteName: Record<string, string> = Object.fromEntries(regions.map((r) => [r.id, r.name]));

  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-lg border border-card-border bg-card p-0.5">
        {SUB_TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`rounded-md px-3 py-1.5 text-[12px] font-semibold ${
              tab === t.id
                ? "bg-[color-mix(in_srgb,var(--gov)_20%,transparent)] text-gov-soft"
                : "text-muted hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "pipeline" && (
        <PipelineTab
          countryCode={countryCode}
          positionId={positionId}
          projects={projects}
          canAct={canAct}
          currencySymbol={currencySymbol}
          regions={regions}
          siteName={siteName}
          committedSpend={infraSummary.committedSpend}
          onUpdate={onUpdate}
        />
      )}
      {tab === "budget" && (
        <InfraBudgetTab
          infraSummary={infraSummary}
          currencySymbol={currencySymbol}
          siteName={siteName}
        />
      )}
    </div>
  );
}
