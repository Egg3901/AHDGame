"use client";

import type { EstateSummaryView } from "../useCabinetOffice";
import { Tile } from "./dossier";
import { ESTATE_UPKEEP_UNIT } from "@/lib/constants/cabinetEstates";
import { fmtMoneyM, fmtMoneyAbs } from "./estates/estatesUi";

/** Masthead stat strip for an estates seat — replaces the metric strip with portfolio aggregates. */
export function CabinetEstateStrip({
  estateSummary,
  currencySymbol = "$",
}: {
  estateSummary: EstateSummaryView;
  currencySymbol?: string;
}) {
  const upkeepAbs = estateSummary.totalUpkeep * ESTATE_UPKEEP_UNIT;
  const use =
    estateSummary.envelope > 0 ? Math.round((upkeepAbs / estateSummary.envelope) * 100) : 0;
  const over = estateSummary.envelope > 0 && upkeepAbs > estateSummary.envelope;
  return (
    <div className="grid grid-cols-2 divide-x divide-y divide-card-border bg-card-muted/60 sm:grid-cols-4 lg:divide-y-0">
      <Tile
        label="Facilities"
        value={estateSummary.count.toLocaleString("en-US")}
        tone="gov"
        sub="in service"
      />
      <Tile
        label="Annual upkeep"
        value={fmtMoneyM(currencySymbol, estateSummary.totalUpkeep)}
        sub="committed"
      />
      <Tile
        label="Disc. budget"
        value={fmtMoneyAbs(currencySymbol, estateSummary.envelope)}
        sub="discretionary"
      />
      <Tile
        label="Committed"
        value={`${use}%`}
        tone={over ? "down" : "gov"}
        sub={over ? "over budget" : "of envelope"}
      />
    </div>
  );
}
