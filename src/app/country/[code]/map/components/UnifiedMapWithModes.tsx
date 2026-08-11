"use client";

import { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import BackButton from "@/components/BackButton";
import { SectionLabel } from "@/components/ui";
import { getCountryConfig, getCountryDisplayName } from "@/lib/constants/countries";
import { useActivePreset } from "@/contexts/RegisteredCountriesContext";
import { EXTRACTABLE_RESOURCES, COMMODITY_LABELS } from "@/lib/constants/commodities";
import type { ExtractableResource } from "@/lib/constants/commodities";
import type { MapOverviewResponse } from "@/lib/map/overviewTypes";
import { regionUrl } from "@/lib/urls";
import { fetchJson } from "@/lib/observability/fetchJson";
import { type LeanAxis } from "./mapShared";
import { useResourceMapData } from "./useResourceMapData";
import type { CountryMapConfig, MapGameTime } from "./countryMapConfigs";

interface UnifiedMapWithModesProps {
  mapData: MapOverviewResponse | null;
  config: ReturnType<typeof getCountryConfig>;
  countryConfig: CountryMapConfig;
  onRegionClick: (id: string) => void;
}

export function UnifiedMapWithModes({
  mapData,
  config,
  countryConfig,
  onRegionClick,
}: UnifiedMapWithModesProps) {
  const preset = useActivePreset();
  // Era-aware display name (e.g. "West Germany Map" in 1979).
  const displayName = getCountryDisplayName(countryConfig.countryId, preset);
  const [mode, setMode] = useState<string>(countryConfig.defaultMode);
  const [leanAxis, setLeanAxis] = useState<LeanAxis>("display");
  const [resourceType, setResourceType] = useState<ExtractableResource>("oil");
  const [resourceToggle, setResourceToggle] = useState<
    "capacity" | "contractedPct" | "openAccessPct"
  >("capacity");
  const [gameTime, setGameTime] = useState<MapGameTime | undefined>(undefined);

  // Fetch current game time so country renderers can swap era-specific assets
  // (e.g. CN's pre-handover map omits HK/Macau). Endpoint is edge-cached so
  // this is cheap per page navigation.
  useEffect(() => {
    let cancelled = false;
    fetchJson<{ currentTurn?: number; startingYear?: number; preIterationTurns?: number }>(
      "/api/game/turn/status",
      {
        feature: "country-map-turn-status",
      }
    )
      .then((data) => {
        if (cancelled || !data) return;
        setGameTime({
          currentTurn: data.currentTurn,
          startingYear: data.startingYear,
          preIterationTurns: data.preIterationTurns,
        });
      })
      .catch(() => {
        // Network failure: leave gameTime undefined; renderers fall back to modern assets.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const resourceData = useResourceMapData(mode, config.id, resourceType);

  const regionData = useMemo(
    () =>
      countryConfig.buildRegionData({
        mode,
        mapData,
        leanAxis,
        resourceData,
        resourceToggle,
      }),
    [countryConfig, mode, mapData, leanAxis, resourceData, resourceToggle]
  );

  const modeConfig = countryConfig.modes.find((m) => m.id === mode);
  const mapMaxWidth = countryConfig.mapMaxWidth ?? "340px";
  const mapMinHeight = countryConfig.mapMinHeight ?? "280px";

  // Every parliamentary map renders the LIVE region roster — the regions whose
  // `states.countryId` is this country right now. That set is `mapData.regions`
  // (the owned, preset-correct roster the overview returns), so a split or a
  // transfer follows its owner. This generalizes the former UK-only path to all
  // five maps. While the overview is still loading, or if a country's state
  // `_id`s don't intersect this map's region codes, fall back to the config's
  // static roster so the map and list never render empty.
  const rosterIds: string[] | null =
    mapData?.regions && mapData.regions.length > 0 ? mapData.regions.map((r) => r.id) : null;
  const liveRegions = rosterIds
    ? countryConfig.regions.filter((r) => rosterIds.includes(r.id))
    : null;
  const useLive = liveRegions !== null && liveRegions.length > 0;
  const regionsShown = useLive ? liveRegions! : countryConfig.regions;
  const liveRoster: string[] | null = useLive ? regionsShown.map((r) => r.id) : null;
  // Maps that can recompute their subtitle from the shown set (DE: era-split, so
  // 1979 reads "11 Länder") provide `formatSubtitle` and use it. The rest keep
  // the static, canonical-total `headerSubtitle` — a region-summed UK figure
  // (652) would drift from the nation-sourced 650, so UK opts out until the
  // territory-transfer mechanic generalizes live seat totals.
  const subtitle = countryConfig.formatSubtitle
    ? countryConfig.formatSubtitle(regionsShown)
    : countryConfig.headerSubtitle;

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-10 lg:px-12">
        <div className="mb-4 sm:mb-6 flex items-center gap-3">
          <BackButton iconOnly />
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight truncate">
              {displayName} Map
            </h1>
            <p className="mt-0.5 text-xs sm:text-sm text-muted">{subtitle}</p>
          </div>
        </div>

        <div className="mb-4 sm:mb-6 overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
          <div className="flex gap-2 min-w-max sm:flex-wrap sm:min-w-0 pb-1">
            {countryConfig.modes.map((m) => (
              <button
                key={m.id}
                onClick={() => setMode(m.id)}
                className={`shrink-0 rounded-lg border px-3 py-1.5 sm:px-4 sm:py-2 text-xs sm:text-sm font-medium transition-colors ${
                  mode === m.id
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-card-border bg-card text-muted hover:border-primary/50 hover:text-foreground"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
          {mode === "lean" && (
            <div className="mt-2 flex gap-2">
              {(["display", "economic", "social"] as const).map((ax) => (
                <button
                  key={ax}
                  onClick={() => setLeanAxis(ax)}
                  className={`rounded border px-2 py-1 text-xs font-medium transition-colors ${
                    leanAxis === ax
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-card-border bg-card text-muted hover:text-foreground"
                  }`}
                >
                  {ax === "display" ? "Combined" : ax === "economic" ? "Economic" : "Social"}
                </button>
              ))}
            </div>
          )}
          {mode === "resources" && (
            <div className="mt-3 flex flex-wrap gap-3">
              <div className="flex flex-wrap gap-1">
                {EXTRACTABLE_RESOURCES.map((r) => (
                  <button
                    key={r}
                    onClick={() => setResourceType(r)}
                    className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
                      resourceType === r
                        ? "bg-primary text-white"
                        : "bg-card-elevated text-muted hover:text-foreground"
                    }`}
                  >
                    {COMMODITY_LABELS[r]}
                  </button>
                ))}
              </div>
              <div className="flex gap-1">
                {(["capacity", "contractedPct", "openAccessPct"] as const).map((tog) => (
                  <button
                    key={tog}
                    onClick={() => setResourceToggle(tog)}
                    className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
                      resourceToggle === tog
                        ? "bg-primary text-white"
                        : "bg-card-elevated text-muted hover:text-foreground"
                    }`}
                  >
                    {tog === "capacity"
                      ? "Capacity"
                      : tog === "contractedPct"
                        ? "Contracted %"
                        : "Open-access %"}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="grid gap-4 sm:gap-6 lg:grid-cols-3">
          <div className="rounded-xl border border-card-border bg-card p-4 sm:p-6 flex flex-col items-center gap-4">
            <SectionLabel className="mb-4">Interactive Map</SectionLabel>
            <p className="text-xs text-muted -mt-2 mb-1">{modeConfig?.description}</p>
            <div
              className="w-full mx-auto"
              style={{
                maxWidth: `min(100%, ${mapMaxWidth})`,
                minHeight: mapMinHeight,
                aspectRatio: countryConfig.aspectRatio,
              }}
            >
              {countryConfig.renderPaths({
                regionData,
                onRegionClick,
                gameTime,
                regionCodes: liveRoster ?? undefined,
              })}
            </div>
          </div>

          <div className="lg:col-span-2 rounded-xl border border-card-border bg-card p-6">
            <SectionLabel className="mb-4">{countryConfig.regionListHeading}</SectionLabel>
            <div className="space-y-1">
              {regionsShown.map((region) => {
                const d = regionData[region.id];
                return (
                  <Link
                    key={region.id}
                    href={regionUrl(countryConfig.countryId, region.id)}
                    className="flex items-center gap-3 rounded-lg px-3 py-2.5 -mx-1 transition-colors hover:bg-card-elevated/50 group"
                  >
                    <span
                      className="h-3 w-3 shrink-0 rounded-sm"
                      style={{ backgroundColor: d?.color ?? "#334155" }}
                    />
                    <div className="flex-1">
                      <div className="text-sm font-medium text-foreground group-hover:text-primary transition-colors">
                        {region.name}
                      </div>
                      <div className="text-[10px] text-muted">{d?.label ?? region.name}</div>
                    </div>
                    <span className="text-sm text-muted">{region.secondaryLabel}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3 pt-4 border-t border-card-border/40">
          <Link
            href={config.overviewPath}
            className="rounded-lg border border-card-border bg-card px-4 py-2 text-sm font-medium text-muted hover:text-foreground transition-colors"
          >
            ← {displayName} Overview
          </Link>
        </div>
      </main>
    </div>
  );
}
