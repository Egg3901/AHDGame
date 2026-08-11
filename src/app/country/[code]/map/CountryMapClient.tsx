"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { getCountryConfig, type CountryId } from "@/lib/constants/countries";
import type { MapOverviewResponse } from "@/lib/map/overviewTypes";
import { regionUrl } from "@/lib/urls";
import { USMapWithModes } from "./components/USMapWithModes";
import { UnifiedMapWithModes } from "./components/UnifiedMapWithModes";
import { EconOnlyMapPlaceholder } from "./components/EconOnlyMapPlaceholder";
import {
  COUNTRY_MAP_CONFIGS,
  isParliamentaryMapCountry,
  type CountryMapConfig,
} from "./components/countryMapConfigs";

interface CountryMapClientProps {
  countryId: CountryId;
}

/**
 * Dispatches map rendering by country:
 *   - US uses USMapWithModes (electoral-college math, presidential results
 *     panel, senate split-view; out-of-pattern relative to parliamentary maps).
 *   - UK/DE/JP/CN/BR/NG share UnifiedMapWithModes driven by COUNTRY_MAP_CONFIGS.
 *   - Anything else falls through to EconOnlyMapPlaceholder.
 *
 * The US-specific renderer is keyed in CUSTOM_MAP_RENDERERS (a Record keyed
 * by CountryId rather than a raw string-literal comparison) to satisfy the
 * no-country-literals lint rule.
 */
const CUSTOM_MAP_RENDERERS: Partial<
  Record<
    CountryId,
    (props: {
      mapData: MapOverviewResponse | null;
      config: ReturnType<typeof getCountryConfig>;
      onRegionClick: (id: string) => void;
    }) => React.ReactNode
  >
> = {
  US: (props) => <USMapWithModes {...props} />,
};

export default function CountryMapClient({ countryId }: CountryMapClientProps) {
  const router = useRouter();
  const config = getCountryConfig(countryId);
  const [mapData, setMapData] = useState<MapOverviewResponse | null>(null);

  useEffect(() => {
    fetch(`/api/map/overview?countryId=${countryId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then(setMapData)
      .catch(() => setMapData(null));
  }, [countryId]);

  const onRegionClick = (id: string) => router.push(regionUrl(countryId, id));

  // Resolve the parliamentary config once per country. The region set is no
  // longer preset-derived here — each map renders its live owned roster
  // (`mapData.regions`), so DE shows West Germany's Länder in the 1979 era purely
  // from ownership, with no era branch in this dispatcher.
  const parliamentaryConfig = useMemo<CountryMapConfig | null>(() => {
    return isParliamentaryMapCountry(countryId) ? COUNTRY_MAP_CONFIGS[countryId] : null;
  }, [countryId]);

  const customRenderer = CUSTOM_MAP_RENDERERS[countryId];
  if (customRenderer) {
    return customRenderer({ mapData, config, onRegionClick });
  }

  if (parliamentaryConfig) {
    return (
      <UnifiedMapWithModes
        mapData={mapData}
        config={config}
        countryConfig={parliamentaryConfig}
        onRegionClick={onRegionClick}
      />
    );
  }

  return (
    <EconOnlyMapPlaceholder
      countryId={countryId}
      config={config}
      mapData={mapData}
      onRegionClick={onRegionClick}
    />
  );
}
