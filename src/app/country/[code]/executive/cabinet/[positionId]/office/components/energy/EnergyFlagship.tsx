"use client";

import { useState } from "react";
import type { PlantView, EnergySummaryView } from "../../useCabinetOffice";
import { MixTab } from "./MixTab";
import { PlantsTab } from "./PlantsTab";

type SubTab = "mix" | "plants";
const SUB_TABS: Array<{ id: SubTab; label: string }> = [
  { id: "mix", label: "Mix" },
  { id: "plants", label: "Plants" },
];

export function EnergyFlagship({
  countryCode,
  positionId,
  plants,
  energySummary,
  canAct,
  currencySymbol,
  regions,
  onUpdate,
}: {
  countryCode: string;
  positionId: string;
  plants: PlantView[];
  energySummary: EnergySummaryView;
  canAct: boolean;
  currencySymbol: string;
  regions: Array<{ id: string; name: string }>;
  onUpdate: () => void;
}) {
  const [tab, setTab] = useState<SubTab>("mix");
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

      {tab === "mix" && <MixTab energySummary={energySummary} siteName={siteName} />}
      {tab === "plants" && (
        <PlantsTab
          countryCode={countryCode}
          positionId={positionId}
          plants={plants}
          canAct={canAct}
          currencySymbol={currencySymbol}
          regions={regions}
          siteName={siteName}
          onUpdate={onUpdate}
        />
      )}
    </div>
  );
}
