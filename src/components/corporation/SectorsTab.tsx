"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
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
  sumSectorDisplayRevenue,
  type SectorSortKey,
  type SortDir,
} from "./sectorSortUtils";
import { CAPACITY_UNIT_LABEL, FillChip, formatUnits } from "./plantsPresentation";
import { computeFillRate, fillRateBand } from "@/lib/corporations/financialFogOfWar";
import {
  buildOnePhrase,
  capitalizeFacility,
  facilityPlural,
} from "@/lib/constants/facilityVocabulary";
import { facilitiesFromUnits } from "@/lib/constants/facilityQuantum";
import { SectorTypeDossier } from "./SectorTypeDossier";
import { SectorStrategyPanel } from "./SectorStrategyPanel";
import type { SectorTypeMetricContext } from "./sectorTypeMetrics";
import { DenseSection, InlineStatus, Segmented, SmallButton, signTone } from "./dense/DenseKit";

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
  mediaOperatingModelsEnabled?: boolean;
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
  mediaOperatingModelsEnabled = false,
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

  const tableGrid = sectorTableGrid(plantsMode);
  const typeSelectId = useId();
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

  // A type chip does two jobs, and they have different preconditions.
  //
  // Filtering the table only needs the type to be one this corporation owns.
  // `sectorType` is a plain string on the wire, and a sector can carry a type
  // that predates a rename — the rail already falls back to the raw value for
  // its label, exactly like facilityVocabulary and getTypeColor do. Those
  // chips still have to filter, or they are dead controls.
  //
  // Validating against what is owned also stops a stale value from surviving:
  // abandoning the last sector of the open division would otherwise leave
  // `filterType` naming a type that no longer exists and filter the table down
  // to nothing with no explanation. Deliberately not healed in an effect —
  // clearing state synchronously from one cascades a render every pass, and
  // the derived value is already correct.
  const activeTypeFilter =
    filterType && sectorTypes.some((t) => t.value === filterType) ? filterType : "";

  // Opening a dossier needs more: a KNOWN type, resolved to the element out of
  // `CORPORATION_TYPES` rather than cast from the control's own string. This
  // value becomes the expand modal's `initialSectorType`, which the modal
  // interpolates into a link href, so passing the raw string through carried
  // DOM text from a `<select>` all the way into a URL (CodeQL
  // js/xss-through-dom). Resolving through the constant means what flows
  // onward is a compile-time string. An unowned or unknown type simply gets no
  // dossier, while the table above still filters.
  const dossierType = activeTypeFilter
    ? (CORPORATION_TYPES.find((t) => t === activeTypeFilter) ?? null)
    : null;
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
  // Sectors under the current filter, dossier or not, so the header count and
  // the heading both describe what the table is actually showing.
  const filteredTypeSectors = useMemo(
    () => (activeTypeFilter ? sectors.filter((s) => s.sectorType === activeTypeFilter) : sectors),
    [sectors, activeTypeFilter]
  );
  const dossierPlural = activeTypeFilter ? facilityPlural(activeTypeFilter) : "";
  // "Extraction & Mining" is the only type label that carries a second half;
  // "Extraction mines" reads, "Extraction & Mining mines" does not.
  const dossierHeading = activeTypeFilter
    ? `${(CORPORATION_TYPE_LABELS[activeTypeFilter as CorporationType] ?? activeTypeFilter).split(" &")[0]} ${dossierPlural}`
    : "Owned sectors";

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

  // A heading click sorts by that column; a second click on the same heading
  // reverses it. Names start A to Z, figures start largest first.
  const handleSort = (key: SectorSortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "location" || key === "type" ? "asc" : "desc");
    }
  };

  const buildLabel = dossierType
    ? capitalizeFacility(buildOnePhrase(dossierType))
    : plantsMode
      ? "New sector"
      : "Expand into new market";

  const cellNum = "font-mono tabular-nums";

  return (
    <div className="space-y-6">
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

      {/* One control picks the division, so a corp running mines and
          newsrooms can read them as the separate businesses they are. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {sectorTypes.length > 0 ? (
          <div className="flex items-center gap-2">
            <label htmlFor={typeSelectId} className="text-xs text-muted">
              Sector type
            </label>
            <select
              id={typeSelectId}
              value={activeTypeFilter}
              onChange={(e) => setFilterType(e.target.value)}
              className="h-7 rounded-md border border-card-border bg-background px-2 text-xs text-foreground focus:border-foreground focus:outline-none"
            >
              <option value="">All types ({sectors.length})</option>
              {sectorTypes.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label} ({t.count})
                </option>
              ))}
            </select>
          </div>
        ) : (
          <span />
        )}
        {isCeo && (
          <SmallButton tone="primary" onClick={() => openExpandModal(dossierType ?? undefined)}>
            + {buildLabel}
          </SmallButton>
        )}
      </div>

      {dossierType && (
        <div className="flex flex-col gap-6">
          <SectorTypeDossier
            sectorType={dossierType}
            sectors={dossierSectors}
            allSectors={sectors}
            timeScale={timeScale}
            scaleFactor={scaleFactor}
            fmtMoney={fmtMoney}
            metricContext={metricContext}
          />
          <SectorStrategyPanel
            key={dossierType}
            sectorType={dossierType}
            sectors={dossierSectors}
            isCeo={isCeo}
            corpId={corpId}
            mediaOperatingModelsEnabled={mediaOperatingModelsEnabled}
          />
        </div>
      )}

      <DenseSection
        title={dossierHeading}
        meta={
          filterText
            ? `${sortedSectors.length} of ${filteredTypeSectors.length}`
            : `${filteredTypeSectors.length} ${filteredTypeSectors.length === 1 ? "sector" : "sectors"}`
        }
        actions={
          <>
            <Segmented
              ariaLabel="Money figures shown per"
              options={MONEY_PERIODS.map((p) => ({
                value: p,
                label: MONEY_PERIOD_LABEL[p],
                title: MONEY_PERIOD_HELP,
              }))}
              value={timeScale}
              onChange={setTimeScale}
            />
            <input
              type="search"
              placeholder="Filter"
              aria-label="Filter sectors by name or state"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              className="h-7 w-28 rounded-md border border-card-border bg-background px-2 text-xs text-foreground placeholder:text-muted focus:border-foreground focus:outline-none"
            />
          </>
        }
      >
        {/* Logistics sprawl */}
        {totalSectors >= SPRAWL_SECTOR_THRESHOLD - 2 && (
          <p className="py-1.5 text-xs text-muted">
            <span className="font-medium text-foreground">Sprawl. </span>
            {currentSprawlPenalty < 0 ? (
              <span className="font-medium text-error">
                {currentSprawlPenalty.toFixed(1)}% on every sector margin now.{" "}
              </span>
            ) : totalSectors >= SPRAWL_SECTOR_THRESHOLD ? (
              <span className="text-success">Offset by Logistics &amp; Operations. </span>
            ) : null}
            The penalty begins at sector {SPRAWL_SECTOR_THRESHOLD + 1}. Every 2 sectors over the
            threshold reduce all sector margins by{" "}
            {Math.abs(SPRAWL_PENALTY_PER_PAIR * (hasSecondaryType ? 2 : 1)).toFixed(1)}%
            {hasSecondaryType ? " (doubled because you have a secondary type)" : ""}. Logistics
            &amp; Operations strength raises the threshold (now{" "}
            <span className={`${cellNum} text-foreground`}>{effectiveThreshold}</span>, with{" "}
            <span className={`${cellNum} text-foreground`}>{totalSectors}</span> owned) and cuts the
            rate (at most by half, at LS {LOGISTICS_MAX_SPRAWL_EFFECT}+) to{" "}
            <span className={`${cellNum} text-foreground`}>
              {Math.abs(effectivePenaltyPerPair).toFixed(2)}%
            </span>{" "}
            per pair.
          </p>
        )}

        <InlineStatus
          message={sectorsMessage?.text}
          tone={sectorsMessage?.type === "error" ? "error" : "success"}
          className="py-1"
        />

        {sectors.length === 0 ? (
          <p className="py-2 text-xs text-muted">No sectors yet.</p>
        ) : (
          <>
            <SectorTableHeader
              timeScale={timeScale}
              plantsMode={plantsMode}
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={handleSort}
            />

            <ul className="list-none divide-y divide-card-border/60" aria-label="Sectors list">
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
                  mediaOperatingModelsEnabled={mediaOperatingModelsEnabled}
                />
              ))}
            </ul>

            {/* Totals, desktop only */}
            {plantsMode &&
              sortedSectors.length > 1 &&
              (() => {
                // Plants summary. Deliberately ONE row, not the two the growth
                // table carries: an "average growth target" line has nothing to
                // average under plants, and the averages that would survive
                // (mean capacity, mean margin) are not decisions anyone makes.
                //
                // Corp fill is Σsold ÷ Σproduced, not the mean of the row
                // ratios: a mean lets one small plant at 5% drag the headline
                // for a corporation selling everything it makes.
                const financialsRedacted = sortedSectors.some((s) => s.revenue == null);
                const totalRev = sumSectorDisplayRevenue(sortedSectors);
                const totalProfit = sortedSectors.reduce((sum, s) => sum + (s.profit ?? 0), 0);
                const totalWorkers = sortedSectors.reduce((sum, s) => sum + (s.workers ?? 0), 0);
                const totalCapacity = sortedSectors.reduce(
                  (sum, s) => sum + (s.capacityUnits ?? 0),
                  0
                );
                const totalSites = sortedSectors.reduce(
                  (sum, s) =>
                    sum +
                    (s.plantCount ??
                      facilitiesFromUnits(s.sectorType as CorporationType, s.capacityUnits ?? 0)),
                  0
                );
                const totalProduced = sortedSectors.reduce(
                  (sum, s) => sum + (s.producedUnits ?? 0),
                  0
                );
                const totalSold = sortedSectors.reduce((sum, s) => sum + (s.soldUnits ?? 0), 0);
                const corpFill = computeFillRate(totalProduced, totalSold);
                // A viewer who holds no exact per-row fill cannot be handed an
                // exact corp fill either: that would be the fogged rows
                // averaging back into the number the banding withholds.
                const hasExactFill = sortedSectors.some((s) => s.fillRate != null);
                const n = sortedSectors.length;

                return (
                  <div
                    className={`hidden lg:grid ${tableGrid} items-center gap-x-3 border-t border-card-border px-2 py-1.5 text-[13px] font-medium`}
                  >
                    <span className="text-xs text-muted">Total, {n} sectors</span>
                    <span></span>
                    <span></span>
                    <span
                      className={`${cellNum} text-right text-foreground`}
                      title={CAPACITY_UNIT_LABEL}
                    >
                      {formatUnits(totalCapacity)}
                    </span>
                    <span className={`${cellNum} text-right text-muted`}>
                      {totalSites.toLocaleString("en-US")}
                    </span>
                    <span className="flex justify-end">
                      <FillChip
                        fill={hasExactFill ? corpFill : null}
                        band={fillRateBand(corpFill)}
                      />
                    </span>
                    <span className={`${cellNum} text-right text-foreground`}>
                      {financialsRedacted ? "n/a" : fmtMoney(totalRev * scaleFactor)}
                    </span>
                    <span></span>
                    <span className={`${cellNum} text-right ${signTone(totalProfit)}`}>
                      {fmtMoney(totalProfit * scaleFactor)}
                    </span>
                    <span className={`${cellNum} text-right text-xs text-foreground`}>
                      {financialsRedacted ? "n/a" : totalWorkers.toLocaleString("en-US")}
                    </span>
                    <span></span>
                  </div>
                );
              })()}

            {!plantsMode &&
              sortedSectors.length > 1 &&
              (() => {
                // revenue & workers are stripped for outsider-viewed private
                // corps (redactPrivateSectorRow); avoid NaN totals and show n/a.
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
                  <div className="hidden border-t border-card-border text-[13px] font-medium lg:block">
                    <div className={`grid ${tableGrid} items-center gap-x-3 px-2 py-1.5`}>
                      <span className="text-xs text-muted">Total, {n} sectors</span>
                      <span></span>
                      <span></span>
                      <span></span>
                      <span></span>
                      <span className={`${cellNum} text-right text-foreground`}>
                        {financialsRedacted ? "n/a" : fmtMoney(totalRev * scaleFactor)}
                      </span>
                      <span></span>
                      <span className={`${cellNum} text-right ${signTone(totalProfit)}`}>
                        {fmtMoney(totalProfit * scaleFactor)}
                      </span>
                      <span className={`${cellNum} text-right text-xs text-foreground`}>
                        {financialsRedacted ? "n/a" : totalWorkers.toLocaleString("en-US")}
                      </span>
                      <span></span>
                    </div>
                    <div
                      className={`grid ${tableGrid} items-center gap-x-3 border-t border-card-border/60 px-2 py-1.5 font-normal`}
                    >
                      <span className="text-xs text-muted">Average</span>
                      <span></span>
                      <span></span>
                      <span className={`${cellNum} text-right text-foreground`}>
                        {avgGrowth.toFixed(1)}%
                      </span>
                      <span className={`${cellNum} text-right text-foreground`}>
                        {avgActiveGrowth.toFixed(1)}%
                      </span>
                      <span className={`${cellNum} text-right text-foreground`}>
                        {financialsRedacted ? "n/a" : fmtMoney((totalRev / n) * scaleFactor)}
                      </span>
                      <span className={`${cellNum} text-right text-foreground`}>
                        {avgMargin.toFixed(1)}%
                      </span>
                      <span className={`${cellNum} text-right ${signTone(totalProfit / n)}`}>
                        {fmtMoney((totalProfit / n) * scaleFactor)}
                      </span>
                      <span className={`${cellNum} text-right text-xs text-foreground`}>
                        {financialsRedacted
                          ? "n/a"
                          : Math.round(totalWorkers / n).toLocaleString("en-US")}
                      </span>
                      <span></span>
                    </div>
                  </div>
                );
              })()}
          </>
        )}
      </DenseSection>
    </div>
  );
}
