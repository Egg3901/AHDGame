"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CORPORATION_TYPES,
  CORPORATION_TYPE_LABELS,
  type CorporationType,
  SPRAWL_SECTOR_THRESHOLD,
  SPRAWL_PENALTY_PER_PAIR,
  LOGISTICS_MAX_SPRAWL_EFFECT,
  getSprawlModifier,
} from "@/lib/constants/corporations";
import {
  MONEY_PERIODS,
  MONEY_PERIOD_FACTOR,
  MONEY_PERIOD_HELP,
  MONEY_PERIOD_LABEL,
  MONEY_PERIOD_SUFFIX,
  type MoneyPeriod,
} from "@/lib/constants/moneyTimescale";
import { useCurrency } from "@/contexts/CurrencyContext";
import type { SectorDetail } from "./CorporationPageTypes";
import ExpandMarketModal from "./ExpandMarketModal";
import { SectorTableHeader, sectorTableGrid } from "./SectorTableHeader";
import { SectorRow } from "./SectorRow";
import {
  sortSectors,
  sortOptionsFor,
  sumSectorDisplayRevenue,
  type SectorSortKey,
  type SortDir,
} from "./sectorSortUtils";
import { CAPACITY_UNIT_LABEL, FillChip, formatUnits } from "./plantsPresentation";
import { computeFillRate, fillRateBand } from "@/lib/corporations/financialFogOfWar";
import { hexAlpha, sectorTypePalette } from "@/lib/constants/sectorTypeDossier";
import {
  buildOnePhrase,
  capitalizeFacility,
  facilityPlural,
} from "@/lib/constants/facilityVocabulary";
import { SectorTypeDossier } from "./SectorTypeDossier";
import { SectorStrategyPanel } from "./SectorStrategyPanel";
import type { SectorTypeMetricContext } from "./sectorTypeMetrics";

const SELECT_CLASSES =
  "min-w-[11rem] max-w-full rounded-lg border border-card-border bg-card px-3 py-2 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";

interface SectorsTabProps {
  sectors: SectorDetail[];
  isCeo: boolean;
  corpId: string;
  /** Primary corporation type — used for expand modal type pre-selection */
  corporationType: CorporationType;
  /** Secondary corporation type — may be null */
  corporationSecondaryType?: CorporationType | null;
  /** Corporation liquid capital — used for afford checks in expand modal */
  liquidCapital: number;
  /** Corp currency code for all per-sector money fields (v0.2.6). */
  liquidCurrencyCode?: string | null;
  /** Corporation logistics strength — used for sprawl penalty display */
  logisticsStrength: number;
  onAbandonSector: (sectorId: string) => void;
  abandoningSectorId: string | null;
  sectorsMessage: { type: "error" | "success"; text: string } | null;
  onStrategyChange?: (sectorId: string, strategyId: string) => void;
  strategyUpdatingSectorId?: string | null;
  onGrowthChange?: (sectorId: string, newRate: number) => void;
  growthUpdatingSectorId?: string | null;
  onCancelTransition?: (sectorId: string) => void;
  cancelTransitionSectorId?: string | null;
  currentTurn: number;
  periodView?: MoneyPeriod;
  onPeriodViewChange?: (v: MoneyPeriod) => void;
  /**
   * Plants tier: sectors are plants you build, so the table swaps its growth
   * columns for Capacity and Fill. Defaults false so every non-plants world
   * renders byte-identically to before.
   */
  plantsMode?: boolean;
  /** Deep-link from state board: open expand modal on mount. */
  expandOnMount?: boolean;
  /** Deep-link: preselect this sector type in the expand modal. */
  expandSectorType?: CorporationType;
  /** Deep-link: focus this state once suggestions load. */
  expandStateId?: string;
  /** Called after consuming expand deep-link params (clear URL). */
  onExpandDeepLinkConsumed?: () => void;
}

