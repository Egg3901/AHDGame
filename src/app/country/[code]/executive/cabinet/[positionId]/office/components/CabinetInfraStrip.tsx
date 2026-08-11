"use client";

import type { InfraSummaryView } from "../useCabinetOffice";
import { Tile } from "./dossier";
import { fmtMoneyM, fmtMoneyAbs } from "./infra/infraUi";

/** Masthead stat strip for a transportation seat — replaces the metric strip with pipeline aggregates. */
export function CabinetInfraStrip({
  infraSummary,
  currencySymbol = "$",
}: {
  infraSummary: InfraSummaryView;
  currencySymbol?: string;
}) {
  return (
    <div className="grid grid-cols-2 divide-x divide-y divide-card-border bg-card-muted/60 sm:grid-cols-4 lg:divide-y-0">
      <Tile
        label="Operational"
        value={infraSummary.operational.toLocaleString("en-US")}
        tone="gov"
        sub="in service"
      />
      <Tile
        label="Building"
        value={infraSummary.building.toLocaleString("en-US")}
        sub="under construction"
      />
      <Tile
        label="Committed"
        value={fmtMoneyM(currencySymbol, infraSummary.committedSpend)}
        sub="per turn"
      />
      <Tile
        label="Disc. budget"
        value={fmtMoneyAbs(currencySymbol, infraSummary.envelope)}
        sub="discretionary"
      />
    </div>
  );
}
