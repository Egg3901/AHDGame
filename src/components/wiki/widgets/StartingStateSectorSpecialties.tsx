import { BarChart2 } from "lucide-react";
import type { CountryId } from "@/lib/constants/countries";
import {
  CORPORATION_TYPE_LABELS,
  STATE_PRIMARY_SECTOR_MARGIN_BONUS,
  STATE_SECONDARY_SECTOR_MARGIN_BONUS,
  type CorporationType,
} from "@/lib/constants/corporations";
import type { State } from "@/lib/db/types";
import { inferStateSectorSpecialization } from "@/lib/admin/seed/seedStateSectorSpecializations";
import { getStateSectorWeights } from "@/lib/seeds/reference/sectorSeedWeights";
import { states } from "@/lib/seeds/reference/states";
import { ukRegions } from "@/lib/seeds/uk/ukRegions";
import { deRegions } from "@/lib/seeds/de/deRegions";
import { jpRegions } from "@/lib/seeds/jp/jpRegions";
import { brRegions } from "@/lib/seeds/br/brRegions";
import { cnRegions } from "@/lib/seeds/cn/cnRegions";
import { ieRegions } from "@/lib/seeds/ie/ieRegions";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";

type StartingCountryId = Exclude<
  CountryId,
  | "NG"
  | "HU"
  | "PL"
  | "RO"
  | "YU"
  | "BG"
  | "UKR"
  | "BLR"
  | "CS"
  | "BAL"
  | "RU"
  | "RU"
  | "FR"
  | "IT"
  | "ES"
  | "SE"
  | "TR"
  | "GR"
  | "AT"
  | "FI"
  | "DD"
  | "SCO"
  | "WAL"
>;

const REGIONS_BY_COUNTRY: Record<StartingCountryId, readonly State[]> = {
  US: states.filter((state) => state.countryId === "US"),
  UK: ukRegions,
  DE: deRegions,
  JP: jpRegions,
  BR: brRegions,
  CN: cnRegions,
  IE: ieRegions,
};

function formatSectorWeight(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

// The wiki shows the STARTING seed picture and is not era-aware yet, so it
// pins the default preset explicitly rather than riding a parameter default.
// Making these widgets follow gameState.preset is tracked separately.
function getSectorSpecialtyRows(countryId: StartingCountryId) {
  return REGIONS_BY_COUNTRY[countryId]
    .map((region) => {
      const specialization = inferStateSectorSpecialization(region);
      const weights = getStateSectorWeights(region._id, countryId, DEFAULT_SEED_PRESET);
      return {
        region,
        primary: specialization.primary,
        secondary: specialization.secondary,
        primaryWeight: weights[specialization.primary],
        secondaryWeight: weights[specialization.secondary],
      };
    })
    .sort((a, b) => b.primaryWeight - a.primaryWeight);
}

function getSectorSpecialtySummary(countryId: StartingCountryId) {
  const counts = new Map<CorporationType, { primary: number; secondary: number }>();

  for (const row of getSectorSpecialtyRows(countryId)) {
    const primaryCount = counts.get(row.primary) ?? { primary: 0, secondary: 0 };
    primaryCount.primary += 1;
    counts.set(row.primary, primaryCount);

    const secondaryCount = counts.get(row.secondary) ?? { primary: 0, secondary: 0 };
    secondaryCount.secondary += 1;
    counts.set(row.secondary, secondaryCount);
  }

  return [...counts.entries()]
    .map(([sector, count]) => ({ sector, ...count, total: count.primary + count.secondary }))
    .sort((a, b) => b.primary - a.primary || b.total - a.total || a.sector.localeCompare(b.sector));
}

function MiniMetric({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-md border border-card-border bg-card-elevated/55 p-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">{label}</div>
      <div className="mt-1 text-lg font-semibold leading-tight text-foreground">{value}</div>
      {detail && <p className="mt-1 text-xs leading-relaxed text-muted">{detail}</p>}
    </div>
  );
}

export function SectorSpecialtySummaryChips({ countryId }: { countryId: StartingCountryId }) {
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {getSectorSpecialtySummary(countryId)
        .slice(0, 3)
        .map((entry) => (
          <span
            key={entry.sector}
            className="rounded-md border border-card-border bg-card-elevated px-2.5 py-1 text-xs text-muted"
          >
            <span className="font-medium text-foreground">
              {CORPORATION_TYPE_LABELS[entry.sector]}
            </span>
            <span className="ml-1">
              {entry.primary} primary, {entry.secondary} secondary
            </span>
          </span>
        ))}
    </div>
  );
}

