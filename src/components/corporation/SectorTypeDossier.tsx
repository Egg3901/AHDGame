"use client";

/**
 * The dossier that heads a sector type on the Sectors tab.
 *
 * A corporation's sectors used to arrive as one undifferentiated table, and
 * nothing on the page said what a mine, a newsroom or a power station actually
 * is. The dossier answers that once per type: two sentences on what moves the
 * margin and a row of live figures for the sites of that type you own.
 *
 * Everything numeric here resolves from the sectors passed in. The only static
 * content is the copy, which lives in `sectorTypeDossier`.
 */

import { CORPORATION_TYPE_LABELS, type CorporationType } from "@/lib/constants/corporations";
import { facilityPlural, facilitySingular } from "@/lib/constants/facilityVocabulary";
import { SECTOR_TYPE_BRIEFING } from "@/lib/constants/sectorTypeDossier";
import { getOperatingSectorLabel } from "@/lib/constants/sectorStrategies";
import type { MoneyPeriod } from "@/lib/constants/moneyTimescale";
import { MONEY_PERIOD_SUFFIX } from "@/lib/constants/moneyTimescale";
import type { SectorDetail } from "./CorporationPageTypes";
import { sumSectorDisplayRevenue } from "./sectorSortUtils";
import {
  sectorTypeMetrics,
  typeFacilityCount,
  typeStateCount,
  type SectorTypeMetricContext,
} from "./sectorTypeMetrics";

interface SectorTypeDossierProps {
  sectorType: CorporationType;
  /** Every sector of this type the corporation owns, before table filtering. */
  sectors: SectorDetail[];
  /** Every sector the corporation owns, for the "share of corp revenue" line. */
  allSectors: SectorDetail[];
  timeScale: MoneyPeriod;
  scaleFactor: number;
  fmtMoney: (value: number) => string;
  metricContext: SectorTypeMetricContext;
}

export function SectorTypeDossier({
  sectorType,
  sectors,
  allSectors,
  timeScale,
  scaleFactor,
  fmtMoney,
  metricContext,
}: SectorTypeDossierProps) {
  // sectorType is the operating type (automobiles / entertainment for the
  // folded lanes), resolved by SectorsTab from the group's model fields.
  const label =
    getOperatingSectorLabel(sectorType) ?? CORPORATION_TYPE_LABELS[sectorType] ?? sectorType;
  const suffix = MONEY_PERIOD_SUFFIX[timeScale];

  const sites = facilityPlural(sectorType);
  // Facilities, not sectors: a division of three sectors holding four plants
  // each is twelve plants, and the headline says so.
  const facilityCount = typeFacilityCount(sectors);
  const siteWord = facilityCount === 1 ? facilitySingular(sectorType) : sites;
  const stateCount = typeStateCount(sectors);

  // The Total row's basis, so the dossier and the table below it never disagree.
  const revenue = sumSectorDisplayRevenue(sectors);
  const profit = sectors.reduce((sum, s) => sum + (s.profit ?? 0), 0);
  const corpRevenue = sumSectorDisplayRevenue(allSectors);
  const revenueShare = corpRevenue > 0 ? Math.round((revenue / corpRevenue) * 100) : 0;
  const blendedMargin = revenue > 0 ? (profit / revenue) * 100 : 0;
  // Outsiders viewing a private corp get revenue stripped row by row; a zero
  // total in that case is redaction, not a business that earns nothing.
  const financialsRedacted = sectors.some((s) => s.revenue == null);

  const metrics = sectorTypeMetrics(sectors, sectorType, metricContext);

  const kpis = [
    {
      label: `Revenue${suffix}`,
      value: financialsRedacted ? "n/a" : fmtMoney(revenue * scaleFactor),
      sub: `${sites} combined`,
      help: `Realized revenue of every ${facilitySingular(sectorType)} you own, on the same basis as the table total below.`,
      tone: "neutral" as const,
    },
    {
      label: `Profit${suffix}`,
      value: fmtMoney(profit * scaleFactor),
      sub: financialsRedacted ? "" : `${blendedMargin.toFixed(1)}% blended margin`,
      help: `Net profit of every ${facilitySingular(sectorType)} you own.`,
      tone:
        profit > 0 ? ("success" as const) : profit < 0 ? ("error" as const) : ("neutral" as const),
    },
    ...metrics.map((m) => ({ ...m, tone: "neutral" as const })),
  ];

  return (
    <section className="min-w-0">
      <div className="flex min-h-8 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-card-border pb-1.5">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <h2 className="text-sm font-semibold text-foreground">
            {facilityCount.toLocaleString("en-US")} {siteWord} in {stateCount}{" "}
            {stateCount === 1 ? "state" : "states"}
          </h2>
          <span className="text-xs text-muted">{label} division</span>
          <span className="text-xs text-muted">
            {financialsRedacted ? "revenue not disclosed" : `${revenueShare}% of corp revenue`}
          </span>
        </div>
      </div>
      <p className="max-w-3xl py-1.5 text-xs text-muted">{SECTOR_TYPE_BRIEFING[sectorType]}</p>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 pt-1 sm:grid-cols-5">
        {kpis.map((kpi) => (
          <div key={kpi.label} className="min-w-0" title={kpi.help}>
            <dt className="truncate text-[11px] text-muted">{kpi.label}</dt>
            <dd
              className={`mt-0.5 truncate font-mono text-sm font-medium tabular-nums ${
                kpi.tone === "success"
                  ? "text-success"
                  : kpi.tone === "error"
                    ? "text-error"
                    : "text-foreground"
              }`}
            >
              {kpi.value}
            </dd>
            {kpi.sub && <dd className="truncate text-[11px] text-muted">{kpi.sub}</dd>}
          </div>
        ))}
      </dl>
    </section>
  );
}
