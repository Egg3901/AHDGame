"use client";

import { useState } from "react";
import { isAbroadSited } from "@/lib/constants/cabinetEstates";
import type { EstateView, EstateSummaryView } from "../../useCabinetOffice";
import { EstatesRosterTab } from "./EstatesRosterTab";
import { EstatesBudgetTab } from "./EstatesBudgetTab";

type SubTab = "roster" | "budget";
const SUB_TABS: Array<{ id: SubTab; label: string }> = [
  { id: "roster", label: "Roster" },
  { id: "budget", label: "Budget" },
];

export function EstatesFlagship({
  countryCode,
  positionId,
  portfolioKey,
  estates,
  estateSummary,
  canAct,
  currencySymbol,
  regions,
  targetCountries,
  onUpdate,
}: {
  countryCode: string;
  positionId: string;
  portfolioKey: string;
  estates: EstateView[];
  estateSummary: EstateSummaryView;
  canAct: boolean;
  currencySymbol: string;
  regions: Array<{ id: string; name: string }>;
  targetCountries: Array<{ id: string; label: string }>;
  onUpdate: () => void;
}) {
  const [tab, setTab] = useState<SubTab>("roster");
  const isForeign = isAbroadSited(portfolioKey);
  const sites = isForeign ? targetCountries.map((c) => ({ id: c.id, name: c.label })) : regions;
  const siteName: Record<string, string> = Object.fromEntries(sites.map((s) => [s.id, s.name]));

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

      {tab === "roster" && (
        <EstatesRosterTab
          countryCode={countryCode}
          positionId={positionId}
          portfolioKey={portfolioKey}
          estates={estates}
          canAct={canAct}
          currencySymbol={currencySymbol}
          isForeign={isForeign}
          sites={sites}
          siteName={siteName}
          onUpdate={onUpdate}
        />
      )}
      {tab === "budget" && (
        <EstatesBudgetTab
          estates={estates}
          estateSummary={estateSummary}
          currencySymbol={currencySymbol}
          siteName={siteName}
        />
      )}
    </div>
  );
}
