"use client";

import { useState } from "react";
import Link from "next/link";
import { InfoTooltip } from "@/components/InfoTooltip";
import {
  getSectorStrategies,
  getStrategyForOperatingModel,
  STRATEGY_TRANSITION_TURNS,
  CANCEL_COST_FRACTION,
} from "@/lib/constants/sectorStrategies";
import { type CorporationType } from "@/lib/constants/corporations";
import { isExtractionStrategyZeroYield } from "@/lib/corporations/extractionStrategyAvailability";
import StrategyChangeConfirm from "./StrategyChangeConfirm";
import type { SectorDetail } from "./CorporationPageTypes";
import {
  StateFlag,
  GrowthBar,
  GrowthBarReadOnly,
  ActiveRateDisplay,
  StatusBadge,
} from "./SectorRowComponents";
import { SECTOR_TABLE_GRID, PLANTS_SECTOR_TABLE_GRID } from "./SectorTableHeader";
import {
  BuildQueueBadge,
  CAPACITY_UNIT_LABEL,
  DELIVERY_LIMITED_MIN_SHARE,
  DeliveryLimitedPill,
  FillChip,
  MothballedPill,
  formatFillPercent,
  formatUnits,
  sectorBuildUrl,
} from "./plantsPresentation";
import { facilityPlural, facilitySingular } from "@/lib/constants/facilityVocabulary";
import { facilitiesFromUnits } from "@/lib/constants/facilityQuantum";
import { getOperatingSectorType } from "@/lib/constants/sectorStrategies";
import { GROWTH_RATE_TURNS_PER_YEAR } from "@/lib/constants/corporations";
import { SectorMarginDrilldown } from "./SectorMarginDrilldown";
import {
  FREIGHT_CLASS_LABELS,
  freightClassAction,
  freightClassExplanation,
} from "@/lib/logistics/freightClass";

export interface SectorRowProps {
  sector: SectorDetail;
  isCeo: boolean;
  corpId: string;
  currentTurn: number;
  scaleFactor: number;
  scaleLabel: string;
  liquidCurrencyCode?: string | null;
  isMenuOpen: boolean;
  shouldOpenMenuUpward: boolean;
  abandoningSectorId: string | null;
  strategyUpdatingSectorId?: string | null;
  growthUpdatingSectorId?: string | null;
  onMenuToggle: () => void;
  onAbandonSector: (sectorId: string) => void;
  onStrategyChange?: (sectorId: string, strategyId: string) => void;
  onGrowthChange?: (sectorId: string, newRate: number) => void;
  onCancelTransition?: (sectorId: string) => void;
  fmtMoney: (val: number) => string;
  fmtAnchor: (val: number) => string;
  /** Plants tier: swap growth columns for capacity + fill. */
  plantsMode?: boolean;
  mediaOperatingModelsEnabled?: boolean;
}

