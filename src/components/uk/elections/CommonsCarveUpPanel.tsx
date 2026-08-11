/**
 * UK Commons demographic carve-up — CarveUpPanel patterns with British copy.
 * Shows which voter groups are in play for a Commons race in a region.
 */
"use client";

import { CarveUpPanel, type CarveUpSlice } from "@/components/elections/primary/CarveUpPanel";

export function CommonsCarveUpPanel({
  regionName,
  regionId,
  slices,
  topDemographics,
  registrationBase,
}: {
  regionName: string;
  regionId: string;
  slices: CarveUpSlice[];
  topDemographics?: string[];
  registrationBase?: string;
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted leading-snug px-0.5">
        Commons carve-up for {regionName}: how candidates split the regional electorate by archetype
        and demographic affinity — not a US primary wave map.
      </p>
      <CarveUpPanel
        stateName={regionName}
        stateId={regionId}
        slices={slices}
        topDemographics={topDemographics}
        registrationBase={registrationBase}
      />
    </div>
  );
}