export default function SectorsTab({
  sectors,
  isCeo,
  corpId,
  corporationType,
  corporationSecondaryType,
  liquidCapital,
  liquidCurrencyCode,
  logisticsStrength,
  onAbandonSector,
  abandoningSectorId,
  sectorsMessage,
  onStrategyChange,
  strategyUpdatingSectorId,
  onGrowthChange,
  growthUpdatingSectorId,
  onCancelTransition,
  cancelTransitionSectorId: _cancelTransitionSectorId,
  currentTurn,
  periodView: periodViewProp,
  onPeriodViewChange,
  plantsMode = false,
  expandOnMount = false,
  expandSectorType,
  expandStateId,
  onExpandDeepLinkConsumed,
}: SectorsTabProps) {
  const { formatAmount, toInternalFrom } = useCurrency();
  // Post-v0.2.6: sector revenue / profit / growthCost are in corp currency.
  const liquidCode =
    (liquidCurrencyCode as import("@/lib/constants/currencies").CurrencyCode | null | undefined) ??
    undefined;
  const fmtMoney = (val: number) => {
    const anchor = liquidCode ? toInternalFrom(val, liquidCode) : val;
    return formatAmount(anchor, liquidCode);
  };
  // ₳-anchored amounts (e.g. for-sale listing price) skip the local→anchor pre-conversion.
  const fmtAnchor = (val: number) => formatAmount(val, liquidCode);

  const sortOptions = sortOptionsFor(plantsMode);
  const tableGrid = sectorTableGrid(plantsMode);
  const [sortKey, setSortKey] = useState<SectorSortKey>("location");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [filterText, setFilterText] = useState("");
  const [filterType, setFilterType] = useState<string>("");
  const [openSectorMenuId, setOpenSectorMenuId] = useState<string | null>(null);
  // CEO identity resolves async after /character/me. Initializing open state from
  // `expandOnMount && isCeo` on first paint drops the deep link (ticket #1004).
  const [expandModalOpen, setExpandModalOpen] = useState(false);
  const [deepLinkType] = useState<CorporationType | undefined>(expandSectorType);
  const [deepLinkState] = useState<string | undefined>(expandStateId);
  // Set when the expand flow is opened from a type dossier, so the modal skips
  // the type picker and opens on the division the player was already reading.
  const [expandTypeOverride, setExpandTypeOverride] = useState<CorporationType | undefined>(
    undefined
  );
  const deepLinkHandledRef = useRef(false);

  const openExpandModal = (type?: CorporationType) => {
    setExpandTypeOverride(type);
    setExpandModalOpen(true);
  };

  useEffect(() => {
    if (!expandOnMount || !isCeo || deepLinkHandledRef.current) return;
    const openTimer = window.setTimeout(() => {
      if (deepLinkHandledRef.current) return;
      deepLinkHandledRef.current = true;
      setExpandModalOpen(true);
      onExpandDeepLinkConsumed?.();
    }, 0);
    return () => window.clearTimeout(openTimer);
  }, [expandOnMount, isCeo, onExpandDeepLinkConsumed]);

  const [localPeriodView, setLocalPeriodView] = useState<MoneyPeriod>("turn");
  const timeScale = periodViewProp ?? localPeriodView;
  const setTimeScale = onPeriodViewChange ?? setLocalPeriodView;

  useEffect(() => {
    if (!openSectorMenuId) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest("[data-sector-menu-root]")) return;
      setOpenSectorMenuId(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenSectorMenuId(null);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [openSectorMenuId]);

  const totalSectors = sectors.length;
  const hasSecondaryType = !!corporationSecondaryType;
  const lsFraction = Math.max(0, logisticsStrength) / LOGISTICS_MAX_SPRAWL_EFFECT;
  const effectiveThreshold = Math.round(
    SPRAWL_SECTOR_THRESHOLD + SPRAWL_SECTOR_THRESHOLD * lsFraction
  );
  const effectivePenaltyPerPair =
    SPRAWL_PENALTY_PER_PAIR * (hasSecondaryType ? 2 : 1) * Math.max(0.5, 1 - 0.5 * lsFraction);
  const currentSprawlPenalty = getSprawlModifier(totalSectors, logisticsStrength, hasSecondaryType);

  // Stored money figures are daily (24-turn) rates; moneyTimescale owns the
  // conversion so every surface shows the same number in the same unit.
  const scaleFactor = MONEY_PERIOD_FACTOR[timeScale];
  const scaleLabel = MONEY_PERIOD_SUFFIX[timeScale];

  const sectorTypes = useMemo(() => {
    const types = [...new Set(sectors.map((s) => s.sectorType))].sort();
    return types.map((t) => ({
      value: t,
      label: CORPORATION_TYPE_LABELS[t as CorporationType] ?? t,
      count: sectors.filter((s) => s.sectorType === t).length,
    }));
  }, [sectors]);

  // A type chip does two jobs: it filters the table (the old `All types`
  // select) and it opens that type's dossier. One piece of state drives both,
  // so the heading, the banner and the rows can never disagree about which
  // division you are looking at. Empty means "all sectors".
  // Validated against the types actually owned. Abandoning the last sector of
  // the open division would otherwise leave `filterType` pointing at a type
  // that no longer exists: the rail would snap back to "All sectors" while the
  // table stayed filtered to nothing, showing an empty list with no
  // explanation. Everything downstream reads this, never the raw state.
  // Resolved to the element OUT OF `CORPORATION_TYPES`, not cast from the
  // control's own string. The type filter is set from a `<select>`'s
  // `e.target.value`, and this value goes on to become the expand modal's
  // `initialSectorType`, which the modal interpolates into a link href. Passing
  // the raw string through carried DOM text all the way into a URL
  // (CodeQL js/xss-through-dom); resolving through the constant means what
  // flows onward is a compile-time string. The ownership test stays: it must
  // also be a type this corporation actually operates.
  const dossierType =
    filterType && sectorTypes.some((t) => t.value === filterType)
      ? (CORPORATION_TYPES.find((t) => t === filterType) ?? null)
      : null;
  // Every read of the type filter goes through this, never through the raw
  // state, so a value that has gone stale is simply inert rather than
  // filtering the table down to nothing. Deliberately NOT healed in an effect:
  // synchronously clearing state from an effect cascades a second render on
  // every pass, and there is nothing to heal — the derived value is already
  // correct.
  const activeTypeFilter = dossierType ?? "";
  const dossierSectors = useMemo(
    () => (dossierType ? sectors.filter((s) => s.sectorType === dossierType) : []),
    [sectors, dossierType]
  );
  const metricContext: SectorTypeMetricContext = {
    plantsMode,
    totalSectors,
    logisticsStrength,
    hasSecondaryType,
  };
  const dossierPlural = dossierType ? facilityPlural(dossierType) : "";
  // "Extraction & Mining" is the only type label that carries a second half;
  // "Extraction mines" reads, "Extraction & Mining mines" does not.
  const dossierHeading = dossierType
    ? `${(CORPORATION_TYPE_LABELS[dossierType] ?? dossierType).split(" &")[0]} ${dossierPlural}`
    : "Owned Sectors";

  const sortedSectors = useMemo(() => {
    let list = sectors;
    if (filterText.trim()) {
      const q = filterText.trim().toLowerCase();
      list = list.filter(
        (s) =>
          s.stateName.toLowerCase().includes(q) ||
          s.sectorLabel.toLowerCase().includes(q) ||
          (s.displayName ?? "").toLowerCase().includes(q)
      );
    }
    if (activeTypeFilter) list = list.filter((s) => s.sectorType === activeTypeFilter);
    return sortSectors(list, sortKey, sortDir);
  }, [sectors, filterText, activeTypeFilter, sortKey, sortDir]);

  const toggleSortDir = () => setSortDir((d) => (d === "asc" ? "desc" : "asc"));

  return (
    <>
      {expandModalOpen && isCeo && (
        <ExpandMarketModal
          corpId={corpId}
          primaryType={corporationType}
          secondaryType={corporationSecondaryType}
          liquidCapital={liquidCapital}
          plantsMode={plantsMode}
          initialSectorType={expandTypeOverride ?? deepLinkType}
          initialStateId={deepLinkState}
          onClose={() => setExpandModalOpen(false)}
        />
      )}

      {/* Type rail. One chip per type the corporation actually owns, so a corp
          running mines and newsrooms can read them as the separate businesses
          they are instead of one undifferentiated table. */}
      {sectorTypes.length > 0 && (
        <div className="mb-6 flex flex-wrap gap-1.5" role="tablist" aria-label="Sector type">
          <button
            type="button"
            role="tab"
            aria-selected={!dossierType}
            onClick={() => setFilterType("")}
            className={`inline-flex items-center gap-1.5 rounded-full border py-1 pl-2 pr-2.5 text-[11px] font-semibold transition-colors ${
              dossierType
                ? "border-card-border text-muted hover:text-foreground"
                : "border-muted/50 bg-card-elevated text-foreground"
            }`}
          >
            All sectors
            <span className="rounded-full bg-card-muted px-1.5 text-[10px] font-medium tabular-nums text-muted">
              {sectors.length}
            </span>
          </button>
          {sectorTypes.map((t) => {
            const palette = sectorTypePalette(t.value);
            const on = dossierType === t.value;
            return (
              <button
                key={t.value}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setFilterType(on ? "" : t.value)}
                className="inline-flex items-center gap-1.5 rounded-full border py-1 pl-2 pr-2.5 text-[11px] font-semibold transition-colors"
                style={{
                  borderColor: on ? hexAlpha(palette.c500, 0.5) : "var(--card-border)",
                  background: on ? hexAlpha(palette.c500, 0.15) : "transparent",
                  color: on ? palette.c400 : "var(--muted)",
                }}
              >
                <span
                  className="inline-block h-2 w-2 shrink-0 rounded-full"
                  style={{ background: palette.c500 }}
                  aria-hidden
                />
                {t.label}
                <span
                  className="rounded-full px-1.5 text-[10px] font-medium tabular-nums"
                  style={{
                    background: on ? hexAlpha(palette.c500, 0.25) : "var(--card-muted)",
                    color: on ? "var(--foreground)" : "var(--muted)",
                  }}
                >
                  {t.count}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {dossierType && (
        <div className="mb-8 flex flex-col gap-8">
          <SectorTypeDossier
            sectorType={dossierType}
            sectors={dossierSectors}
            allSectors={sectors}
            isCeo={isCeo}
            timeScale={timeScale}
            scaleFactor={scaleFactor}
            fmtMoney={fmtMoney}
            metricContext={metricContext}
            onBuild={() => openExpandModal(dossierType)}
          />
          <SectorStrategyPanel
            key={dossierType}
            sectorType={dossierType}
            sectors={dossierSectors}
            isCeo={isCeo}
            corpId={corpId}
          />
        </div>
      )}

      <div className="rounded-xl border border-card-border bg-card overflow-hidden">
        {/* Header with inline filters */}
        <div className="flex items-center justify-between p-6 pb-4 flex-wrap gap-2">
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="text-lg font-bold text-foreground">{dossierHeading}</h2>
            {isCeo && (
              <button
                type="button"
                onClick={() => openExpandModal(dossierType ?? undefined)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/20 transition-colors"
              >
                <span>+</span>
                {dossierType
                  ? capitalizeFacility(buildOnePhrase(dossierType))
                  : plantsMode
                    ? "New sector"
                    : "Expand Into New Market"}
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <div
              className="inline-flex rounded-lg border border-card-border overflow-hidden text-[11px] font-medium"
              title={MONEY_PERIOD_HELP}
              role="group"
              aria-label="Money figures shown per"
            >
              {MONEY_PERIODS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setTimeScale(p)}
                  aria-pressed={timeScale === p}
                  className={`px-2.5 py-1 transition-colors ${timeScale === p ? "bg-primary/15 text-primary" : "text-muted hover:text-foreground"}`}
                >
                  {MONEY_PERIOD_LABEL[p]}
                </button>
              ))}
            </div>
            {/* The type rail above owns this choice once a division is open;
                two controls for one filter is how they drift apart. */}
            {!dossierType && (
              <select
                className="rounded-lg border border-card-border bg-card px-2 py-1.5 text-xs text-foreground"
                value={activeTypeFilter}
                onChange={(e) => setFilterType(e.target.value)}
                aria-label="Filter by sector type"
              >
                <option value="">All types</option>
                {sectorTypes.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            )}
            <input
              type="search"
              placeholder="Filter…"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              className="rounded-lg border border-card-border bg-card px-2 py-1.5 text-xs text-foreground placeholder:text-muted/50 w-24"
            />
            {/* Clears the text search only. An open division is closed from the
                All sectors chip, not from a control that looks like a filter
                reset and would silently take the dossier with it. */}
            {filterText && (
              <button
                type="button"
                onClick={() => setFilterText("")}
                className="rounded border border-card-border px-1.5 py-1 text-[10px] text-muted hover:text-foreground"
                title="Clear the text filter"
              >
                ✕ {sortedSectors.length}/{dossierType ? dossierSectors.length : sectors.length}
              </button>
            )}
          </div>
        </div>

        {/* Logistics sprawl explainer */}
        {totalSectors >= SPRAWL_SECTOR_THRESHOLD - 2 && (
          <div className="mx-6 mb-4 rounded-lg border border-card-border bg-card-elevated/30 px-4 py-3">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-foreground">
                    Logistics & Operations Sprawl Penalty
                  </span>
                  {currentSprawlPenalty < 0 && (
                    <span className="rounded px-1.5 py-0.5 text-[10px] font-bold bg-error/15 text-error border border-error/20">
                      {currentSprawlPenalty.toFixed(1)}% active
                    </span>
                  )}
                  {currentSprawlPenalty === 0 && totalSectors >= SPRAWL_SECTOR_THRESHOLD && (
                    <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-success/15 text-success border border-success/20">
                      Logistics & Operations offset
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted">
                  Penalty begins at sector {SPRAWL_SECTOR_THRESHOLD + 1}. Every 2 sectors over the
                  threshold reduces all sector margins by{" "}
                  {Math.abs(SPRAWL_PENALTY_PER_PAIR * (hasSecondaryType ? 2 : 1)).toFixed(1)}%
                  {hasSecondaryType ? " (doubled because you have a secondary type)" : ""}.
                  Logistics & Operations strength raises the threshold (currently{" "}
                  <span className="font-medium text-foreground">{effectiveThreshold}</span>) and
                  reduces the penalty rate (max 50% reduction at LS {LOGISTICS_MAX_SPRAWL_EFFECT}+)
                  to{" "}
                  <span className="font-medium text-foreground">
                    {Math.abs(effectivePenaltyPerPair).toFixed(2)}% per pair
                  </span>
                  .
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-xs text-muted">{totalSectors} sectors</p>
                <p className="text-xs text-muted">Threshold: {effectiveThreshold}</p>
              </div>
            </div>
          </div>
        )}

        {sectorsMessage && (
          <div
            className={`mx-6 mb-4 rounded-lg border px-4 py-3 text-sm ${
              sectorsMessage.type === "error"
                ? "border-error/30 bg-error/10 text-error"
                : "border-success/30 bg-success/10 text-success"
            }`}
          >
            {sectorsMessage.text}
          </div>
        )}

        {sectors.length === 0 ? (
          <div className="p-6 text-center text-muted text-sm">No sectors yet.</div>
        ) : (
          <>
            {/* Sort row */}
            <div className="mx-6 mb-3 flex items-end gap-3 flex-wrap">
              <div className="flex flex-col gap-1 min-w-0 sm:min-w-[12rem]">
                <label
                  htmlFor="sector-sort"
                  className="text-xs font-bold uppercase tracking-widest text-muted"
                >
                  Sort by
                </label>
                <select
                  id="sector-sort"
                  className={SELECT_CLASSES}
                  value={sortKey}
                  onChange={(e) => setSortKey(e.target.value as SectorSortKey)}
                >
                  {sortOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs font-bold uppercase tracking-widest text-muted">
                  Order
                </span>
                <button
                  type="button"
                  onClick={toggleSortDir}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-card-border bg-card-muted/30 px-4 py-2 text-sm font-medium text-foreground hover:bg-card-elevated/80 transition-colors"
                  aria-pressed={sortDir === "desc"}
                  title={
                    sortDir === "asc"
                      ? "Currently A→Z / low→high. Click for reverse."
                      : "Currently Z→A / high→low. Click for reverse."
                  }
                >
                  <span className="tabular-nums text-muted text-xs uppercase tracking-wide">
                    {sortDir === "asc" ? "Asc" : "Desc"}
                  </span>
                  <span className="text-primary" aria-hidden>
                    {sortDir === "asc" ? "↑" : "↓"}
                  </span>
                </button>
              </div>
            </div>

            <SectorTableHeader timeScale={timeScale} plantsMode={plantsMode} />

            <ul className="list-none divide-y divide-card-border/40" aria-label="Sectors list">
              {sortedSectors.map((sector, index) => (
                <SectorRow
                  key={sector._id}
                  sector={sector}
                  isCeo={isCeo}
                  corpId={corpId}
                  currentTurn={currentTurn}
                  scaleFactor={scaleFactor}
                  scaleLabel={scaleLabel}
                  liquidCurrencyCode={liquidCurrencyCode}
                  isMenuOpen={openSectorMenuId === sector._id}
                  shouldOpenMenuUpward={sortedSectors.length - index <= 2}
                  abandoningSectorId={abandoningSectorId}
                  strategyUpdatingSectorId={strategyUpdatingSectorId}
                  growthUpdatingSectorId={growthUpdatingSectorId}
                  onMenuToggle={() =>
                    setOpenSectorMenuId((cur) => (cur === sector._id ? null : sector._id))
                  }
                  onAbandonSector={onAbandonSector}
                  onStrategyChange={onStrategyChange}
                  onGrowthChange={onGrowthChange}
                  onCancelTransition={onCancelTransition}
                  fmtMoney={fmtMoney}
                  fmtAnchor={fmtAnchor}
                  plantsMode={plantsMode}
                />
              ))}
            </ul>

            {/* Summary rows — desktop only */}
            {plantsMode &&
              sortedSectors.length > 1 &&
              (() => {
                // Plants summary. Deliberately ONE row, not the two the growth
                // table carries: an "average growth target" line has nothing to
                // average under plants, and the averages that would survive
                // (mean capacity, mean margin) are not decisions anyone makes.
                //
                // Corp fill is Σsold ÷ Σproduced, not the mean of the row
                // ratios — a mean lets one small plant at 5% drag the headline
                // for a corporation selling everything it makes.
                const financialsRedacted = sortedSectors.some((s) => s.revenue == null);
                const totalRev = sumSectorDisplayRevenue(sortedSectors);
                const totalProfit = sortedSectors.reduce((sum, s) => sum + (s.profit ?? 0), 0);
                const totalWorkers = sortedSectors.reduce((sum, s) => sum + (s.workers ?? 0), 0);
                const totalCapacity = sortedSectors.reduce(
                  (sum, s) => sum + (s.capacityUnits ?? 0),
                  0
                );
                const totalProduced = sortedSectors.reduce(
                  (sum, s) => sum + (s.producedUnits ?? 0),
                  0
                );
                const totalSold = sortedSectors.reduce((sum, s) => sum + (s.soldUnits ?? 0), 0);
                const corpFill = computeFillRate(totalProduced, totalSold);
                // A viewer who holds no exact per-row fill cannot be handed an
                // exact corp fill either — that would be the fogged rows
                // averaging back into the number the banding withholds.
                const hasExactFill = sortedSectors.some((s) => s.fillRate != null);
                const n = sortedSectors.length;

                return (
                  <div className="hidden lg:block border-t border-card-border bg-card-muted/20">
                    <div
                      className={`grid ${tableGrid} gap-x-3 px-6 py-2 text-[11px] font-bold uppercase tracking-wider text-muted`}
                    >
                      <span>Total ({n} sectors)</span>
                      <span></span>
                      <span></span>
                      <span className="text-right tabular-nums text-foreground normal-case tracking-normal">
                        {formatUnits(totalCapacity)}
                        <span className="block text-[10px] font-normal text-muted/70">
                          {CAPACITY_UNIT_LABEL}
                        </span>
                      </span>
                      <span className="flex justify-end">
                        <FillChip
                          fill={hasExactFill ? corpFill : null}
                          band={fillRateBand(corpFill)}
                        />
                      </span>
                      <span className="text-right text-success tabular-nums">
                        {financialsRedacted ? "—" : fmtMoney(totalRev * scaleFactor)}
                      </span>
                      <span
                        className={`text-right tabular-nums ${totalProfit >= 0 ? "text-success" : "text-error"}`}
                      >
                        {fmtMoney(totalProfit * scaleFactor)}
                      </span>
                      <span className="text-right tabular-nums text-foreground normal-case tracking-normal font-medium">
                        {financialsRedacted ? "—" : totalWorkers.toLocaleString("en-US")}
                      </span>
                      <span></span>
                    </div>
                  </div>
                );
              })()}

            {!plantsMode &&
              sortedSectors.length > 1 &&
              (() => {
                // revenue & workers are stripped for outsider-viewed private
                // corps (redactPrivateSectorRow); avoid NaN totals and show "—".
                const financialsRedacted = sortedSectors.some((s) => s.revenue == null);
                // Same realized-preferring basis every sector ROW renders
                // (SectorRow `financialRevenue ?? revenue`, #3001/#3002). This
                // total used to sum raw nameplate `revenue`, so the Total line
                // did not equal the column above it for any corp whose realized
                // revenue differs from nameplate (ticket #1122).
                const totalRev = sumSectorDisplayRevenue(sortedSectors);
                const totalProfit = sortedSectors.reduce((sum, s) => sum + (s.profit ?? 0), 0);
                const totalWorkers = sortedSectors.reduce((sum, s) => sum + (s.workers ?? 0), 0);
                // Net margin where the engine provides one (plants), else the
                // effective margin, so the average does not hide upkeep.
                const avgMargin =
                  sortedSectors.reduce(
                    (sum, s) => sum + (s.fillAdjustedMarginPct ?? s.effectiveProfitMargin),
                    0
                  ) / sortedSectors.length;
                const avgGrowth =
                  sortedSectors.reduce((sum, s) => sum + s.targetGrowthRate, 0) /
                  sortedSectors.length;
                const avgActiveGrowth =
                  sortedSectors.reduce((sum, s) => sum + s.currentGrowthRate, 0) /
                  sortedSectors.length;
                const n = sortedSectors.length;

                return (
                  <div className="hidden lg:block border-t border-card-border bg-card-muted/20">
                    <div
                      className={`grid ${tableGrid} gap-x-3 px-6 py-2 text-[11px] font-bold uppercase tracking-wider text-muted`}
                    >
                      <span>Total ({n} sectors)</span>
                      <span></span>
                      <span></span>
                      <span></span>
                      <span></span>
                      <span className="text-right text-success tabular-nums">
                        {financialsRedacted ? "—" : fmtMoney(totalRev * scaleFactor)}
                      </span>
                      <span></span>
                      <span
                        className={`text-right tabular-nums ${totalProfit >= 0 ? "text-success" : "text-error"}`}
                      >
                        {fmtMoney(totalProfit * scaleFactor)}
                      </span>
                      <span className="text-right tabular-nums text-foreground normal-case tracking-normal font-medium">
                        {financialsRedacted ? "—" : totalWorkers.toLocaleString("en-US")}
                      </span>
                      <span></span>
                    </div>
                    <div
                      className={`grid ${tableGrid} gap-x-3 px-6 py-2 border-t border-card-border/30 text-[11px] tracking-wider text-muted`}
                    >
                      <span className="uppercase font-bold">Average</span>
                      <span></span>
                      <span></span>
                      <span className="text-right tabular-nums text-primary font-medium">
                        {avgGrowth.toFixed(1)}%
                      </span>
                      <span className="text-right tabular-nums text-foreground font-medium">
                        {avgActiveGrowth.toFixed(1)}%
                      </span>
                      <span className="text-right text-success tabular-nums font-medium">
                        {financialsRedacted ? "—" : fmtMoney((totalRev / n) * scaleFactor)}
                      </span>
                      <span className="text-right tabular-nums text-foreground font-medium">
                        {avgMargin.toFixed(1)}%
                      </span>
                      <span
                        className={`text-right tabular-nums font-medium ${totalProfit / n >= 0 ? "text-success" : "text-error"}`}
                      >
                        {fmtMoney((totalProfit / n) * scaleFactor)}
                      </span>
                      <span className="text-right tabular-nums text-foreground normal-case tracking-normal font-medium">
                        {financialsRedacted
                          ? "—"
                          : Math.round(totalWorkers / n).toLocaleString("en-US")}
                      </span>
                      <span></span>
                    </div>
                  </div>
                );
              })()}
          </>
        )}
      </div>
    </>
  );
}
