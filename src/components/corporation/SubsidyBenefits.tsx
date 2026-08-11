"use client";

import { useState, useEffect } from "react";
import { getCountryConfig } from "@/lib/constants/countries";
import type { CountryId } from "@/lib/constants/countries";
import { CORPORATION_TYPE_LABELS } from "@/lib/constants/corporations";
import type { CorporationType } from "@/lib/constants/corporations";
import type { SectorDetail } from "./CorporationPageTypes";

interface SubsidyEntry {
  id: string;
  scope: "national" | "state";
  stateId: string | null;
  scopeType: "economy_wide" | "sector";
  targetSectorType: string | null;
  targetStrategyId: string | null;
  domesticOnly: boolean;
  countryId: string;
}

interface SubsidyBenefitsProps {
  /** The corporation's HQ state (used for domestic-only checks) */
  corpHqState: string;
  /** Country ID for the corporation's HQ */
  corpHqCountryId: string;
  /** All sectors belonging to this corporation */
  sectors: SectorDetail[];
}

const SCOPE_LABELS: Record<string, string> = {
  economy_wide: "Economy-wide",
  sector: "Sector",
};

/** Returns true if the subsidy applies to at least one sector of this corp. */
function subsidyAppliesToCorp(
  subsidy: SubsidyEntry,
  corpHqState: string,
  corpHqCountryId: string,
  sectors: SectorDetail[]
): boolean {
  return sectors.some((sector) => {
    const sectorCountryId = sector.countryId ?? corpHqCountryId;

    // Subsidy must be in the same country as the sector
    if (sectorCountryId !== subsidy.countryId) return false;

    // State-scoped: sector must be in the same state
    if (subsidy.scope === "state" && subsidy.stateId && subsidy.stateId !== sector.stateId) {
      return false;
    }

    // Sector-type filter
    if (subsidy.scopeType === "sector" && subsidy.targetSectorType) {
      if (subsidy.targetSectorType !== sector.sectorType) return false;
    }

    // Strategy filter
    if (subsidy.targetStrategyId) {
      const sectorStrategy = sector.strategyId ?? "standard";
      if (sectorStrategy !== subsidy.targetStrategyId) return false;
    }

    // Domestic-only: for national scope, HQ country must match; for state scope, HQ state must match
    if (subsidy.domesticOnly) {
      if (subsidy.scope === "national" && corpHqCountryId !== subsidy.countryId) return false;
      if (subsidy.scope === "state" && corpHqState !== subsidy.stateId) return false;
    }

    return true;
  });
}

export function SubsidyBenefits({ corpHqState, corpHqCountryId, sectors }: SubsidyBenefitsProps) {
  const [subsidies, setSubsidies] = useState<SubsidyEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const operatingCountries = [...new Set(sectors.map((s) => s.countryId ?? corpHqCountryId))];
  const operatingCountriesKey = operatingCountries.join(",");

  useEffect(() => {
    if (operatingCountries.length === 0) {
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    fetch(`/api/subsidies?countryIds=${encodeURIComponent(operatingCountriesKey)}`, {
      signal: controller.signal,
    })
      .then((r) => (r.ok ? r.json() : { subsidies: [] }))
      .then((d) => {
        setSubsidies((d.subsidies ?? []) as SubsidyEntry[]);
        setLoading(false);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        setLoading(false);
      });
    return () => controller.abort();
    // operatingCountriesKey is a stable derived string from operatingCountries
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [corpHqState, operatingCountriesKey]);

  const applicableSubsidies = subsidies.filter((s) =>
    subsidyAppliesToCorp(s, corpHqState, corpHqCountryId, sectors)
  );

  if (loading) {
    return <div className="h-16 rounded-lg bg-card/60 animate-pulse" />;
  }

  if (applicableSubsidies.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card/60 p-4 text-sm text-muted-foreground">
        No active subsidies benefiting this corporation.
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {applicableSubsidies.map((s) => (
        <div
          key={s.id}
          className="flex items-center justify-between rounded-md border border-border bg-card/40 px-3 py-2"
        >
          <span className="text-xs text-muted-foreground">
            {getCountryConfig(s.countryId as CountryId).name}
            {" — "}
            {s.scope === "state" && s.stateId ? `${s.stateId} — ` : ""}
            {SCOPE_LABELS[s.scopeType] ?? s.scopeType}
            {s.targetSectorType
              ? ` — ${CORPORATION_TYPE_LABELS[s.targetSectorType as CorporationType] ?? s.targetSectorType}`
              : ""}
            {s.targetStrategyId ? ` (${s.targetStrategyId})` : ""}
            {s.domesticOnly ? " · domestic only" : ""}
          </span>
          <span className="text-sm font-semibold text-emerald-400">+7.5% margin</span>
        </div>
      ))}
    </div>
  );
}
