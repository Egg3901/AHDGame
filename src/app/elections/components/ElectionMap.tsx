"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { CountryMapPaths } from "@/components/CountryMapPaths";
import { buildLegend, buildRegionMapData, type MapRegionGroup } from "./electionsMapModel";

export interface ElectionMapProps {
  countryId: string;
  /** Already race/competitive filtered, and NOT filtered by selected region. */
  electionsByState: MapRegionGroup[];
  onRegionClick: (regionId: string) => void;
  regionHref?: (regionId: string) => string | undefined;
}

export function ElectionMap({
  countryId,
  electionsByState,
  onRegionClick,
  regionHref,
}: ElectionMapProps) {
  const t = useTranslations("elections");
  const regionData = useMemo(
    () =>
      buildRegionMapData(electionsByState, {
        uncontested: t("map.uncontested"),
        stateSenateShort: t("map.stateSenateShort"),
      }),
    [electionsByState, t]
  );
  const { parties, hasUnpolled } = useMemo(() => buildLegend(electionsByState), [electionsByState]);

  return (
    <div className="space-y-3">
      <CountryMapPaths
        countryId={countryId}
        regionData={regionData}
        onRegionClick={onRegionClick}
        regionHref={regionHref}
        className="rounded-lg overflow-hidden bg-card-elevated/50"
      />

      <div className="flex flex-wrap gap-4 text-xs text-muted">
        {parties.map(({ partyId, name, color }) => (
          <span key={partyId} className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-sm inline-block" style={{ backgroundColor: color }} />
            {name}
          </span>
        ))}
        {hasUnpolled && (
          <span className="flex items-center gap-1.5">
            <span
              className="h-3 w-3 rounded-sm inline-block"
              style={{ backgroundColor: "var(--muted)" }}
            />
            {t("map.noPollingData")}
          </span>
        )}
        <span className="flex items-center gap-1.5 text-yellow-400">{t("map.competitive")}</span>
      </div>
    </div>
  );
}
