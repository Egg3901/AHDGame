"use client";

import { useWorldFlags } from "@/hooks/useWorldFlags";
import type { ResetMetricCountry } from "@/components/metrics/ResetMetricBoard";
import { RegionRegistryTab } from "./RegionRegistryTab";
import { ResetRegionMetricsTab } from "./ResetRegionMetricsTab";
import { isResetV2Country } from "@/lib/resetVersions/rules";

export function RegionMetricsTab({
  countryId,
  regionId,
  regionName,
}: {
  countryId: string;
  regionId: string;
  regionName: string;
}) {
  const { loaded, failed, resetSystemVersions, resetV2Countries } = useWorldFlags();
  const resetCountry = isResetV2Country(countryId);
  const selectedV2 = loaded && resetSystemVersions.metrics === "v2" && resetCountry;
  const verifiedV2 = selectedV2 && resetV2Countries.includes(countryId);

  if (!loaded && resetCountry) return <p role="status">Loading world settings...</p>;
  if ((failed || (selectedV2 && !verifiedV2)) && resetCountry) {
    return (
      <p role="alert" className="rounded-lg border border-error/40 bg-error/10 p-4 text-error">
        The metrics version for this region could not be verified. Legacy metrics were not loaded.
      </p>
    );
  }
  if (verifiedV2) {
    return (
      <ResetRegionMetricsTab
        key={`${countryId}:${regionId}`}
        countryId={countryId as ResetMetricCountry}
        regionId={regionId}
        regionName={regionName}
      />
    );
  }
  return <RegionRegistryTab countryId={countryId} regionId={regionId} regionName={regionName} />;
}

export default RegionMetricsTab;
