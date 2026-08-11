"use client";

import type { EnergySummaryView } from "../useCabinetOffice";
import { Tile } from "./dossier";
import { fmtMoneyM, fmtCapacity } from "./energy/energyUi";

/** Masthead stat strip for an energy seat — replaces the metric strip with grid aggregates. */
export function CabinetEnergyStrip({
  energySummary,
  currencySymbol = "$",
}: {
  energySummary: EnergySummaryView;
  currencySymbol?: string;
}) {
  return (
    <div className="grid grid-cols-2 divide-x divide-y divide-card-border bg-card-muted/60 sm:grid-cols-4 lg:divide-y-0">
      <Tile
        label="Capacity"
        value={fmtCapacity(energySummary.totalCapacity)}
        tone="gov"
        sub="installed"
      />
      <Tile
        label="Renewable"
        value={`${Math.round(energySummary.renewableShare * 100)}%`}
        sub="of capacity"
      />
      <Tile
        label="Firm"
        value={`${Math.round(energySummary.firmShare * 100)}%`}
        sub="dispatchable"
      />
      <Tile
        label="Upkeep"
        value={fmtMoneyM(currencySymbol, energySummary.totalUpkeep)}
        sub="committed"
      />
    </div>
  );
}