export function SectorSpecialtyPanel({ countryId }: { countryId: StartingCountryId }) {
  const rows = getSectorSpecialtyRows(countryId);
  const summary = getSectorSpecialtySummary(countryId);
  const featuredRows = rows.slice(0, 5);

  return (
    <section
      id={`starting-state-${countryId.toLowerCase()}-specialties`}
      className="scroll-mt-24 rounded-lg border border-card-border bg-card/45 p-4"
    >
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.1em] text-muted">
            <BarChart2 className="h-3.5 w-3.5" aria-hidden="true" />
            Starting Sector Specialties
          </div>
          <h4 className="mt-1 text-lg font-semibold text-foreground">Regional margin bonuses</h4>
        </div>
        <span className="rounded-md border border-card-border bg-card-elevated px-2.5 py-1 text-xs font-medium text-muted">
          +{STATE_PRIMARY_SECTOR_MARGIN_BONUS}pp primary / +{STATE_SECONDARY_SECTOR_MARGIN_BONUS}pp
          secondary
        </span>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        {summary.slice(0, 3).map((entry) => (
          <MiniMetric
            key={entry.sector}
            label={CORPORATION_TYPE_LABELS[entry.sector]}
            value={`${entry.primary} / ${entry.secondary}`}
            detail="Primary / secondary region count"
          />
        ))}
      </div>

      <div className="mt-4 space-y-3">
        {featuredRows.map((row) => (
          <div
            key={row.region._id}
            className="rounded-md border border-card-border bg-card-elevated/45 p-3"
          >
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div className="font-medium text-foreground">{row.region.name}</div>
              <div className="font-mono text-xs text-muted">{row.region._id}</div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="rounded border border-card-border bg-card/45 px-3 py-2">
                <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-primary">
                  Primary +{STATE_PRIMARY_SECTOR_MARGIN_BONUS}pp
                </div>
                <div className="mt-1 text-sm font-semibold text-foreground">
                  {CORPORATION_TYPE_LABELS[row.primary]}
                </div>
                <div className="mt-1 text-xs text-muted">
                  {formatSectorWeight(row.primaryWeight)} local sector seed share
                </div>
              </div>
              <div className="rounded border border-card-border bg-card/45 px-3 py-2">
                <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
                  Secondary +{STATE_SECONDARY_SECTOR_MARGIN_BONUS}pp
                </div>
                <div className="mt-1 text-sm font-semibold text-foreground">
                  {CORPORATION_TYPE_LABELS[row.secondary]}
                </div>
                <div className="mt-1 text-xs text-muted">
                  {formatSectorWeight(row.secondaryWeight)} local sector seed share
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {rows.length > featuredRows.length && (
        <details className="mt-3 rounded-md border border-card-border bg-card/35 p-3">
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-[0.1em] text-muted marker:text-primary">
            Show all {rows.length} region specialties
          </summary>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {rows.slice(featuredRows.length).map((row) => (
              <div
                key={row.region._id}
                className="flex flex-wrap items-center justify-between gap-2 rounded border border-card-border bg-card-elevated/45 px-3 py-2 text-xs"
              >
                <span className="font-medium text-foreground">{row.region.name}</span>
                <span className="text-muted">
                  {CORPORATION_TYPE_LABELS[row.primary]} / {CORPORATION_TYPE_LABELS[row.secondary]}
                </span>
              </div>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