export function SectorRow({
  sector,
  isCeo,
  corpId,
  currentTurn,
  scaleFactor,
  scaleLabel,
  liquidCurrencyCode,
  isMenuOpen,
  shouldOpenMenuUpward,
  abandoningSectorId,
  strategyUpdatingSectorId,
  growthUpdatingSectorId,
  onMenuToggle,
  onAbandonSector,
  onStrategyChange,
  onGrowthChange,
  onCancelTransition,
  fmtMoney,
  fmtAnchor,
  plantsMode = false,
  mediaOperatingModelsEnabled = false,
}: SectorRowProps) {
  const [pendingChange, setPendingChange] = useState<{
    sectorId: string;
    targetStrategyId: string;
  } | null>(null);
  const [cancelPending, setCancelPending] = useState(false);
  const [mobileAbandonConfirm, setMobileAbandonConfirm] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const operatingSectorType = getOperatingSectorType(
    sector.sectorType,
    sector.industryModel,
    sector.mediaDiscriminator
  ) as CorporationType;
  const strategies = getSectorStrategies(operatingSectorType, mediaOperatingModelsEnabled);
  const currentId = sector.strategyId ?? "standard";
  const currentStrategy = getStrategyForOperatingModel(
    sector.sectorType,
    currentId,
    sector.industryModel,
    sector.mediaDiscriminator
  );
  const currentStrategyListed = strategies.some((strategy) => strategy.id === currentId);
  const isTransitioning = !!sector.transitionFromStrategyId;
  const isUpdating = strategyUpdatingSectorId === sector._id;
  const isGrowthUpdating = growthUpdatingSectorId === sector._id;
  const isReversing = !!sector.isReversing;
  const isUnavailableExtractionStrategy = (strategy: (typeof strategies)[number]) =>
    sector.sectorType === "extraction" &&
    isExtractionStrategyZeroYield(strategy, sector.stateResources);

  const transitionTurnsRemaining =
    isTransitioning && sector.transitionStartTurn != null
      ? Math.max(0, STRATEGY_TRANSITION_TURNS - (currentTurn - sector.transitionStartTurn))
      : 0;
  const cooldownRemaining =
    sector.transitionCooldownUntilTurn != null
      ? Math.max(0, sector.transitionCooldownUntilTurn - currentTurn)
      : 0;
  const cancelProgress =
    isTransitioning && sector.transitionStartTurn != null
      ? Math.min(
          1,
          Math.max(0, (currentTurn - sector.transitionStartTurn) / STRATEGY_TRANSITION_TURNS)
        )
      : 0;
  const cancelCostDisplay = Math.round(
    cancelProgress * CANCEL_COST_FRACTION * (sector.revenue ?? 0)
  );
  const sectorName =
    sector.displayName && sector.displayName !== sector.stateName
      ? sector.displayName
      : sector.stateName;

  // Prefer realized revenue (matches the corp-level total's basis, #3001/#3002)
  // over the nameplate `revenue` figure for anything shown as "how much this
  // sector makes"; falls back to nameplate pre-reprocessing.
  const displayRevenue = sector.financialRevenue ?? sector.revenue;

  // `revenue`, `financialRevenue`, `currentGrowthCost`, and `profitMargin` are
  // stripped for private corps viewed by outsiders (redactPrivateSectorRow).
  // Render those as "n/a" rather than "$NaN" / "undefined%".
  const fmtScaled = (val: number | null | undefined) =>
    val == null ? "n/a" : fmtMoney(val * scaleFactor);

  // Revenue reconciliation. The cell shows the realized figure (above), because
  // that is the basis profit and the effective margin are computed from. But
  // nameplate is what the market-share and commodity screens talk about, and the
  // gap between the two was invisible, so the row read as "revenue × margin
  // does not equal profit" with nothing on screen to explain it (player report,
  // #gameplay-advisors, 2026-07-30). Reconcile the full chain in the tooltip.
  const nameplate = sector.revenue as number | null | undefined;
  const realized = displayRevenue as number | null | undefined;
  const realizationGap =
    nameplate != null && realized != null && nameplate > 0 ? realized / nameplate - 1 : null;
  // Only call out a gap the player can actually see in the rounded numbers.
  const showRealizationGap = realizationGap != null && Math.abs(realizationGap) >= 0.005;
  const operatingProfit = realized != null ? (realized * sector.effectiveProfitMargin) / 100 : null;

  // ── Plants tier ──────────────────────────────────────────────────────────
  // Under plants revenue is DERIVED from capacity and sales, so there is no
  // second "nameplate" figure to reconcile against: the realization gap that
  // capital mode explains in its tooltip would be a gap against a number the
  // engine no longer maintains. One revenue, and the chain that
  // produced it moves into the tooltip.
  const isMothballed = plantsMode && sector.mothballed === true;
  const buildQueue = plantsMode ? (sector.buildQueueSummary ?? null) : null;
  // Whole facilities are persisted ownership. Capacity can wear down without
  // deleting a plant, so only fall back to the old capacity-derived count for
  // payloads served during deployment of the ledger migration.
  const plantCount = plantsMode
    ? (sector.plantCount ?? facilitiesFromUnits(operatingSectorType, sector.capacityUnits ?? 0))
    : 0;
  const plantNoun =
    plantCount === 1 ? facilitySingular(sector.sectorType) : facilityPlural(sector.sectorType);
  // Fill-adjusted margin (query layer): profit over the FULL cost bill, not
  // over sold revenue. Under plants this is the number the row leads with:
  // `effectiveProfitMargin` divides by sold revenue only, so at a low fill it
  // reads 40%+ while the sector loses money. The raw figure stays in the
  // tooltip. Null when redacted/fogged or below plants.
  const fillAdjusted = plantsMode ? (sector.fillAdjustedMarginPct ?? null) : null;
  // The part of the fill shortfall that is a DELIVERY failure. Null outside
  // plants, when redacted/fogged, and until the freight pass writes it.
  const deliveryLimited = plantsMode ? (sector.deliveryLimitedFraction ?? null) : null;
  const deliveryLimitedShown =
    deliveryLimited != null &&
    Number.isFinite(deliveryLimited) &&
    deliveryLimited > DELIVERY_LIMITED_MIN_SHARE;
  const deliveryClass = sector.deliveryLimitedFreightClass ?? null;
  const deliveryClassLabel = deliveryClass ? FREIGHT_CLASS_LABELS[deliveryClass] : "Delivery";
  const plantsRevenueTooltip = (
    <>
      <p className="font-semibold text-foreground mb-1">Capacity → net profit</p>
      <div className="space-y-0.5 text-muted text-xs">
        <div className="flex justify-between gap-3">
          <span>Capacity</span>
          <span className="tabular-nums">{formatUnits(sector.capacityUnits)}</span>
        </div>
        <div className="flex justify-between gap-3">
          <span>Produced</span>
          <span className="tabular-nums">{formatUnits(sector.producedUnits)}</span>
        </div>
        <div className="flex justify-between gap-3">
          <span>Sold</span>
          <span className="tabular-nums">{formatUnits(sector.soldUnits)}</span>
        </div>
        <div className="flex justify-between gap-3 border-t border-card-border pt-0.5">
          <span className="text-foreground">Revenue</span>
          <span className="tabular-nums text-success">{fmtScaled(realized)}</span>
        </div>
        <div className="flex justify-between gap-3">
          <span>× effective margin</span>
          <span className="tabular-nums">{sector.effectiveProfitMargin}%</span>
        </div>
        <div className="flex justify-between gap-3">
          <span>Operating profit</span>
          <span className="tabular-nums">{fmtScaled(operatingProfit)}</span>
        </div>
        <div className="flex justify-between gap-3 border-t border-card-border pt-0.5 font-semibold">
          <span className="text-foreground">Net profit</span>
          <span className={`tabular-nums ${sector.profit >= 0 ? "text-success" : "text-error"}`}>
            {fmtMoney(sector.profit * scaleFactor)}
          </span>
        </div>
        {fillAdjusted != null && (
          <div className="flex justify-between gap-3">
            <span>Net margin</span>
            <span className={`tabular-nums ${fillAdjusted >= 0 ? "text-success" : "text-error"}`}>
              {fillAdjusted}%
            </span>
          </div>
        )}
      </div>
      {fillAdjusted != null && (
        <p className="mt-1.5 text-[10px] leading-snug text-muted">
          The effective margin counts only units that sold. Net margin is profit over revenue after
          paying for everything made, so unsold units pull it down.
        </p>
      )}
      {deliveryLimitedShown && (
        <p className="mt-1.5 text-[10px] leading-snug text-muted">
          {deliveryClassLabel} limited {formatFillPercent(deliveryLimited)} of this sector&apos;s
          output from reaching buyers outside the state.{" "}
          {deliveryClass
            ? freightClassExplanation(deliveryClass)
            : "The delivery network, not demand, is the limit."}{" "}
          {deliveryClass
            ? freightClassAction(deliveryClass)
            : "Add freight capacity or build nearer buyers."}
        </p>
      )}
      {isMothballed && (
        <p className="mt-1.5 text-[10px] leading-snug text-muted">
          These plants are mothballed. They produce nothing and pay reduced upkeep until you
          reactivate them.
        </p>
      )}
    </>
  );

  const revenueTooltip = (
    <>
      <p className="font-semibold text-foreground mb-1">Nameplate → net profit</p>
      <div className="space-y-0.5 text-muted text-xs">
        <div className="flex justify-between gap-3">
          <span>Nameplate revenue</span>
          <span className="tabular-nums">{fmtScaled(nameplate)}</span>
        </div>
        {showRealizationGap && (
          <div className="flex justify-between gap-3">
            <span>Realization</span>
            <span className={`tabular-nums ${realizationGap > 0 ? "text-success" : "text-error"}`}>
              {realizationGap > 0 ? "+" : ""}
              {(realizationGap * 100).toFixed(1)}%
            </span>
          </div>
        )}
        <div className="flex justify-between gap-3 border-t border-card-border pt-0.5">
          <span className="text-foreground">Realized revenue</span>
          <span className="tabular-nums text-success">{fmtScaled(realized)}</span>
        </div>
        <div className="flex justify-between gap-3">
          <span>× effective margin</span>
          <span className="tabular-nums">{sector.effectiveProfitMargin}%</span>
        </div>
        <div className="flex justify-between gap-3">
          <span>Operating profit</span>
          <span className="tabular-nums">{fmtScaled(operatingProfit)}</span>
        </div>
        <div className="flex justify-between gap-3">
          <span>Growth cost</span>
          <span className="tabular-nums text-error">
            {sector.currentGrowthCost == null ? "n/a" : `-${fmtScaled(sector.currentGrowthCost)}`}
          </span>
        </div>
        <div className="flex justify-between gap-3 border-t border-card-border pt-0.5 font-semibold">
          <span className="text-foreground">Net profit</span>
          <span className={`tabular-nums ${sector.profit >= 0 ? "text-success" : "text-error"}`}>
            {fmtMoney(sector.profit * scaleFactor)}
          </span>
        </div>
      </div>
      {showRealizationGap && (
        <p className="mt-1.5 text-[10px] leading-snug text-muted">
          Realization is production policy, commodity prices, throughput and capacity applied to
          your nameplate share. Open the sector for the per-commodity breakdown.
        </p>
      )}
    </>
  );

  const strategySelect = (isMobile = false) =>
    isCeo && onStrategyChange && strategies ? (
      <select
        value={pendingChange?.sectorId === sector._id ? pendingChange.targetStrategyId : currentId}
        onChange={(e) => {
          const newId = e.target.value;
          if (newId === currentId) {
            setPendingChange(null);
          } else {
            setPendingChange({ sectorId: sector._id, targetStrategyId: newId });
          }
        }}
        disabled={isUpdating || isTransitioning || cooldownRemaining > 0}
        className={`h-6 rounded border border-card-border bg-background px-1.5 text-xs text-foreground focus:border-foreground focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 ${
          isMobile ? "" : "w-full"
        }`}
        title="Change operating strategy"
        aria-label={`Operating strategy, ${sectorName}`}
      >
        {!currentStrategyListed && (
          <option value={currentId} disabled>
            {currentStrategy.name} (active, selection disabled)
          </option>
        )}
        {strategies.map((s) => {
          const zeroYield = isUnavailableExtractionStrategy(s);
          return (
            <option key={s.id} value={s.id} disabled={zeroYield}>
              {s.name}
              {zeroYield ? " (no deposits)" : ""}
            </option>
          );
        })}
      </select>
    ) : strategies ? (
      <span
        className={`block truncate text-xs ${currentId !== "standard" ? "text-foreground" : "text-muted"}`}
      >
        {currentStrategy.name}
      </span>
    ) : null;

  const statusBadge = (
    <StatusBadge
      sector={sector}
      strategies={strategies}
      currentId={currentId}
      transitionTurnsRemaining={transitionTurnsRemaining}
      cooldownRemaining={cooldownRemaining}
      isTransitioning={isTransitioning}
      isReversing={isReversing}
      isCeo={isCeo}
      onCancelTransition={onCancelTransition}
      cancelCostDisplay={cancelCostDisplay}
      isCancelPending={cancelPending}
      onCancelPendingSet={() => setCancelPending(true)}
      fmtMoney={fmtMoney}
    />
  );

  // Status words that ride on the name: plain text, coloured by what they mean.
  const markers = (
    <>
      {isMothballed && <MothballedPill sectorType={sector.sectorType as CorporationType} />}
      {sector.forSale && (
        <span
          className="shrink-0 text-[11px] font-medium text-success"
          title={`Listed for sale at ${fmtAnchor(sector.forSale.priceAnchor)}`}
        >
          For sale
        </span>
      )}
      {sector.embargoSuspended && (
        <span
          className="shrink-0 text-[11px] font-medium text-error"
          title="Suspended by a total trade embargo against your nation. This sector earns no revenue until the embargo is lifted. Consider selling or relocating it."
        >
          Embargoed
        </span>
      )}
    </>
  );

  // The identity cell is shared by both desktop layouts, so a marker added to
  // one world cannot go missing in the other.
  const identityCell = (
    <div className="flex min-w-0 items-center gap-2">
      <StateFlag stateId={sector.stateId} stateName={sector.stateName} />
      <div className="flex min-w-0 items-baseline gap-1.5">
        <Link
          href={`/corporation/${corpId}/sector/${sector._id}`}
          className="truncate text-[13px] font-medium text-foreground hover:underline"
          title={sector.displayName ? `${sector.displayName}, ${sector.stateName}` : undefined}
        >
          {sectorName}
        </Link>
        <span className="shrink-0 text-[11px] text-muted">{sector.sectorLabel}</span>
        {markers}
      </div>
    </div>
  );

  const expandButton = (
    <button
      type="button"
      onClick={() => setExpanded((v) => !v)}
      aria-expanded={expanded}
      aria-label={expanded ? "Hide margin breakdown" : "Show margin breakdown"}
      title="Margin build and production policy"
      className="px-1 text-muted hover:text-foreground"
    >
      <svg
        className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`}
        viewBox="0 0 20 20"
        fill="currentColor"
        aria-hidden
      >
        <path
          fillRule="evenodd"
          d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
          clipRule="evenodd"
        />
      </svg>
    </button>
  );

  const actionsCell = (
    <div className="flex items-center justify-end gap-0.5 text-right">
      {expandButton}
      <div className="relative inline-block" data-sector-menu-root>
        <button
          type="button"
          onClick={onMenuToggle}
          aria-expanded={isMenuOpen}
          aria-haspopup="menu"
          aria-label={`Actions for ${sectorName}`}
          className="px-1 text-sm text-muted hover:text-foreground"
          title="Actions"
        >
          ⋯
        </button>
        <div
          className={`${isMenuOpen ? "flex" : "hidden"} absolute right-0 z-20 min-w-[132px] flex-col rounded-md border border-card-border bg-card p-1 shadow-panel ${
            shouldOpenMenuUpward ? "bottom-full mb-1" : "top-full mt-1"
          }`}
          role="menu"
        >
          <Link
            href={`/corporation/${corpId}/sector/${sector._id}`}
            onClick={onMenuToggle}
            className="rounded px-2 py-1 text-left text-xs text-foreground hover:bg-card-elevated"
          >
            Details
          </Link>
          {plantsMode && isCeo && (
            <Link
              href={sectorBuildUrl(corpId, sector._id)}
              onClick={onMenuToggle}
              className="rounded px-2 py-1 text-left text-xs text-foreground hover:bg-card-elevated"
              title={`Order more capacity for these ${facilityPlural(sector.sectorType as CorporationType)}`}
            >
              Build capacity
            </Link>
          )}
          {isCeo && (
            <button
              type="button"
              onClick={() => {
                onMenuToggle();
                onAbandonSector(sector._id);
              }}
              disabled={abandoningSectorId === sector._id}
              className="rounded px-2 py-1 text-left text-xs text-error hover:bg-error/10 disabled:opacity-50"
              title="Abandon sector: revenue returns to the unowned pool"
            >
              {abandoningSectorId === sector._id ? "Abandoning…" : "Abandon"}
            </button>
          )}
        </div>
      </div>
    </div>
  );

  const profitTone = sector.profit > 0 ? "text-success" : sector.profit < 0 ? "text-error" : "";
  // The net margin is floored at -999.9 for a sector that sold nothing; past
  // three figures the exact value is in the title, not the column.
  const netMargin =
    fillAdjusted == null
      ? null
      : Math.abs(fillAdjusted) > 999
        ? `${fillAdjusted > 0 ? ">" : "<-"}999%`
        : `${fillAdjusted}%`;
  const cellNum = "font-mono text-[13px] tabular-nums";

  return (
    <li key={sector._id} className="hover:bg-card-elevated/40">
      {/* Desktop row (plants) */}
      {plantsMode && (
        <div
          className={`hidden lg:grid ${PLANTS_SECTOR_TABLE_GRID} items-center gap-x-3 px-2 py-1.5 ${
            // Mothballed plants are still yours and still cost you money, so
            // they stay in the table and stay legible: dimmed, not hidden,
            // and not so faint they fail contrast.
            isMothballed ? "opacity-60" : ""
          }`}
        >
          {identityCell}
          <div className="min-w-0">{strategySelect()}</div>
          <div className="min-w-0">{statusBadge}</div>

          <div className="text-right">
            <span
              className={`${cellNum} text-foreground`}
              title={`Capacity in ${CAPACITY_UNIT_LABEL}`}
            >
              {formatUnits(sector.capacityUnits)}
            </span>
            {buildQueue && <BuildQueueBadge queue={buildQueue} className="flex justify-end" />}
          </div>

          <div
            className={`${cellNum} text-right text-muted`}
            title={`${plantCount.toLocaleString("en-US")} ${plantNoun}`}
          >
            {plantCount.toLocaleString("en-US")}
          </div>

          <div className="flex flex-col items-end">
            <FillChip fill={sector.fillRate} band={sector.fillRateBand} />
            <DeliveryLimitedPill
              fraction={deliveryLimited}
              freightClass={sector.deliveryLimitedFreightClass}
            />
          </div>

          {/* Revenue: one figure, the chain behind it in the tooltip */}
          <div className="text-right">
            <InfoTooltip
              trigger={
                <span className={`${cellNum} cursor-help text-foreground`}>
                  {fmtScaled(realized)}
                </span>
              }
              width={230}
            >
              {plantsRevenueTooltip}
            </InfoTooltip>
          </div>

          <div
            className={`${cellNum} text-right ${
              fillAdjusted != null
                ? fillAdjusted < 0
                  ? "text-error"
                  : "text-foreground"
                : sector.effectiveProfitMargin < 0
                  ? "text-error"
                  : "text-foreground"
            }`}
            title={
              fillAdjusted != null
                ? `Net margin, profit over revenue after paying for everything made: ${fillAdjusted}%. Effective margin on sold units only: ${sector.effectiveProfitMargin}%.`
                : `Effective margin applied to this sector's revenue: ${sector.effectiveProfitMargin}%.`
            }
          >
            {netMargin ?? `${sector.effectiveProfitMargin}%`}
          </div>

          <div className={`${cellNum} text-right ${profitTone}`}>
            {fmtMoney(sector.profit * scaleFactor)}
          </div>

          <div className="text-right font-mono text-xs tabular-nums text-muted">
            {sector.workers != null ? sector.workers.toLocaleString("en-US") : "n/a"}
          </div>

          {actionsCell}
        </div>
      )}

      {/* Desktop row (growth) */}
      {!plantsMode && (
        <div className={`hidden lg:grid ${SECTOR_TABLE_GRID} items-center gap-x-3 px-2 py-1.5`}>
          {identityCell}
          <div className="min-w-0">{strategySelect()}</div>
          <div className="min-w-0">{statusBadge}</div>

          <div className="flex justify-end">
            {isCeo && onGrowthChange ? (
              <GrowthBar
                rate={sector.targetGrowthRate}
                disabled={isGrowthUpdating}
                onChange={(newRate) => onGrowthChange(sector._id, newRate)}
              />
            ) : (
              <GrowthBarReadOnly rate={sector.targetGrowthRate} />
            )}
          </div>

          <div className="text-right">
            <ActiveRateDisplay
              currentRate={sector.currentGrowthRate}
              targetRate={sector.targetGrowthRate}
            />
          </div>

          {/* Revenue: realized, with the nameplate to profit chain in the tooltip */}
          <div className="text-right">
            <InfoTooltip
              trigger={
                <span
                  className={`${cellNum} cursor-help text-foreground`}
                  title={
                    showRealizationGap
                      ? `Nameplate revenue before realization: ${fmtScaled(nameplate)}`
                      : undefined
                  }
                >
                  {fmtScaled(displayRevenue)}
                </span>
              }
              width={230}
            >
              {revenueTooltip}
            </InfoTooltip>
          </div>

          <div
            className={`${cellNum} text-right ${sector.effectiveProfitMargin < 0 ? "text-error" : "text-foreground"}`}
            title={[
              sector.profitMargin != null
                ? `Base margin set by CEO: ${sector.profitMargin}%.`
                : "Base margin not disclosed.",
              sector.foreignTariffModifier !== 0
                ? `Foreign tariff penalty: ${sector.foreignTariffModifier > 0 ? "+" : ""}${sector.foreignTariffModifier}%.`
                : sector.domesticTariffMalus !== 0
                  ? `Tariff friction: ${sector.domesticTariffMalus > 0 ? "+" : ""}${sector.domesticTariffMalus}%.`
                  : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {(sector.foreignTariffModifier !== 0 || sector.domesticTariffMalus !== 0) && (
              <span className="mr-1 font-sans text-[10px] text-warning">tariff</span>
            )}
            {sector.effectiveProfitMargin}%
          </div>

          <div className={`${cellNum} text-right ${profitTone}`}>
            {fmtMoney(sector.profit * scaleFactor)}
          </div>

          <div className="text-right font-mono text-xs tabular-nums text-muted">
            {sector.workers != null ? sector.workers.toLocaleString("en-US") : "n/a"}
          </div>

          {actionsCell}
        </div>
      )}

      {/* Phone layout */}
      <div className={`space-y-2 px-2 py-3 lg:hidden ${isMothballed ? "opacity-60" : ""}`}>
        <div className="flex items-center justify-between gap-2">
          {identityCell}
          <Link
            href={`/corporation/${corpId}/sector/${sector._id}`}
            className="shrink-0 text-xs text-muted hover:text-foreground"
          >
            Details
          </Link>
        </div>

        {(strategySelect(true) || statusBadge) && (
          <div className="flex flex-wrap items-center gap-2">
            {strategySelect(true)}
            {statusBadge}
          </div>
        )}

        <dl className="grid grid-cols-4 gap-x-3 gap-y-2">
          {plantsMode ? (
            <>
              <div>
                <dt className="text-[11px] text-muted">Capacity</dt>
                <dd className={`${cellNum} text-foreground`}>
                  {formatUnits(sector.capacityUnits)}
                </dd>
                <dd className="text-[11px] text-muted">
                  {plantCount.toLocaleString("en-US")} {plantNoun}
                </dd>
                <BuildQueueBadge queue={buildQueue} />
              </div>
              <div>
                <dt className="text-[11px] text-muted">Fill</dt>
                <dd>
                  <FillChip fill={sector.fillRate} band={sector.fillRateBand} />
                </dd>
                <DeliveryLimitedPill
                  fraction={deliveryLimited}
                  freightClass={sector.deliveryLimitedFreightClass}
                />
              </div>
            </>
          ) : (
            <>
              <div>
                <dt
                  className="text-[11px] text-muted"
                  title={`Growth target is applied over ${GROWTH_RATE_TURNS_PER_YEAR} turns (one game year)`}
                >
                  Growth target
                </dt>
                <dd>
                  {isCeo && onGrowthChange ? (
                    <GrowthBar
                      rate={sector.targetGrowthRate}
                      disabled={isGrowthUpdating}
                      onChange={(newRate) => onGrowthChange(sector._id, newRate)}
                    />
                  ) : (
                    <GrowthBarReadOnly rate={sector.targetGrowthRate} />
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] text-muted">Active rate</dt>
                <dd>
                  <ActiveRateDisplay
                    currentRate={sector.currentGrowthRate}
                    targetRate={sector.targetGrowthRate}
                    align="left"
                  />
                </dd>
              </div>
            </>
          )}
          <div>
            <dt className="text-[11px] text-muted">Revenue{scaleLabel}</dt>
            <dd className={`${cellNum} text-foreground`}>
              {fmtScaled(plantsMode ? realized : displayRevenue)}
            </dd>
            {!plantsMode && sector.currentGrowthCost != null && (
              <dd className="font-mono text-[11px] tabular-nums text-muted">
                -{fmtScaled(sector.currentGrowthCost)} cost
              </dd>
            )}
          </div>
          <div>
            <dt className="text-[11px] text-muted">Profit{scaleLabel}</dt>
            <dd className={`${cellNum} ${profitTone}`}>{fmtMoney(sector.profit * scaleFactor)}</dd>
            <dd
              className="font-mono text-[11px] tabular-nums text-muted"
              title={
                fillAdjusted != null
                  ? `Net margin: profit over revenue after paying for everything made. Effective margin on sold units only: ${sector.effectiveProfitMargin}%.`
                  : undefined
              }
            >
              {netMargin != null
                ? `${netMargin} net margin`
                : `${sector.effectiveProfitMargin}% margin`}
            </dd>
          </div>
        </dl>

        <div className="flex flex-wrap items-center gap-2">
          {plantsMode && isCeo && (
            <Link
              href={sectorBuildUrl(corpId, sector._id)}
              className="inline-flex h-7 items-center rounded-md border border-primary bg-primary px-2.5 text-xs font-medium text-white hover:bg-primary/90"
            >
              Build capacity
            </Link>
          )}
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            className="inline-flex h-7 items-center rounded-md border border-card-border px-2.5 text-xs text-foreground hover:bg-card-elevated"
          >
            {expanded ? "Hide margins" : "Margins"}
          </button>
          {isCeo &&
            (mobileAbandonConfirm ? (
              <span className="inline-flex items-center gap-2 text-xs text-error">
                Abandon? Its revenue returns to the unowned pool.
                <button
                  type="button"
                  onClick={() => setMobileAbandonConfirm(false)}
                  className="inline-flex h-7 items-center rounded-md border border-card-border px-2.5 text-xs text-foreground hover:bg-card-elevated"
                >
                  Keep
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMobileAbandonConfirm(false);
                    onAbandonSector(sector._id);
                  }}
                  disabled={abandoningSectorId === sector._id}
                  className="inline-flex h-7 items-center rounded-md border border-error/50 px-2.5 text-xs font-medium text-error hover:bg-error/10 disabled:opacity-50"
                >
                  {abandoningSectorId === sector._id ? "Abandoning…" : "Abandon"}
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setMobileAbandonConfirm(true)}
                disabled={abandoningSectorId === sector._id}
                className="inline-flex h-7 items-center rounded-md border border-error/50 px-2.5 text-xs font-medium text-error hover:bg-error/10 disabled:opacity-50"
              >
                {abandoningSectorId === sector._id ? "Abandoning…" : "Abandon"}
              </button>
            ))}
        </div>
      </div>

      {/* Margin build and production-policy drill-down */}
      {expanded && <SectorMarginDrilldown sector={sector} isCeo={isCeo} corpId={corpId} />}

      {/* Strategy change confirmation */}
      {pendingChange && pendingChange.sectorId === sector._id && (
        <div className="px-2 pb-3 pt-1">
          <StrategyChangeConfirm
            sectorType={sector.sectorType as CorporationType}
            currentStrategyId={currentId}
            targetStrategyId={pendingChange.targetStrategyId}
            dailyRevenue={sector.revenue}
            mediaOperatingModelsEnabled={mediaOperatingModelsEnabled}
            liquidCurrencyCode={liquidCurrencyCode}
            loading={isUpdating}
            onConfirm={() => {
              onStrategyChange?.(sector._id, pendingChange.targetStrategyId);
              setPendingChange(null);
            }}
            onCancel={() => setPendingChange(null)}
          />
        </div>
      )}

      {/* Cancel transition confirmation */}
      {cancelPending && onCancelTransition && (
        <div className="flex flex-wrap items-center gap-2 px-2 pb-3 pt-1 text-xs text-error">
          Cancel the transition? It costs {fmtMoney(cancelCostDisplay)}.
          <button
            type="button"
            onClick={() => setCancelPending(false)}
            className="inline-flex h-6 items-center rounded border border-card-border px-2 text-[11px] text-foreground hover:bg-card-elevated"
          >
            Keep it
          </button>
          <button
            type="button"
            onClick={() => {
              onCancelTransition(sector._id);
              setCancelPending(false);
            }}
            className="inline-flex h-6 items-center rounded border border-error/50 px-2 text-[11px] font-medium text-error hover:bg-error/10"
          >
            Cancel transition
          </button>
        </div>
      )}
    </li>
  );
}
