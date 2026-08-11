"use client";

import type { EnergySummaryView } from "../../useCabinetOffice";
import { SectionCard } from "../dossier";
import { AggTile, fmtCapacity } from "./energyUi";
import { MixBar } from "./MixBar";

export function MixTab({
  energySummary,
  siteName,
}: {
  energySummary: EnergySummaryView;
  siteName: Record<string, string>;
}) {
  const regionEntries = Object.entries(energySummary.byRegion);

  return (
    <div className="space-y-4">
      <SectionCard title="National generation mix" sub="Capacity-weighted across all plants">
        <MixBar bySource={energySummary.bySource} total={energySummary.totalCapacity} />
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <AggTile
            label="Total capacity"
            value={fmtCapacity(energySummary.totalCapacity)}
            tone="gov"
          />
          <AggTile
            label="Renewable"
            value={`${Math.round(energySummary.renewableShare * 100)}%`}
            ring={Math.round(energySummary.renewableShare * 100)}
          />
          <AggTile label="Firm" value={`${Math.round(energySummary.firmShare * 100)}%`} />
          <AggTile label="Carbon intensity" value={energySummary.carbonIntensity.toFixed(2)} />
        </div>
      </SectionCard>

      <SectionCard title="By region" sub="Each regional grid's generation mix">
        <div className="space-y-3">
          {regionEntries.length === 0 && (
            <div className="text-[12px] text-muted">No plants in service.</div>
          )}
          {regionEntries.map(([regionId, bySource]) => {
            const total = Object.values(bySource).reduce((s, c) => s + c, 0);
            return (
              <div key={regionId}>
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-[12px] font-medium text-foreground">
                    {siteName[regionId] ?? regionId}
                  </span>
                  <span className="tabular text-[11px] text-muted">{fmtCapacity(total)}</span>
                </div>
                <MixBar bySource={bySource} total={total} />
              </div>
            );
          })}
        </div>
      </SectionCard>
    </div>
  );
}
