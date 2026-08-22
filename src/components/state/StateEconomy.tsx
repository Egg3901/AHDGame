"use client";

import { useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { CAPACITY_UNIT_LABEL, formatUnits } from "@/components/corporation/plantsPresentation";
import { useSearchParams } from "next/navigation";
import { Skeleton } from "@/components/ui";
import { Tooltip } from "@/components/Tooltip";
import { useCurrency } from "@/contexts/CurrencyContext";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import type { CountryId } from "@/lib/constants/countries";
import {
  COMMODITY_ICONS,
  COMMODITY_COLORS,
  SECTOR_SUPPLY,
  SECTOR_DEMAND,
  COMMODITY_LABELS,
  COMMODITY_UNITS,
  EXTRACTABLE_RESOURCES,
} from "@/lib/constants/commodities";
import type { ExtractableResource } from "@/lib/constants/commodities";
import {
  MAX_GROWTH_RATE,
  MIN_GROWTH_RATE,
  GROWTH_ADJUST_COST_PER_PERCENT,
  GROWTH_RATE_TURNS_PER_YEAR,
  CORPORATION_TYPES,
  CORPORATION_TYPE_LABELS,
  type CorporationType,
} from "@/lib/constants/corporations";
import { economyUrl, regionApiSubUrl, stockmarketUrl } from "@/lib/urls";
import { CorporationLogo } from "@/components/corporation/CorporationLogo";
import { getCountryFlagUrlForEra } from "@/lib/constants/flags";
import { useActivePreset } from "@/contexts/RegisteredCountriesContext";
import { formatMarketingStrength, formatGDP } from "@/lib/utils/formatters";
import { getCurrencyPrefix } from "@/lib/utils/budgetCalculations";
import { SectorBoard, type SectorBoardTile } from "@/components/state/economy/SectorBoard";
import { meanGrowth } from "@/lib/economy/sectorGrowth";
import { fetchJson } from "@/lib/observability/fetchJson";
import { StateMacroHeader } from "@/components/state/economy/StateMacroHeader";
import { EconomicModelCard } from "@/components/economy/EconomicModelCard";
import {
  formatProductionLevel,
  productionFillPercent,
  productionTone,
} from "@/components/state/economy/production";

// Default colors for corps that haven't set a brand color
const DEFAULT_CORP_COLORS = [
  "#3b82f6",
  "#ef4444",
  "#10b981",
  "#f59e0b",
  "#8b5cf6",
  "#ec4899",
  "#06b6d4",
  "#f97316",
  "#14b8a6",
  "#6366f1",
];

interface SectorOwner {
  sectorId: string;
  corporationId: string;
  corporationName: string;
  corporationSequentialId?: number;
  displayName?: string | null;
  sectorLabel?: string;
  brandColor?: string;
  logoUrl?: string | null;
  ceoName: string;
  ceoCountryId?: string | null;
  ceoSequentialId?: number;
  revenue: number | null;
  marketShare: number;
  workers: number | null;
  targetGrowthRate: number;
  currentGrowthRate: number;
  /** CEO-set production level (−25…+25); negative risks the margin penalty. */
  productionLevel?: number;
  isNatcorp?: boolean;
  /** NPP-run corp — aggregated into one pie slice and hidden from the table (t834). */
  isNpp?: boolean;
  attackCost?: number | null;
  attackEstimatedCapture?: number | null;
  /** Active for-sale listing — null when not on the secondary market */
  forSale?: {
    listedAt: string;
    /** Asking price in ₳ */
    priceAnchor: number;
    /** NPV in ₳ at listing time */
    npvAnchor: number;
  } | null;
}

interface EconomySector {
  type: CorporationType;
  label: string;
  totalMarket: number;
  ownedRevenue: number;
  unownedRevenue: number;
  unownedPercent: number;
  /** Plants tier: unmet demand in this market, output units per day. */
  headroomUnits?: number | null;
  splitCost: number;
  estimatedCapture: number;
  estimatedCapturePercent: number;
  owners: SectorOwner[];
}

interface EconomyData {
  /**
   * True under `marketSystemMode >= "plants"`. The unowned pool is presented as
   * UNMET DEMAND in units there, because ₳ of "unowned revenue" is not a thing
   * a player can buy any more — they build against the demand instead.
   */
  plantsMode?: boolean;
  stateId: string;
  stateName: string;
  stateGdp: number;
  /** Macro header context — null fields degrade the header, never block it. */
  macro?: {
    stateGdpGrowth: number | null;
    nationalGdpGrowth: number | null;
  };
  /** National effective-market totals per sector (₳), for the context line. */
  nationalSectorTotals?: Partial<Record<CorporationType, number>>;
  sectorSpecializations?: {
    primary: CorporationType;
    primaryLabel: string;
    primaryBonus: number;
    secondary: CorporationType;
    secondaryLabel: string;
    secondaryBonus: number;
  } | null;
  totalMarketPerSector: number;
  sectors: EconomySector[];
  userCorporationId: string | null;
  userCorporationSectorType?: CorporationType | null;
  userMarketingStrength: number;
  /** MS charged by the owned-sector attack route. */
  attackMsCost?: number;
  /** MS charged by the retired unowned split action in legacy worlds. */
  splitMsCost: number;
  stateResources?: Partial<Record<ExtractableResource, number>> | null;
}

export function StateEconomy({ stateId, countryId }: { stateId: string; countryId: string }) {
  const preset = useActivePreset();
  const { formatAmount, formatAmountIn, formatAmountChipIn } = useCurrency();
  // Market totals anchor on the sector's country economy (this page's country),
  // not the viewer's wallet. Otherwise a forex shift on the viewer's preferred
  // currency makes the underlying market size appear to drift turn-over-turn.
  // Costs the viewer pays (adjust-growth, attack, split) stay in viewer currency
  // since they come out of the viewer's corp treasury.
  const sectorCurrency = COUNTRY_CURRENCY_MAP[(countryId ?? "US") as CountryId] ?? "USD";
  const marketCurrencyNote = `Shown in ${sectorCurrency}, the sector's home currency. Market totals track the underlying state economy and do not fluctuate with forex rate changes on your display preference.`;
  const fmtMarket = (v: number) => formatAmountIn(v, sectorCurrency);
  const fmtMarketChip = (v: number) => formatAmountChipIn(v, sectorCurrency);
  const searchParams = useSearchParams();
  const urlSector = searchParams.get("sector");
  const validUrlSector =
    urlSector && (CORPORATION_TYPES as readonly string[]).includes(urlSector)
      ? (urlSector as CorporationType)
      : null;
  const [data, setData] = useState<EconomyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedType, setSelectedType] = useState<CorporationType>(validUrlSector ?? "financial");
  const hasAppliedInitialSector = useRef(false);
  const [splitting, setSplitting] = useState(false);
  const [splitMsg, setSplitMsg] = useState("");
  const [splitError, setSplitError] = useState("");
  const [splitStrength, setSplitStrength] = useState<"full" | "half">("full");
  const [attackingId, setAttackingId] = useState<string | null>(null);
  const [attackMsg, setAttackMsg] = useState("");
  const [attackError, setAttackError] = useState("");
  const [adjustingId, setAdjustingId] = useState<string | null>(null);
  const [adjustMsg, setAdjustMsg] = useState("");
  const [adjustError, setAdjustError] = useState("");
  const [participantsExpanded, setParticipantsExpanded] = useState(false);

  const fetchEconomy = useCallback(() => {
    setLoading(true);
    fetchJson<EconomyData>(regionApiSubUrl(countryId, stateId, "economy"), {
      feature: "state-economy",
    })
      .then((d) => {
        if (d.sectors) {
          setData(d);
          if (!hasAppliedInitialSector.current) {
            // URL sector param takes priority, then the user's corp sector,
            // then the largest market on the board (matches the board's
            // size-descending ordering).
            const largestSector = (d.sectors as EconomySector[]).reduce<EconomySector | null>(
              (top, s) => (top == null || s.totalMarket > top.totalMarket ? s : top),
              null
            );
            const targetSector =
              validUrlSector ?? d.userCorporationSectorType ?? largestSector?.type;
            if (targetSector) {
              const sectorExists = d.sectors.some((s: EconomySector) => s.type === targetSector);
              if (sectorExists) {
                setSelectedType(targetSector);
              }
            }
            hasAppliedInitialSector.current = true;
          }
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countryId, stateId]);

  useEffect(() => {
    fetchEconomy();
  }, [fetchEconomy]);

  async function handleSplit(strength: "full" | "half" = "full") {
    setSplitting(true);
    setSplitError("");
    setSplitMsg("");
    try {
      const res = await fetch(`${regionApiSubUrl(countryId, stateId, "economy/attack")}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sectorType: selectedType, splitStrength: strength }),
      });
      const result = await res.json();
      if (res.ok) {
        setSplitMsg(result.message);
        fetchEconomy();
      } else {
        setSplitError(result.error || "Split failed");
      }
    } catch {
      setSplitError("Network error");
    } finally {
      setSplitting(false);
    }
  }

  async function handleAttackSector(sectorId: string) {
    setAttackingId(sectorId);
    setAttackError("");
    setAttackMsg("");
    try {
      const res = await fetch(regionApiSubUrl(countryId, stateId, "economy/attack-sector"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sectorId }),
      });
      const result = await res.json();
      if (res.ok) {
        setAttackMsg(result.message);
        fetchEconomy();
      } else {
        setAttackError(result.error || "Attack failed");
      }
    } catch {
      setAttackError("Network error");
    } finally {
      setAttackingId(null);
    }
  }

  async function handleAdjustGrowth(sectorId: string, direction: "expand" | "downsize") {
    setAdjustingId(sectorId);
    setAdjustMsg("");
    setAdjustError("");
    try {
      const res = await fetch(regionApiSubUrl(countryId, stateId, "economy/adjust-growth"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sectorId, direction }),
      });
      const result = await res.json();
      if (res.ok) {
        setAdjustMsg(result.message);
        fetchEconomy();
      } else {
        setAdjustError(result.error || "Failed to adjust growth");
      }
    } catch {
      setAdjustError("Network error");
    } finally {
      setAdjustingId(null);
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-xl border border-card-border bg-card p-8 text-center text-muted text-sm">
        Failed to load economy data.
      </div>
    );
  }

  const sector = data.sectors.find((s) => s.type === selectedType);
  if (!sector) return null;

  // NPP corps are individually attackable unless an admin disabled it. When
  // attackable (default), render every NPP corp as its own navigable row so a
  // player can reach the sector page and attack it; otherwise fall back to the
  // legacy single aggregate slice.
  const nppAttackable = (data as { nppAttackable?: boolean }).nppAttackable !== false;
  const { pieOwners, playerOwners } = nppAttackable
    ? { pieOwners: sector.owners, playerOwners: sector.owners }
    : splitNppOwners(sector.owners);

  const ownedPercent = 100 - sector.unownedPercent;
  const specializationBonus =
    data.sectorSpecializations?.primary === selectedType
      ? data.sectorSpecializations.primaryBonus
      : data.sectorSpecializations?.secondary === selectedType
        ? data.sectorSpecializations.secondaryBonus
        : 0;

  const boardTiles: SectorBoardTile[] = data.sectors.map((s) => ({
    type: s.type,
    label: s.label,
    totalMarket: s.totalMarket,
    ownedPercent: 100 - s.unownedPercent,
    star:
      data.sectorSpecializations?.primary === s.type
        ? { rank: "primary", bonus: data.sectorSpecializations.primaryBonus }
        : data.sectorSpecializations?.secondary === s.type
          ? { rank: "secondary", bonus: data.sectorSpecializations.secondaryBonus }
          : null,
    // Mean of the member corps' current (realized) growth rate.
    avgGrowth: meanGrowth(s.owners.map((o) => o.currentGrowthRate)),
  }));
  const topSector = data.sectors.reduce<EconomySector | null>(
    (top, s) => (top == null || s.totalMarket > top.totalMarket ? s : top),
    null
  );

  const selectSector = (type: CorporationType) => {
    setSelectedType(type);
    setSplitStrength("full");
    setSplitMsg("");
    setSplitError("");
    setAttackMsg("");
    setAttackError("");
    setAdjustMsg("");
    setAdjustError("");
  };

  return (
    <div className="space-y-6">
      {/* Macro context header */}
      <StateMacroHeader
        countryId={countryId}
        stateName={data.stateName}
        gdpDisplay={formatGDP(data.stateGdp, getCurrencyPrefix(countryId))}
        stateGdpGrowth={data.macro?.stateGdpGrowth ?? null}
        nationalGdpGrowth={data.macro?.nationalGdpGrowth ?? null}
        topSectorLabel={topSector?.label ?? null}
      />

      {/* Headline stats — one thin strip summarising the whole state economy.
          Everything below narrows to a single sector; this stays all-sector. */}
      <div className="flex items-stretch divide-x divide-card-border overflow-x-auto rounded-xl border border-card-border bg-card">
        {/* Total Market — sum across all sectors */}
        <div className="flex min-w-max flex-1 flex-col justify-center px-4 py-2.5">
          <Tooltip content={marketCurrencyNote}>
            <span className="block w-fit cursor-help border-b border-dashed border-card-border/70 text-[10px] font-medium uppercase tracking-widest text-muted">
              Total Market
            </span>
          </Tooltip>
          <span className="mt-0.5 text-sm font-bold text-foreground tabular-nums">
            {fmtMarketChip(data.sectors.reduce((sum, s) => sum + s.totalMarket, 0))}
            <span className="text-[10px] font-normal text-muted">/day</span>
          </span>
        </div>
        {/* Top Sector — label + market size */}
        <div className="flex min-w-max flex-1 flex-col justify-center px-4 py-2.5">
          <span className="block text-[10px] font-medium uppercase tracking-widest text-muted">
            Top Sector
          </span>
          <span className="mt-0.5 truncate text-sm font-bold text-primary">
            {topSector?.label ?? "—"}
          </span>
          {topSector && (
            <span className="block text-[10px] font-medium text-muted tabular-nums">
              {fmtMarketChip(topSector.totalMarket)}/day
            </span>
          )}
        </div>
        {/* Corporations — count of all player-owned corps across all sectors */}
        <div className="flex min-w-max flex-1 flex-col justify-center px-4 py-2.5">
          <span className="block text-[10px] font-medium uppercase tracking-widest text-muted">
            Corporations
          </span>
          <span className="mt-0.5 text-sm font-bold text-foreground tabular-nums">
            {data.sectors.reduce(
              (count, s) => count + s.owners.filter((o) => !o.isNpp && !o.isNatcorp).length,
              0
            )}
          </span>
        </div>
        {/* Market Control — average owned % across all sectors */}
        <div className="flex min-w-max flex-1 flex-col justify-center px-4 py-2.5">
          <span className="block text-[10px] font-medium uppercase tracking-widest text-muted">
            Market Control
          </span>
          <span className="mt-0.5 text-sm font-bold text-success tabular-nums">
            {data.sectors.length > 0
              ? (
                  data.sectors.reduce((sum, s) => sum + (100 - s.unownedPercent), 0) /
                  data.sectors.length
                ).toFixed(1)
              : "0.0"}
            %
          </span>
        </div>
      </div>

      {/* Primary control — pick a sector; the detail below is that sector.
          The full tile grid moved to "State sector breakdown" at the bottom
          (both selectors drive `selectedType`, so they stay in sync). */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[220px] flex-1">
          <span className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-muted">
            Sector
          </span>
          <select
            aria-label="Select sector"
            value={selectedType}
            onChange={(e) => selectSector(e.target.value as CorporationType)}
            className="w-full cursor-pointer rounded-lg border border-card-border bg-background px-3 py-2 text-sm font-medium focus:border-primary/60 focus:outline-none"
          >
            {[...data.sectors]
              .sort((a, b) => b.totalMarket - a.totalMarket)
              .map((s) => (
                <option key={s.type} value={s.type}>
                  {s.label} · {fmtMarketChip(s.totalMarket)}/day
                </option>
              ))}
          </select>
        </div>
        <Link
          href={`${stockmarketUrl(countryId)}?tab=commodities`}
          className="pb-2 text-xs text-primary hover:underline"
        >
          View Commodity Prices &rarr;
        </Link>
      </div>

      {/* Selected sector detail header */}
      <div className="flex flex-wrap items-center gap-2.5">
        <h3 className="text-lg font-bold text-foreground">{sector.label}</h3>
        {specializationBonus > 0 && (
          <span
            className="inline-flex items-center gap-1 rounded-full border border-gold/35 bg-gold/10 px-2.5 py-0.5 text-[11px] font-semibold text-gold"
            title={`${CORPORATION_TYPE_LABELS[selectedType]} sectors in ${data.stateName} receive a +${specializationBonus}pp regional profit margin bonus`}
          >
            ★ {data.sectorSpecializations?.primary === selectedType ? "Primary" : "Secondary"}{" "}
            specialization · +{specializationBonus}pp margin
          </span>
        )}
      </div>

      {/* National context cross-link — same totals the national page renders */}
      {(() => {
        const nationalTotal = data.nationalSectorTotals?.[selectedType];
        if (nationalTotal == null || nationalTotal <= 0 || sector.totalMarket <= 0) return null;
        const share = Math.min(100, (sector.totalMarket / nationalTotal) * 100);
        return (
          <div className="-mt-3 flex flex-wrap items-center gap-1.5 text-[11.5px] text-muted">
            <span>
              {data.stateName} holds{" "}
              <strong className="font-mono font-bold text-foreground">≈{share.toFixed(1)}%</strong>{" "}
              of the national {sector.label} market
            </span>
            <span aria-hidden>·</span>
            <Link
              href={economyUrl(countryId)}
              title="Opens the national Economic Outlook with the full sector mix"
              className="font-semibold text-primary hover:underline"
            >
              National {sector.label} view &rarr;
            </Link>
          </div>
        );
      })()}

      {/* Commodity badges for selected sector */}
      {(() => {
        const supplies = SECTOR_SUPPLY[selectedType] ?? [];
        const demands = SECTOR_DEMAND[selectedType] ?? [];
        if (supplies.length === 0 && demands.length === 0) return null;
        return (
          <div className="flex flex-wrap gap-2">
            {supplies.map((s) => (
              <span
                key={`s-${s.commodity}`}
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${COMMODITY_COLORS[s.commodity]}`}
                title={`Supplies ${COMMODITY_LABELS[s.commodity]} (${Math.round(s.rate * 100)}% of revenue)`}
              >
                <span className="font-bold">{COMMODITY_ICONS[s.commodity]}</span>
                <span className="text-success">+{Math.round(s.rate * 100)}%</span>
              </span>
            ))}
            {demands.map((d) => (
              <span
                key={`d-${d.commodity}`}
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${COMMODITY_COLORS[d.commodity]}`}
                title={`Demands ${COMMODITY_LABELS[d.commodity]} (${Math.round(d.rate * 100)}% of revenue)`}
              >
                <span className="font-bold">{COMMODITY_ICONS[d.commodity]}</span>
                <span className="text-error">-{Math.round(d.rate * 100)}%</span>
              </span>
            ))}
          </div>
        );
      })()}

      {/* Resource availability chips — extraction only */}
      {selectedType === "extraction" && data.stateResources != null && (
        <div className="space-y-1.5">
          <p className="text-xs text-muted font-medium">Resource deposits in this state:</p>
          <div className="flex flex-wrap gap-2">
            {EXTRACTABLE_RESOURCES.map((resource) => {
              const capacity = data.stateResources![resource] ?? 0;
              const available = capacity > 0;
              const unit = COMMODITY_UNITS[resource] ?? "";
              return (
                <span
                  key={resource}
                  className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                    available
                      ? (COMMODITY_COLORS[resource] ?? "bg-card border-card-border text-foreground")
                      : "border-card-border bg-card text-muted opacity-50"
                  }`}
                  title={
                    available ? `${capacity.toLocaleString("en-US")} ${unit}/turn` : "No deposits"
                  }
                >
                  <span className="font-bold">{COMMODITY_ICONS[resource]}</span>
                  <span>{COMMODITY_LABELS[resource]}</span>
                  {available && (
                    <span className="text-success">
                      {capacity >= 1000
                        ? `${(capacity / 1000).toFixed(1)}K`
                        : capacity.toLocaleString("en-US")}
                    </span>
                  )}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* Sector overview card */}
      <div className="rounded-xl border border-card-border bg-card p-6">
        {/* Market share pie chart */}
        <div className="mb-4 flex flex-col sm:flex-row items-center gap-4">
          <div className="shrink-0">
            <MarketSharePie owners={pieOwners} unownedPercent={sector.unownedPercent} />
          </div>
          <div className="flex-1 space-y-1.5 text-xs w-full">
            <div className="flex justify-between text-muted">
              <Tooltip content={marketCurrencyNote}>
                <span className="cursor-help border-b border-dashed border-card-border/70">
                  Total Market
                </span>
              </Tooltip>
              <span className="font-medium text-foreground">
                {fmtMarketChip(sector.totalMarket)}/day
              </span>
            </div>
            {pieOwners.map((owner, i) => (
              <div key={owner.sectorId} className="flex items-center gap-2">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full shrink-0"
                  style={{
                    backgroundColor:
                      owner.brandColor || DEFAULT_CORP_COLORS[i % DEFAULT_CORP_COLORS.length],
                  }}
                />
                {owner.isNpp && owner.sectorId === NPP_AGGREGATE_ID ? (
                  // Legacy non-attackable aggregate slice (flag off).
                  <span className="text-muted truncate">{owner.corporationName}</span>
                ) : (
                  <Link
                    href={`/corporation/${owner.corporationSequentialId ?? owner.corporationId}/sector/${owner.sectorId}`}
                    className="text-primary hover:underline truncate"
                  >
                    {owner.displayName ?? owner.corporationName}
                  </Link>
                )}
                <span className="ml-auto tabular-nums text-foreground font-medium">
                  {owner.marketShare}%
                </span>
              </div>
            ))}
            {sector.unownedPercent > 0 && (
              <div className="flex items-center gap-2">
                <span className="inline-block h-2.5 w-2.5 rounded-full shrink-0 bg-muted/30" />
                <span className="text-muted">Unowned</span>
                <span className="ml-auto tabular-nums text-muted font-medium">
                  {sector.unownedPercent.toFixed(1)}%
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div>
            <Tooltip content={marketCurrencyNote}>
              <span className="block w-fit cursor-help border-b border-dashed border-card-border/70 text-[10px] uppercase tracking-widest text-muted font-medium">
                Owned Revenue
              </span>
            </Tooltip>
            <span className="text-sm font-bold text-success tabular-nums">
              {fmtMarket(sector.ownedRevenue)}
              <span className="text-[10px] font-normal text-muted">/day</span>
            </span>
          </div>
          <div>
            <Tooltip content={marketCurrencyNote}>
              <span className="block w-fit cursor-help border-b border-dashed border-card-border/70 text-[10px] uppercase tracking-widest text-muted font-medium">
                Unowned Revenue
              </span>
            </Tooltip>
            <span className="text-sm font-bold text-foreground tabular-nums">
              {fmtMarket(sector.unownedRevenue)}
              <span className="text-[10px] font-normal text-muted">/day</span>
            </span>
          </div>
          <div>
            <span className="block text-[10px] uppercase tracking-widest text-muted font-medium">
              Corporations
            </span>
            <span className="text-sm font-bold text-foreground">{playerOwners.length}</span>
          </div>
          <div>
            <span className="block text-[10px] uppercase tracking-widest text-muted font-medium">
              Market Control
            </span>
            <span className="text-sm font-bold text-primary tabular-nums">
              {ownedPercent.toFixed(1)}%
            </span>
          </div>
        </div>
      </div>

      {/* Attack feedback */}
      {attackError && (
        <div className="rounded-lg border border-error/30 bg-error/10 p-3 text-sm text-error">
          {attackError}
        </div>
      )}
      {attackMsg && (
        <div className="rounded-lg border border-success/30 bg-success/10 p-3 text-sm text-success">
          {attackMsg}
        </div>
      )}
      {/* Growth adjust feedback */}
      {adjustError && (
        <div className="rounded-lg border border-error/30 bg-error/10 p-3 text-sm text-error">
          {adjustError}
        </div>
      )}
      {adjustMsg && (
        <div className="rounded-lg border border-success/30 bg-success/10 p-3 text-sm text-success">
          {adjustMsg}
        </div>
      )}

      {/* Sector cards */}
      <div className="space-y-3">
        <h4 className="text-sm font-bold text-foreground">Market Participants</h4>

        {/* Owned sector cards — NPP corps hidden (aggregated into the pie, t834) */}
        {(() => {
          const sortedOwners = [...playerOwners].sort((a, b) => b.marketShare - a.marketShare);
          const showToggle = sortedOwners.length > 3;
          const visibleOwners =
            showToggle && !participantsExpanded ? sortedOwners.slice(0, 3) : sortedOwners;
          return (
            <>
              {visibleOwners.map((owner, i) => {
                const isOwn =
                  data.userCorporationId != null && owner.corporationId === data.userCorporationId;
                const revenue = owner.revenue;
                const revenueDisclosed = revenue != null;
                const adjustCost = revenueDisclosed
                  ? Math.round(revenue * GROWTH_ADJUST_COST_PER_PERCENT)
                  : 0;
                const canExpand = owner.targetGrowthRate < MAX_GROWTH_RATE;
                const canDownsize = owner.targetGrowthRate > MIN_GROWTH_RATE;
                const color =
                  owner.brandColor || DEFAULT_CORP_COLORS[i % DEFAULT_CORP_COLORS.length];

                return (
                  <div
                    key={owner.sectorId}
                    className="rounded-xl border border-card-border bg-card overflow-hidden"
                    style={{ borderLeftWidth: "4px", borderLeftColor: color }}
                  >
                    {/* Header: name + badges + market share */}
                    <div className="flex items-start justify-between px-4 pt-4 pb-3">
                      <div className="flex items-start gap-3 min-w-0">
                        {/* Corp logo / color initial */}
                        <Link
                          href={`/corporation/${owner.corporationSequentialId ?? owner.corporationId}`}
                          className="shrink-0 mt-0.5"
                          tabIndex={-1}
                        >
                          <CorporationLogo
                            logoUrl={owner.logoUrl}
                            name={owner.displayName ?? owner.corporationName}
                            size="h-9 w-9"
                            className="rounded-lg border border-white/10"
                          />
                        </Link>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Link
                              href={`/corporation/${owner.corporationSequentialId ?? owner.corporationId}/sector/${owner.sectorId}`}
                              className="font-semibold text-foreground hover:text-primary text-sm leading-tight transition-colors"
                            >
                              {owner.displayName ?? owner.corporationName}
                            </Link>
                            {owner.isNatcorp && (
                              <span className="px-1.5 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/30 text-amber-400 uppercase text-[9px] tracking-wide font-semibold">
                                State-Owned
                              </span>
                            )}
                            {owner.forSale && (
                              <span
                                className="inline-flex items-center rounded-md border border-success/40 bg-success/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-success"
                                title={`For sale at ${formatAmount(owner.forSale.priceAnchor)}`}
                              >
                                For Sale · {formatAmount(owner.forSale.priceAnchor)}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 mt-1">
                            {owner.displayName && (
                              <span className="text-[11px] text-muted">
                                {owner.corporationName}
                                {owner.sectorLabel && owner.sectorLabel !== sector.label
                                  ? ` · ${owner.sectorLabel}`
                                  : ""}
                              </span>
                            )}
                            <Link
                              href={`/corporation/${owner.corporationSequentialId ?? owner.corporationId}/sector/${owner.sectorId}`}
                              className="text-[11px] text-muted hover:text-primary transition-colors"
                            >
                              Details &rarr;
                            </Link>
                          </div>
                        </div>
                      </div>
                      <div className="text-right shrink-0 ml-4">
                        <div
                          className="text-xl font-bold tabular-nums leading-none"
                          style={{ color }}
                        >
                          {owner.marketShare}%
                        </div>
                        <div className="text-[10px] text-muted uppercase tracking-wide mt-0.5">
                          share
                        </div>
                      </div>
                    </div>

                    {/* Stats row */}
                    <div className="flex border-t border-card-border/40 divide-x divide-card-border/40">
                      <div className="flex flex-col px-4 py-2.5">
                        <span className="text-[10px] uppercase tracking-wide text-muted mb-1">
                          CEO
                        </span>
                        <div className="flex items-center gap-1.5">
                          {owner.ceoCountryId && (
                            <Image
                              src={getCountryFlagUrlForEra(owner.ceoCountryId, preset, 40)}
                              alt={owner.ceoCountryId.toUpperCase()}
                              width={16}
                              height={12}
                              className="rounded-sm object-cover shrink-0"
                              sizes="16px"
                              unoptimized
                            />
                          )}
                          <Link
                            href={`/character/${owner.ceoSequentialId}`}
                            className="text-xs text-primary hover:underline leading-tight"
                          >
                            {owner.ceoName}
                          </Link>
                        </div>
                      </div>
                      <div className="flex flex-col px-4 py-2.5">
                        <span className="text-[10px] uppercase tracking-wide text-muted mb-1">
                          Revenue
                        </span>
                        <span className="text-xs font-semibold text-success tabular-nums leading-tight">
                          {revenueDisclosed ? `${fmtMarket(revenue)}/day` : "Not disclosed"}
                        </span>
                      </div>
                      <div
                        className="flex flex-col px-4 py-2.5"
                        title={`Growth targets revenue change over ${GROWTH_RATE_TURNS_PER_YEAR} turns (one game year)`}
                      >
                        <span className="text-[10px] uppercase tracking-wide text-muted mb-1">
                          Growth
                        </span>
                        <span className="text-xs font-medium leading-tight">
                          <span className="text-foreground">{owner.targetGrowthRate}%</span>
                          <span className="text-muted"> /yr</span>
                        </span>
                      </div>
                      <div
                        className="flex flex-col px-4 py-2.5"
                        title="CEO-set output level (−25% to +25%); the active level trends toward the target at 1 point per turn. Sustained negative production erodes profit margins over time."
                      >
                        <span className="text-[10px] uppercase tracking-wide text-muted mb-1">
                          Production
                        </span>
                        <span className="inline-flex items-center gap-1.5 leading-tight">
                          <span
                            className={`text-xs font-medium tabular-nums ${
                              productionTone(owner.productionLevel ?? 0) === "error"
                                ? "text-error"
                                : productionTone(owner.productionLevel ?? 0) === "success"
                                  ? "text-success"
                                  : "text-foreground"
                            }`}
                          >
                            {formatProductionLevel(owner.productionLevel ?? 0)}
                          </span>
                          <span className="inline-block h-1 w-8 overflow-hidden rounded-full bg-track">
                            <span
                              className={`block h-full rounded-full ${
                                productionTone(owner.productionLevel ?? 0) === "error"
                                  ? "bg-error"
                                  : productionTone(owner.productionLevel ?? 0) === "success"
                                    ? "bg-success"
                                    : "bg-secondary"
                              }`}
                              style={{
                                width: `${productionFillPercent(owner.productionLevel ?? 0)}%`,
                              }}
                            />
                          </span>
                        </span>
                      </div>
                    </div>

                    {/* Under plants the growth slider is vestigial — capacity is
                        the growth lever — so an owned sector's row links straight
                        to the sector page's Build Capacity dialog (`?build=1`)
                        instead of the +1%/-1% controls below. Without this the
                        state page offered owners no way to build at all. */}
                    {isOwn && data.plantsMode && (
                      <div className="flex items-center justify-end border-t border-card-border/50 px-4 py-2">
                        <Link
                          href={`/corporation/${owner.corporationSequentialId ?? owner.corporationId}/sector/${owner.sectorId}?build=1`}
                          className="rounded-lg border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary transition-colors hover:bg-primary/20"
                        >
                          Build capacity
                        </Link>
                      </div>
                    )}

                    {/* Growth controls for own sectors. Hidden under plants:
                        the turn processor zeroes targetGrowthRate every turn
                        there, so paying for +1% buys nothing. Capacity is the
                        growth lever, via Build Capacity on the sector page. */}
                    {isOwn && !data.plantsMode && (
                      <div className="flex items-center justify-end gap-2 border-t border-card-border/50 px-4 py-2">
                        <span className="text-[10px] text-muted mr-auto">
                          Adjust growth: {formatAmount(adjustCost)}/1%
                        </span>
                        <button
                          onClick={() => handleAdjustGrowth(owner.sectorId, "downsize")}
                          disabled={!canDownsize || adjustingId === owner.sectorId}
                          className="rounded border border-card-border px-2 py-0.5 text-xs font-medium text-muted hover:text-foreground hover:border-foreground/30 transition-colors disabled:opacity-40"
                          title={
                            canDownsize
                              ? `Downsize -1% (returns ${formatAmount(adjustCost)})`
                              : "Already at minimum growth"
                          }
                        >
                          {adjustingId === owner.sectorId ? "..." : "-1%"}
                        </button>
                        <button
                          onClick={() => handleAdjustGrowth(owner.sectorId, "expand")}
                          disabled={!canExpand || adjustingId === owner.sectorId}
                          className="rounded border border-primary/30 bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary hover:bg-primary/20 transition-colors disabled:opacity-40"
                          title={
                            canExpand
                              ? `Expand +1% (costs ${formatAmount(adjustCost)})`
                              : "Already at maximum growth"
                          }
                        >
                          {adjustingId === owner.sectorId ? "..." : "+1%"}
                        </button>
                      </div>
                    )}

                    {/* Attack controls for other corps' sectors (not natcorps) */}
                    {!isOwn &&
                      !owner.isNatcorp &&
                      data.userCorporationId &&
                      owner.attackCost != null &&
                      owner.attackCost > 0 && (
                        <div className="flex items-center justify-between gap-4 border-t border-card-border/50 px-4 py-2">
                          <div className="flex items-center gap-3 text-xs text-muted flex-wrap">
                            <span>
                              Cost:{" "}
                              <span className="text-foreground font-medium">
                                {formatAmount(owner.attackCost)}
                              </span>{" "}
                              +{" "}
                              <span className="text-foreground font-medium">
                                {data.attackMsCost ?? data.splitMsCost} MS
                              </span>
                            </span>
                            {owner.attackEstimatedCapture != null &&
                              owner.attackEstimatedCapture > 0 && (
                                <span>
                                  Est. capture:{" "}
                                  <span className="text-success font-medium">
                                    {formatAmount(owner.attackEstimatedCapture)}
                                  </span>
                                </span>
                              )}
                          </div>
                          <button
                            onClick={() => handleAttackSector(owner.sectorId)}
                            disabled={
                              attackingId === owner.sectorId ||
                              data.userMarketingStrength < (data.attackMsCost ?? data.splitMsCost)
                            }
                            className="rounded border border-error/30 bg-error/10 px-3 py-1 text-xs font-medium text-error hover:bg-error/20 transition-colors disabled:opacity-40 shrink-0"
                            title={
                              data.userMarketingStrength < (data.attackMsCost ?? data.splitMsCost)
                                ? `Need ${data.attackMsCost ?? data.splitMsCost} MS, have ${formatMarketingStrength(data.userMarketingStrength)}`
                                : "Attack this sector — capture based on your MS vs theirs"
                            }
                          >
                            {attackingId === owner.sectorId ? "Attacking…" : "Attack"}
                          </button>
                        </div>
                      )}
                  </div>
                );
              })}

              {/* Show all / collapse toggle for 4+ participants */}
              {showToggle && (
                <button
                  onClick={() => setParticipantsExpanded((v) => !v)}
                  className="w-full rounded-lg border border-card-border bg-card px-4 py-2 text-xs font-medium text-primary hover:bg-primary/5 transition-colors"
                >
                  {participantsExpanded
                    ? "Show top 3 only"
                    : `Show all ${sortedOwners.length} participants`}
                </button>
              )}
            </>
          );
        })()}

        {/* Unowned sector card.
            Under plants this stops being a pool of money sitting unclaimed and
            becomes what it actually is: demand in this market that nobody is
            currently serving. The pie still works — capacity shares and revenue
            shares are the same partition of the same market — but the headline
            number changes from "% share of a pool" to "units/day nobody is
            meeting", because that is the figure a player sizes a build against. */}
        {sector.unownedRevenue > 0 && (
          <div
            className={`rounded-xl border bg-card overflow-hidden ${
              data.plantsMode ? "border-primary/30" : "border-card-border"
            }`}
            style={{
              borderLeftWidth: "4px",
              borderLeftColor: data.plantsMode
                ? "var(--color-primary, rgba(128,128,128,0.25))"
                : "rgba(128,128,128,0.25)",
            }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 pt-4 pb-3">
              <span
                className={`font-semibold text-sm ${data.plantsMode ? "text-foreground" : "text-muted"}`}
              >
                {data.plantsMode ? "Untapped Market" : "Unowned Market"}
              </span>
              <div className="text-right">
                <div
                  className={`text-xl font-bold tabular-nums leading-none ${data.plantsMode ? "text-primary" : "text-muted"}`}
                >
                  {data.plantsMode
                    ? formatUnits(sector.headroomUnits)
                    : `${sector.unownedPercent.toFixed(1)}%`}
                </div>
                <div className="text-[10px] text-muted uppercase tracking-wide mt-0.5">
                  {data.plantsMode ? CAPACITY_UNIT_LABEL : "share"}
                </div>
              </div>
            </div>

            {data.plantsMode && (
              <p className="px-4 pb-3 text-xs leading-snug text-muted">
                About {formatUnits(sector.headroomUnits)} {CAPACITY_UNIT_LABEL} of in-state demand
                in {data.stateName} has no plant serving it. That is{" "}
                {sector.unownedPercent.toFixed(1)}% of this state&apos;s market — not national or
                global.
              </p>
            )}

            {/* Stats row */}
            <div className="flex border-t border-card-border/40">
              <div className="flex flex-col px-4 py-2.5">
                <span className="text-[10px] uppercase tracking-wide text-muted mb-1">
                  {data.plantsMode ? "Worth" : "Revenue"}
                </span>
                <span className="text-xs font-semibold text-muted tabular-nums leading-tight">
                  {fmtMarket(sector.unownedRevenue)}/day
                </span>
              </div>
            </div>

            {/* Build-here affordance. Deep-links into the corp expand modal with
                this state + sector type preselected so the player is not dumped
                on a bare sectors tab. */}
            {data.plantsMode && data.userCorporationId && (
              <div className="border-t border-card-border/50 px-4 py-3">
                <Link
                  href={`/corporation/${data.userCorporationId}?tab=sectors&expand=1&state=${encodeURIComponent(stateId)}&sectorType=${encodeURIComponent(selectedType)}`}
                  className="block w-full rounded-lg border border-primary/30 bg-primary/10 px-4 py-2 text-center text-sm font-semibold text-primary transition-colors hover:bg-primary/20"
                >
                  Build here
                </Link>
              </div>
            )}

            {/* Split controls — legacy unowned-pool capture. Hidden under plants;
                capacity is built, not split. */}
            {!data.plantsMode && data.userCorporationId && sector.splitCost > 0 && (
              <div className="border-t border-card-border/50">
                {splitError && (
                  <div className="mx-4 mt-2 rounded-lg border border-error/30 bg-error/10 p-2 text-xs text-error">
                    {splitError}
                  </div>
                )}
                {splitMsg && (
                  <div className="mx-4 mt-2 rounded-lg border border-success/30 bg-success/10 p-2 text-xs text-success">
                    {splitMsg}
                  </div>
                )}

                {/* Strength selector */}
                <div className="px-4 pt-2">
                  <div className="mb-1 text-[10px] uppercase tracking-wider text-muted">
                    Split strength
                  </div>
                  <div className="flex gap-1 max-w-[200px]">
                    <button
                      onClick={() => setSplitStrength("full")}
                      className={`flex-1 rounded-md border px-2 py-1 text-xs font-medium transition-colors ${
                        splitStrength === "full"
                          ? "border-primary/60 bg-primary/15 text-primary"
                          : "border-card-border/60 bg-background text-muted hover:text-foreground"
                      }`}
                    >
                      Full
                    </button>
                    <button
                      onClick={() => setSplitStrength("half")}
                      className={`flex-1 rounded-md border px-2 py-1 text-xs font-medium transition-colors ${
                        splitStrength === "half"
                          ? "border-primary/60 bg-primary/15 text-primary"
                          : "border-card-border/60 bg-background text-muted hover:text-foreground"
                      }`}
                    >
                      Half
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-4 px-4 py-2">
                  <div className="flex items-center gap-3 text-xs text-muted flex-wrap">
                    <span>
                      Cost:{" "}
                      <span className="text-foreground font-medium">
                        {formatAmount(
                          splitStrength === "half"
                            ? Math.round(sector.splitCost * 0.5)
                            : sector.splitCost
                        )}
                      </span>{" "}
                      +{" "}
                      <span className="text-foreground font-medium">
                        {splitStrength === "half"
                          ? Math.max(1, Math.floor(data.splitMsCost * 0.5))
                          : data.splitMsCost}{" "}
                        MS
                      </span>
                    </span>
                    <span>
                      Est. capture:{" "}
                      <span className="text-success font-medium">
                        {formatAmount(
                          splitStrength === "half"
                            ? Math.round(sector.estimatedCapture * 0.5)
                            : sector.estimatedCapture
                        )}
                        /day
                      </span>
                      {sector.unownedRevenue > 0 && (
                        <span className="text-muted ml-1">
                          (
                          {Math.round(
                            ((splitStrength === "half"
                              ? Math.round(sector.estimatedCapture * 0.5)
                              : sector.estimatedCapture) /
                              sector.unownedRevenue) *
                              100
                          )}
                          % of unowned)
                        </span>
                      )}
                    </span>
                  </div>
                  <button
                    onClick={() => handleSplit(splitStrength)}
                    disabled={
                      splitting ||
                      data.userMarketingStrength <
                        (splitStrength === "half"
                          ? Math.max(1, Math.floor(data.splitMsCost * 0.5))
                          : data.splitMsCost)
                    }
                    className="rounded border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary hover:bg-primary/20 transition-colors disabled:opacity-40 shrink-0"
                    title={
                      data.userMarketingStrength <
                      (splitStrength === "half"
                        ? Math.max(1, Math.floor(data.splitMsCost * 0.5))
                        : data.splitMsCost)
                        ? `Need ${splitStrength === "half" ? Math.max(1, Math.floor(data.splitMsCost * 0.5)) : data.splitMsCost} MS, have ${formatMarketingStrength(data.userMarketingStrength)}`
                        : undefined
                    }
                  >
                    {splitting ? "Splitting..." : `Split${splitStrength !== "full" ? " Half" : ""}`}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* All visible (player) owners hidden because the sector is entirely
            NPP-run — note it rather than showing a blank table (t834). */}
        {playerOwners.length === 0 && sector.owners.length > 0 && (
          <div className="rounded-xl border border-card-border bg-card p-4 text-center text-xs text-muted">
            {sector.owners.length} NPP-run corporation{sector.owners.length === 1 ? "" : "s"} —
            grouped in the chart above.
          </div>
        )}

        {/* Empty state */}
        {sector.owners.length === 0 && sector.unownedRevenue === 0 && (
          <div className="rounded-xl border border-card-border bg-card p-6 text-center text-sm text-muted">
            No market activity in this sector.
          </div>
        )}
      </div>

      {/* Secondary detail — collapsed by default so the page stays focused on the
          selected sector. The full sector grid still selects (kept in sync with
          the dropdown above via `selectedType`) once expanded. */}
      <CollapsibleSection title="State sector breakdown" subtitle="all sectors by market size">
        <SectorBoard
          tiles={boardTiles}
          selectedType={selectedType}
          onSelect={selectSector}
          formatMarket={fmtMarketChip}
          showAllTiles
        />
      </CollapsibleSection>

      {/* National economic model (P7) — economic models are national only; this is
          the nation's model that governs every region. */}
      <CollapsibleSection title="National economic model">
        <EconomicModelCard countryId={countryId} />
      </CollapsibleSection>
    </div>
  );
}

/**
 * Collapsed-by-default section: a header button that reveals its content when
 * opened. Native `<details>` so it works without JS and matches the disclosure
 * pattern used elsewhere in the app. Used for the lower-priority breakdowns at
 * the bottom of the state economy page.
 */
function CollapsibleSection({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <details className="group space-y-2.5">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl border border-card-border bg-card px-4 py-3 transition-colors hover:border-foreground/30 [&::-webkit-details-marker]:hidden">
        <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-sm font-bold text-foreground">{title}</span>
          {subtitle && <span className="text-xs font-normal text-muted">· {subtitle}</span>}
        </span>
        <span className="flex shrink-0 items-center gap-1.5 text-[11px] font-medium text-muted">
          <span className="group-open:hidden">Show</span>
          <span className="hidden group-open:inline">Hide</span>
          <svg
            className="h-4 w-4 transition-transform group-open:rotate-180"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden
          >
            <path
              fillRule="evenodd"
              d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.17l3.71-3.94a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z"
              clipRule="evenodd"
            />
          </svg>
        </span>
      </summary>
      <div>{children}</div>
    </details>
  );
}

/** SVG donut pie chart showing market share breakdown */
/** Violet slice used for the aggregated NPP-corporations entry. */
const NPP_AGGREGATE_COLOR = "#8b5cf6";
const NPP_AGGREGATE_ID = "__npp_aggregate__";

/**
 * Split a sector's owners for display (t834). NPP-run corps collapse into a
 * single synthetic "NPP Corporations (N)" owner for the pie + legend, and are
 * dropped entirely from `playerOwners` (the ownership table). Player corps are
 * returned untouched and keep their sort order; the aggregate slice is appended
 * last. When a sector has no NPP corps, `pieOwners === players` unchanged.
 */
function splitNppOwners(owners: SectorOwner[]): {
  pieOwners: SectorOwner[];
  playerOwners: SectorOwner[];
} {
  const players = owners.filter((o) => !o.isNpp);
  const npps = owners.filter((o) => o.isNpp);
  if (npps.length === 0) return { pieOwners: owners, playerOwners: owners };
  const nppShare = Math.round(npps.reduce((s, o) => s + o.marketShare, 0) * 100) / 100;
  const aggregate: SectorOwner = {
    sectorId: NPP_AGGREGATE_ID,
    corporationId: NPP_AGGREGATE_ID,
    corporationName: `NPP Corporations (${npps.length})`,
    brandColor: NPP_AGGREGATE_COLOR,
    ceoName: "",
    revenue: null,
    marketShare: nppShare,
    workers: null,
    targetGrowthRate: 0,
    currentGrowthRate: 0,
    isNpp: true,
  };
  return {
    pieOwners: nppShare > 0 ? [...players, aggregate] : players,
    playerOwners: players,
  };
}

function MarketSharePie({
  owners,
  unownedPercent,
}: {
  owners: SectorOwner[];
  unownedPercent: number;
}) {
  const size = 120;
  const radius = 48;
  const cx = size / 2;
  const cy = size / 2;
  const strokeWidth = 24;

  // Build segments: owners + unowned
  const segments: { percent: number; color: string; label: string }[] = [];
  owners.forEach((owner, i) => {
    if (owner.marketShare > 0) {
      segments.push({
        percent: owner.marketShare,
        color: owner.brandColor || DEFAULT_CORP_COLORS[i % DEFAULT_CORP_COLORS.length],
        label: owner.corporationName,
      });
    }
  });
  if (unownedPercent > 0) {
    segments.push({
      percent: unownedPercent,
      color: "#6b7280",
      label: "Unowned",
    });
  }

  // Calculate SVG arc paths
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {segments.map((seg, i) => {
        const dashLength = (seg.percent / 100) * circumference;
        const dashOffset = -offset;
        offset += dashLength;
        return (
          <circle
            key={i}
            cx={cx}
            cy={cy}
            r={radius}
            fill="none"
            stroke={seg.color}
            strokeWidth={strokeWidth}
            strokeDasharray={`${dashLength} ${circumference - dashLength}`}
            strokeDashoffset={dashOffset}
            transform={`rotate(-90 ${cx} ${cy})`}
          >
            <title>{`${seg.label}: ${seg.percent.toFixed(1)}%`}</title>
          </circle>
        );
      })}
      {/* Center text */}
      <text
        x={cx}
        y={cy - 4}
        textAnchor="middle"
        className="fill-foreground text-sm font-bold"
        fontSize="14"
      >
        {(100 - unownedPercent).toFixed(0)}%
      </text>
      <text x={cx} y={cy + 10} textAnchor="middle" className="fill-muted text-[9px]" fontSize="9">
        owned
      </text>
    </svg>
  );
}
