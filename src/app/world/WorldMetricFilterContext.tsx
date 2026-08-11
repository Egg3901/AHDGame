"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { MetricCategoryId } from "@/lib/db/types";
import { fetchJson } from "@/lib/observability/fetchJson";
import type { CountryId } from "@/lib/constants/countries";
import type { MetricFilter } from "./components/GlobeMetricPanel";
import { hasBlocData } from "./worldBlocs";
import { useActivePreset } from "@/contexts/RegisteredCountriesContext";

/** ISO numeric codes used by the world map TopoJSON */
const COUNTRY_ID_TO_ISO: Record<CountryId, string> = {
  US: "840",
  UK: "826",
  DE: "276",
  JP: "392",
  IE: "372",
  BR: "076",
  CN: "156",
  NG: "566",
  HU: "348",
  PL: "616",
  RO: "642",
  YU: "890",
  BG: "100",
  UKR: "804",
  BLR: "112",
  CS: "200",
  BAL: "",
  RU: "810",
  FR: "250",
  IT: "380",
  ES: "724",
  SE: "752",
  TR: "792",
  GR: "300",
  AT: "040",
  FI: "246",
  DD: "278",
  SCO: "826", // shares GB code; not rendered until secession (absent from COUNTRY_ORDER)
  WAL: "826", // shares GB code; not rendered until secession (absent from COUNTRY_ORDER)
};

/** World metrics API response shape (subset used by map + nation cards) */
export interface WorldMetricsData {
  countries: Record<
    string,
    {
      countryId: string;
      name: string;
      hasData: boolean;
      categories: Record<string, Record<string, { value: number; score: number | null }>>;
      categoryScores: Record<string, number | null>;
      overallScore: number | null;
    }
  >;
  availableCategories: MetricCategoryId[];
  availableMetrics: Record<string, string[]>;
}

type WorldMetricFilterContextValue = {
  metricFilter: MetricFilter;
  setMetricFilter: (f: MetricFilter) => void;
  worldMetrics: WorldMetricsData | null;
  partyData: Record<string, { partyName: string; partyColor: string; count: number }>;
  corpsData: { countries: Record<string, { count: number }>; maxCount: number } | null;
  countryIdToIso: (id: CountryId) => string | undefined;
};

const WorldMetricFilterContext = createContext<WorldMetricFilterContextValue | null>(null);

export function WorldMetricFilterProvider({ children }: { children: ReactNode }) {
  // East / West / Non-Aligned is the default view of the world: the first thing
  // a player should read off the globe is who is on whose side.
  //
  // Only where there ARE sides, though. A 2019 world has no blocs, so this used
  // to boot into a mode whose lookup is empty — tier colours under a West/East/
  // Non-Aligned legend, describing something not on the screen. Falls back to
  // the tier view there, which is what that world's default always should have
  // been.
  const preset = useActivePreset();
  const [metricFilter, setMetricFilter] = useState<MetricFilter>(() =>
    hasBlocData(preset) ? { type: "blocs" } : { type: "none" }
  );
  const [worldMetrics, setWorldMetrics] = useState<WorldMetricsData | null>(null);
  const [partyData, setPartyData] = useState<
    Record<string, { partyName: string; partyColor: string; count: number }>
  >({});
  const [corpsData, setCorpsData] = useState<{
    countries: Record<string, { count: number }>;
    maxCount: number;
  } | null>(null);

  useEffect(() => {
    fetchJson<WorldMetricsData>("/api/world/metrics", { feature: "world-metrics" })
      .then((data) => {
        if (data) setWorldMetrics(data);
      })
      .catch(() => {});

    fetchJson<Record<string, { partyName: string; partyColor: string; count: number }>>(
      "/api/world/parties",
      { feature: "world-parties" }
    )
      .then((data) => setPartyData(data))
      .catch(() => {});

    fetchJson<{ countries: Record<string, { count: number }>; maxCount: number }>(
      "/api/world/corps",
      { feature: "world-corps" }
    )
      .then((data) => {
        if (data) setCorpsData(data);
      })
      .catch(() => {});
  }, []);

  const countryIdToIso = useCallback((id: CountryId) => COUNTRY_ID_TO_ISO[id], []);

  const value = useMemo(
    () => ({
      metricFilter,
      setMetricFilter,
      worldMetrics,
      partyData,
      corpsData,
      countryIdToIso,
    }),
    [metricFilter, worldMetrics, partyData, corpsData, countryIdToIso]
  );

  return (
    <WorldMetricFilterContext.Provider value={value}>{children}</WorldMetricFilterContext.Provider>
  );
}

export function useWorldMetricFilter(): WorldMetricFilterContextValue {
  const ctx = useContext(WorldMetricFilterContext);
  if (!ctx) {
    throw new Error("useWorldMetricFilter must be used within WorldMetricFilterProvider");
  }
  return ctx;
}

/** For components that may render outside the world page (e.g. shared cards). */
export function useWorldMetricFilterOptional(): WorldMetricFilterContextValue | null {
  return useContext(WorldMetricFilterContext);
}
