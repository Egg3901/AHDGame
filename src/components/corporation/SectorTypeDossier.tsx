"use client";

/**
 * The dossier that heads a sector type on the Sectors tab.
 *
 * A corporation's sectors used to arrive as one undifferentiated table, and
 * nothing on the page said what a mine, a newsroom or a power station actually
 * is. The dossier answers that once per type: a period photograph, two
 * sentences on what moves the margin, and a strip of live figures for the
 * sites of that type you own.
 *
 * Everything numeric here resolves from the sectors passed in. The only static
 * content is the copy and the photo, which live in `sectorTypeDossier`.
 */

import { HeroImage } from "@/components/HeroImage";
import { CORPORATION_TYPE_LABELS, type CorporationType } from "@/lib/constants/corporations";
import {
  buildOnePhrase,
  capitalizeFacility,
  facilityPlural,
  facilitySingular,
} from "@/lib/constants/facilityVocabulary";
import {
  PROPOSED_ACTION_NOTE,
  SECTOR_TYPE_BRIEFING,
  SECTOR_TYPE_HERO,
  hexAlpha,
  proposedSectorActions,
  sectorTypePalette,
} from "@/lib/constants/sectorTypeDossier";
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
  isCeo: boolean;
  timeScale: MoneyPeriod;
  scaleFactor: number;
  fmtMoney: (value: number) => string;
  metricContext: SectorTypeMetricContext;
  /** Opens the expand-market modal already pointed at this sector type. */
  onBuild: () => void;
}

export function SectorTypeDossier({
  sectorType,
  sectors,
  allSectors,
  isCeo,
  timeScale,
  scaleFactor,
  fmtMoney,
  metricContext,
  onBuild,
}: SectorTypeDossierProps) {
  const palette = sectorTypePalette(sectorType);
  const label = CORPORATION_TYPE_LABELS[sectorType] ?? sectorType;
  const hero = SECTOR_TYPE_HERO[sectorType];
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
  const actions = proposedSectorActions(sectorType);

  const kpis = [
    {
      label: `Revenue ${suffix}`,
      value: financialsRedacted ? "—" : fmtMoney(revenue * scaleFactor),
      sub: `${sites} combined`,
      help: `Realized revenue of every ${facilitySingular(sectorType)} you own, on the same basis as the table total below.`,
      tone: "success" as const,
    },
    {
      label: `Profit ${suffix}`,
      value: fmtMoney(profit * scaleFactor),
      sub: financialsRedacted ? "" : `${blendedMargin.toFixed(1)}% blended margin`,
      help: `Net profit of every ${facilitySingular(sectorType)} you own.`,
      tone: profit >= 0 ? ("success" as const) : ("error" as const),
    },
    ...metrics.map((m) => ({ ...m, tone: "neutral" as const })),
  ];

  return (
    <section className="overflow-hidden rounded-xl border border-card-border bg-card">
      {/* Height comes from the CONTENT, with the designed banner size as a
          floor. A fixed height plus bottom-anchored flex content overflows
          UPWARD, and the section clips it: at phone width a long briefing over
          a CEO action row pushed the division eyebrow 38px above the box and
          the overflow-hidden ate it silently. */}
      <div className="relative w-full">
        {hero ? (
          <>
            <HeroImage
              src={hero}
              alt=""
              className="opacity-55"
              sizes="(max-width: 1024px) 100vw, 1024px"
            />
            <div
              className="absolute inset-0 mix-blend-multiply"
              style={{ background: hexAlpha(palette.c500, 0.35) }}
              aria-hidden
            />
          </>
        ) : (
          // Six sector types ship no photograph. Multiplying the type tint over
          // an empty banner just yields black, so those get a lit gradient of
          // their own colour instead and the strip still reads as that division.
          <div
            className="absolute inset-0"
            style={{
              background: `linear-gradient(115deg, ${hexAlpha(palette.c500, 0.85)} 0%, ${hexAlpha(
                palette.c500,
                0.25
              )} 55%, rgba(0,0,0,0.35) 100%)`,
            }}
            aria-hidden
          />
        )}
        <div
          // The right end is darker than the design's scrim on purpose: the CEO
          // action row sits there, and a bright sky in the photograph left the
          // buttons unreadable.
          className={`absolute inset-0 bg-gradient-to-r ${
            hero
              ? "from-black/90 via-black/60 to-black/50"
              : "from-black/75 via-black/45 to-black/35"
          }`}
          aria-hidden
        />
        <div className="relative flex min-h-[15.5rem] flex-col items-stretch justify-end gap-4 p-5 sm:min-h-[10.5rem] sm:flex-row sm:items-end sm:justify-between sm:px-6">
          <div className="min-w-0 flex-1">
            <div className="mb-1.5 flex flex-wrap items-center gap-2">
              <span
                className="text-[10px] font-bold uppercase tracking-[0.16em]"
                style={{ color: palette.c400 }}
              >
                {label} division
              </span>
              <span className="text-[10px] uppercase tracking-widest text-white/60">
                {financialsRedacted ? "revenue not disclosed" : `${revenueShare}% of corp revenue`}
              </span>
            </div>
            <h2 className="m-0 text-[1.375rem] font-bold tracking-tight text-white">
              {facilityCount.toLocaleString("en-US")} {siteWord} in {stateCount}{" "}
              {stateCount === 1 ? "state" : "states"}
            </h2>
            <p className="mt-2 max-w-[38.75rem] text-pretty text-[13px] leading-relaxed text-white/85">
              {SECTOR_TYPE_BRIEFING[sectorType]}
            </p>
          </div>
          {isCeo && (
            // The plate is not in the design, but the design's photographs are:
            // a bright sky at the right of the banner left these buttons
            // unreadable against it.
            <div className="flex shrink-0 flex-wrap gap-2 self-end rounded-xl bg-black/40 p-1.5 backdrop-blur-[2px]">
              {actions.map((action) => (
                <button
                  key={action.label}
                  type="button"
                  disabled
                  title={`${action.help} ${PROPOSED_ACTION_NOTE}`}
                  className="inline-flex cursor-not-allowed items-center gap-1.5 whitespace-nowrap rounded-lg border px-3 py-1.5 text-xs font-semibold opacity-60"
                  style={{
                    borderColor: hexAlpha(palette.c500, 0.35),
                    background: hexAlpha(palette.c500, 0.12),
                    color: palette.c400,
                  }}
                >
                  {action.label}
                </button>
              ))}
              <button
                type="button"
                onClick={onBuild}
                className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/20"
              >
                <span>+</span>
                {capitalizeFacility(buildOnePhrase(sectorType))}
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-px border-t border-card-border bg-card-border sm:grid-cols-5">
        {kpis.map((kpi, index) => (
          <div
            key={kpi.label}
            // Two columns on mobile leaves a fifth cell alone on its own row;
            // the design drops it there rather than stranding it.
            className={`flex min-h-[4.75rem] flex-col justify-between gap-1 bg-card px-4 py-3 ${
              index === 4 ? "hidden sm:flex" : ""
            }`}
            title={kpi.help}
          >
            <span className="truncate text-[10px] font-bold uppercase tracking-widest text-muted">
              {kpi.label}
            </span>
            <div className="min-w-0">
              <span
                className={`block truncate text-lg font-bold leading-tight tabular-nums ${
                  kpi.tone === "success"
                    ? "text-success"
                    : kpi.tone === "error"
                      ? "text-error"
                      : "text-foreground"
                }`}
              >
                {kpi.value}
              </span>
              {kpi.sub && <span className="block truncate text-[10px] text-muted">{kpi.sub}</span>}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
