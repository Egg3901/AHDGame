"use client";

import { Party } from "../partiesTypes";
import { DonutChartBase } from "./DonutChartBase";

export function DonutChart({ parties }: { parties: Party[] }) {
  return (
    <DonutChartBase
      items={parties.map((p) => ({
        id: p.id,
        name: p.name,
        abbreviation: p.abbreviation,
        color: p.color,
        value: p.memberCount,
      }))}
      centerLabel="total"
      formatValue={(v) => v.toLocaleString("en-US")}
    />
  );
}
