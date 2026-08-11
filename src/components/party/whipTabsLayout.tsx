"use client";

import { useMemo, useState, type ReactNode } from "react";
import { getCountryConfig, type CountryId } from "@/lib/constants/countries";
import { useRuntimeCountryConfig } from "@/hooks/useRuntimeCountryConfig";

export type WhipSubTarget = "bills" | "leadership" | "cabinet";

export interface WhipTabsLayoutProps {
  countryId: string;
  isNational: boolean;
  includeSubNationalChamber?: boolean;
  /** Render bill content for the given chamber key. */
  renderBills: (chamberKey: string) => ReactNode;
  renderLeadership: () => ReactNode;
  renderCabinet?: () => ReactNode;
  preferredBillChamberKey?: string;
}

/**
 * Shared Bills/Leadership/Cabinet sub-sub-tab shell used by both
 * PlayerWhipPanel and NppWhipPanel. Chamber chips appear only under Bills
 * and are derived from country config per the spec's country-chamber table.
 */
export function WhipTabsLayout({
  countryId,
  isNational,
  includeSubNationalChamber = true,
  renderBills,
  renderLeadership,
  renderCabinet,
  preferredBillChamberKey,
}: WhipTabsLayoutProps) {
  const config = getCountryConfig(countryId.toUpperCase() as CountryId);
  const { config: runtime } = useRuntimeCountryConfig(countryId);

  const chamberChips = useMemo(() => {
    const chips: Array<{ key: string; label: string }> = [];
    if (config.upperElectionSystem && config.legislature.upperChamber) {
      chips.push({
        key: config.legislature.upperChamber.key,
        label: config.legislature.upperChamber.shortName,
      });
    }
    chips.push({
      key: config.legislature.lowerChamber.key,
      label: config.legislature.lowerChamber.shortName,
    });
    if (includeSubNationalChamber && config.subNationalChamber) {
      chips.push({
        key: isNational ? "stateLegislature" : config.subNationalChamber.key,
        label: config.subNationalChamber.shortName,
      });
    }
    return chips;
  }, [config, includeSubNationalChamber, isNational]);

  // Runtime governmentType so a post-Stage-4 conversion shows/hides the
  // Cabinet tab accordingly (Cabinet appointments exist for presidential
  // systems). Falls back to seed config while the fetch loads — same
  // value pre-conversion, so no visible flash for unconverted countries.
  const runtimeGovType = runtime?.governmentType ?? config.governmentType;
  const showCabinet = runtimeGovType === "presidential" && renderCabinet !== undefined;

  const [subTarget, setSubTarget] = useState<WhipSubTarget>("bills");
  const [userSelectedChamberKey, setUserSelectedChamberKey] = useState<string | null>(null);
  const chamberKey =
    userSelectedChamberKey ?? preferredBillChamberKey ?? chamberChips[0]?.key ?? "house";

  const targets: Array<{ key: WhipSubTarget; label: string; show: boolean }> = [
    { key: "bills", label: "Bills", show: true },
    { key: "leadership", label: "Leadership", show: true },
    { key: "cabinet", label: "Cabinet", show: showCabinet },
  ];

  return (
    <div className="space-y-4">
      <div
        role="tablist"
        className="flex gap-1 p-1 rounded-lg bg-background border border-card-border w-fit"
      >
        {targets
          .filter((t) => t.show)
          .map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={subTarget === t.key}
              onClick={() => setSubTarget(t.key)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${
                subTarget === t.key
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted hover:text-foreground"
              }`}
            >
              {t.label}
            </button>
          ))}
      </div>

      {subTarget === "bills" && (
        <>
          <div className="flex gap-2 flex-wrap">
            {chamberChips.map((c) => (
              <button
                key={c.key}
                onClick={() => setUserSelectedChamberKey(c.key)}
                className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                  chamberKey === c.key
                    ? "bg-primary/20 border-primary text-primary"
                    : "bg-card border-card-border text-muted hover:text-foreground"
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
          {renderBills(chamberKey)}
        </>
      )}

      {subTarget === "leadership" && renderLeadership()}
      {subTarget === "cabinet" && showCabinet && renderCabinet!()}
    </div>
  );
}
