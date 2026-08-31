"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { STATE_FLAGS } from "@/lib/constants";
import { bypassNextImageOptimization } from "@/lib/images/bypassImageOptimization";
import { InfoTooltip } from "@/components/InfoTooltip";
import { STRATEGY_TRANSITION_TURNS, CANCEL_COST_FRACTION } from "@/lib/constants/sectorStrategies";
import { SECTOR_STRATEGIES } from "@/lib/constants/sectorStrategies";
import { type CorporationType } from "@/lib/constants/corporations";
import { isExtractionStrategyZeroYield } from "@/lib/corporations/extractionStrategyAvailability";
import StrategyChangeConfirm from "./StrategyChangeConfirm";
import { getTypeColor } from "./CorporationHelpers";
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
}: SectorRowProps) {
  const [pendingChange, setPendingChange] = useState<{
    sectorId: string;
    targetStrategyId: string;
  } | null>(null);
  const [cancelPending, setCancelPending] = useState(false);
  const [mobileAbandonConfirm, setMobileAbandonConfirm] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const strategies = SECTOR_STRATEGIES[sector.sectorType as CorporationType];
  const currentId = sector.strategyId ?? "standard";
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
  const typeColor = getTypeColor(sector.sectorType as CorporationType);

  // Prefer realized revenue (matches the corp-level total's basis, #3001/#3002)
  // over the nameplate `revenue` figure for anything shown as "how much this
  // sector makes" — falls back to nameplate pre-reprocessing.
  const displayRevenue = sector.financialRevenue ?? sector.revenue;

  // `revenue`, `financialRevenue`, `currentGrowthCost`, and `profitMargin` are
  // stripped for private corps viewed by outsiders (redactPrivateSectorRow).
  // Render those as "—" rather than "$NaN" / "undefined%".
  const fmtScaled = (val: number | null | undefined) =>
    val == null ? "—" : fmtMoney(val * scaleFactor);

  // Revenue reconciliation. The cell shows the realized figure (above), because
  // that is the basis profit and the effective margin are computed from. But
  // nameplate is what the market-share and commodity screens talk about, and the
  // gap between the two was invisible — so the row read as "revenue × margin
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
  // second "nameplate" figure to reconcile against — the realization-gap
  // sub-line that exists in capital mode would be showing a gap against a
  // number the engine no longer maintains. One revenue, and the chain that
  // produced it moves into the tooltip.
  const isMothballed = plantsMode && sector.mothballed === true;
  const buildQueue = plantsMode ? (sector.buildQueueSummary ?? null) : null;
  // Whole facilities are persisted ownership. Capacity can wear down without
  // deleting a plant, so only fall back to the old capacity-derived count for
  // payloads served during deployment of the ledger migration.
  const plantCount = plantsMode
    ? (sector.plantCount ??
      facilitiesFromUnits(sector.sectorType as CorporationType, sector.capacityUnits ?? 0))
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
            <span>After unsold output</span>
            <span className={`tabular-nums ${fillAdjusted >= 0 ? "text-success" : "text-error"}`}>
              {fillAdjusted}%
            </span>
          </div>
        )}
      </div>
      {fillAdjusted != null && (
        <p className="mt-1.5 text-[10px] leading-snug text-muted">
          The effective margin counts only units that sold. &quot;After unsold output&quot; is
          profit over the cost of everything made, so it reflects unsold units too.
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
            {sector.currentGrowthCost == null ? "—" : `-${fmtScaled(sector.currentGrowthCost)}`}
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
        className={
          isMobile
            ? "rounded border border-primary/20 bg-primary/5 px-1.5 py-0.5 text-[11px] font-medium text-primary disabled:opacity-50 disabled:cursor-not-allowed"
            : "w-full rounded border border-primary/20 bg-primary/5 px-1.5 py-0.5 text-[11px] font-medium text-primary disabled:opacity-50 disabled:cursor-not-allowed"
        }
        title="Change operating strategy"
      >
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
    ) : currentId !== "standard" && strategies ? (
      <span className="text-[11px] font-medium text-primary">
        {strategies.find((s) => s.id === currentId)?.name ?? currentId}
      </span>
    ) : isMobile ? null : (
      <span className="text-[11px] text-muted/50">Standard</span>
    );

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

  // The identity cell is shared by both desktop layouts — one definition so a
  // badge added to one world cannot go missing in the other.
  const identityCell = (
    <div className="flex items-center gap-2 min-w-0">
      <StateFlag stateId={sector.stateId} stateName={sector.stateName} />
      <div className="min-w-0">
        <Link
          href={`/corporation/${corpId}/sector/${sector._id}`}
          className="text-primary hover:underline font-semibold text-sm block truncate"
        >
          {sector.displayName && sector.displayName !== sector.stateName
            ? sector.displayName
            : sector.stateName}
        </Link>
        <div className="flex items-center gap-1.5 flex-wrap">
          <span
            className={`text-[10px] font-medium ${typeColor.split(" ").find((c) => c.startsWith("text-")) ?? "text-muted"}`}
          >
            {sector.sectorLabel}
          </span>
          {isMothballed && <MothballedPill sectorType={sector.sectorType as CorporationType} />}
          {sector.forSale && (
            <span
              className="inline-flex items-center rounded-full border border-success/40 bg-success/10 px-1.5 py-0 text-[9px] font-bold uppercase tracking-wider text-success"
              title={`Listed for sale at ${fmtAnchor(sector.forSale.priceAnchor)}`}
            >
              For Sale
            </span>
          )}
          {sector.embargoSuspended && (
            <span
              className="inline-flex items-center rounded-full border border-error/40 bg-error/10 px-1.5 py-0 text-[9px] font-bold uppercase tracking-wider text-error"
              title="Suspended by a total trade embargo against your nation — this sector earns no revenue until the embargo is lifted. Consider selling or relocating it."
            >
              Embargoed
            </span>
          )}
        </div>
      </div>
    </div>
  );

  const actionsCell = (
    <div className="flex items-center justify-end gap-0.5 text-right">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-label={expanded ? "Hide margin breakdown" : "Show margin breakdown"}
        title="Margin build & production policy"
        className="px-1 text-muted hover:text-primary"
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
      <div className="relative inline-block" data-sector-menu-root>
        <button
          type="button"
          onClick={onMenuToggle}
          aria-expanded={isMenuOpen}
          aria-haspopup="menu"
          className="px-1 text-sm text-muted hover:text-primary"
          title="Actions"
        >
          ⋯
        </button>
        <div
          className={`${isMenuOpen ? "flex" : "hidden"} absolute right-0 z-20 min-w-[100px] flex-col gap-1 rounded-lg border border-card-border bg-card p-1.5 shadow-panel ${
            shouldOpenMenuUpward ? "bottom-full mb-1" : "top-full mt-1"
          }`}
          role="menu"
        >
          <Link
            href={`/corporation/${corpId}/sector/${sector._id}`}
            onClick={onMenuToggle}
            className="rounded px-2.5 py-1.5 text-xs text-muted hover:text-primary hover:bg-card-elevated/80 transition-colors text-left"
          >
            Details
          </Link>
          {plantsMode && isCeo && (
            <Link
              href={sectorBuildUrl(corpId, sector._id)}
              onClick={onMenuToggle}
              className="rounded px-2.5 py-1.5 text-xs text-primary hover:bg-primary/10 transition-colors text-left"
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
              className="rounded px-2.5 py-1.5 text-xs text-error hover:bg-error/10 transition-colors text-left disabled:opacity-50"
              title="Abandon sector — revenue returns to unowned pool"
            >
              {abandoningSectorId === sector._id ? "Abandoning…" : "Abandon"}
            </button>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <li key={sector._id} className="hover:bg-card-elevated/30 transition-colors">
      {/* ── Desktop row (plants) ───────────────────────────────────────── */}
      {plantsMode && (
        <div
          className={`hidden lg:grid ${PLANTS_SECTOR_TABLE_GRID} gap-x-3 px-6 py-3 items-center ${
            // Mothballed plants are still yours and still cost you money, so
            // they stay in the table and stay legible — dimmed, not hidden,
            // and not so faint they fail contrast.
            isMothballed ? "opacity-60" : ""
          }`}
        >
          {identityCell}

          {/* Strategy */}
          <div className="min-w-0">{strategySelect()}</div>

          {/* Status */}
          <div className="min-w-0">{statusBadge}</div>

          {/* Capacity + plant count + build queue */}
          <div className="text-right">
            <span
              className="text-sm tabular-nums font-medium text-foreground"
              title={`Capacity in ${CAPACITY_UNIT_LABEL}`}
            >
              {formatUnits(sector.capacityUnits)}
            </span>
            <span
              className="block text-[10px] tabular-nums text-muted"
              title={`Number of ${facilityPlural(sector.sectorType)} making up this capacity`}
            >
              {plantCount.toLocaleString("en-US")} {plantNoun}
            </span>
            <BuildQueueBadge queue={buildQueue} className="mt-0.5" />
          </div>

          {/* Fill */}
          <div className="flex flex-wrap items-center justify-end gap-1">
            <FillChip fill={sector.fillRate} band={sector.fillRateBand} />
            <DeliveryLimitedPill
              fraction={deliveryLimited}
              freightClass={sector.deliveryLimitedFreightClass}
            />
          </div>

          {/* Revenue — one figure, chain in the tooltip */}
          <div className="text-right">
            <InfoTooltip
              trigger={
                <span className="text-sm tabular-nums font-medium text-success cursor-help">
                  {fmtScaled(realized)}
                </span>
              }
              width={230}
            >
              {plantsRevenueTooltip}
            </InfoTooltip>
          </div>

          {/* Profit + the margin it was computed from, so the row reconciles */}
          <div className="text-right">
            <span
              className={`text-sm tabular-nums font-medium ${sector.profit >= 0 ? "text-success" : "text-error"}`}
            >
              {fmtMoney(sector.profit * scaleFactor)}
            </span>
            {fillAdjusted != null ? (
              <span
                className={`block text-[10px] tabular-nums ${fillAdjusted < 0 ? "text-error" : "text-muted/70"}`}
                title={`Profit over the cost of everything made, unsold units included. Effective margin on sold units only: ${sector.effectiveProfitMargin}%.`}
              >
                {fillAdjusted}% after unsold
              </span>
            ) : (
              <span
                className={`block text-[10px] tabular-nums ${sector.effectiveProfitMargin < 0 ? "text-error" : "text-muted/70"}`}
                title="Effective margin applied to this sector's revenue."
              >
                {sector.effectiveProfitMargin}% margin
              </span>
            )}
          </div>

          {/* Workers */}
          <div className="text-right">
            <span className="text-xs tabular-nums text-muted">
              {sector.workers != null ? sector.workers.toLocaleString("en-US") : "—"}
            </span>
          </div>

          {actionsCell}
        </div>
      )}

      {/* ── Desktop row ────────────────────────────────────────────────── */}
      <div
        className={`${plantsMode ? "hidden" : "hidden lg:grid"} ${SECTOR_TABLE_GRID} gap-x-3 px-6 py-3 items-center`}
      >
        {/* Location + type */}
        <div className="flex items-center gap-2 min-w-0">
          <StateFlag stateId={sector.stateId} stateName={sector.stateName} />
          <div className="min-w-0">
            <Link
              href={`/corporation/${corpId}/sector/${sector._id}`}
              className="text-primary hover:underline font-semibold text-sm block truncate"
            >
              {sector.displayName && sector.displayName !== sector.stateName
                ? sector.displayName
                : sector.stateName}
            </Link>
            <div className="flex items-center gap-1.5 flex-wrap">
              <span
                className={`text-[10px] font-medium ${typeColor.split(" ").find((c) => c.startsWith("text-")) ?? "text-muted"}`}
              >
                {sector.sectorLabel}
              </span>
              {sector.forSale && (
                <span
                  className="inline-flex items-center rounded-full border border-success/40 bg-success/10 px-1.5 py-0 text-[9px] font-bold uppercase tracking-wider text-success"
                  title={`Listed for sale at ${fmtAnchor(sector.forSale.priceAnchor)}`}
                >
                  For Sale
                </span>
              )}
              {sector.embargoSuspended && (
                <span
                  className="inline-flex items-center rounded-full border border-error/40 bg-error/10 px-1.5 py-0 text-[9px] font-bold uppercase tracking-wider text-error"
                  title="Suspended by a total trade embargo against your nation — this sector earns no revenue until the embargo is lifted. Consider selling or relocating it."
                >
                  Embargoed
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Strategy */}
        <div className="min-w-0">{strategySelect()}</div>

        {/* Status */}
        <div className="min-w-0">{statusBadge}</div>

        {/* Growth target */}
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

        {/* Active rate */}
        <div className="text-right">
          <ActiveRateDisplay
            currentRate={sector.currentGrowthRate}
            targetRate={sector.targetGrowthRate}
          />
        </div>

        {/* Revenue — realized, with the full nameplate → profit chain in the tooltip */}
        <div className="text-right">
          <InfoTooltip
            trigger={
              <span className="text-sm tabular-nums font-medium text-success cursor-help">
                {fmtScaled(displayRevenue)}
              </span>
            }
            width={230}
          >
            {revenueTooltip}
          </InfoTooltip>
          {showRealizationGap && (
            <span
              className="block text-[10px] tabular-nums text-muted/70"
              title={`Nameplate revenue before realization: ${fmtScaled(nameplate)}`}
            >
              nameplate {fmtScaled(nameplate)}
            </span>
          )}
        </div>

        {/* Margin */}
        <div className="text-right">
          <span
            className={`text-sm tabular-nums font-bold ${sector.effectiveProfitMargin < 0 ? "text-error" : "text-foreground"}`}
          >
            {sector.effectiveProfitMargin}%
          </span>
          {(sector.foreignTariffModifier !== 0 || sector.domesticTariffMalus !== 0) && (
            <span
              className="ml-1 text-[9px] font-semibold uppercase tracking-wide text-warning"
              title={
                sector.foreignTariffModifier !== 0
                  ? `Foreign tariff penalty: ${sector.foreignTariffModifier > 0 ? "+" : ""}${sector.foreignTariffModifier}%`
                  : `Tariff friction: ${sector.domesticTariffMalus > 0 ? "+" : ""}${sector.domesticTariffMalus}%`
              }
            >
              tariff
            </span>
          )}
          <span
            className="block text-[10px] tabular-nums text-muted/70"
            title={
              sector.profitMargin != null
                ? `Base margin set by CEO: ${sector.profitMargin}%`
                : "Base margin not disclosed"
            }
          >
            base {sector.profitMargin != null ? `${sector.profitMargin}%` : "—"}
          </span>
        </div>

        {/* Profit */}
        <div className="text-right">
          <span
            className={`text-sm tabular-nums font-medium ${sector.profit >= 0 ? "text-success" : "text-error"}`}
          >
            {fmtMoney(sector.profit * scaleFactor)}
          </span>
        </div>

        {/* Workers */}
        <div className="text-right">
          <span className="text-xs tabular-nums text-muted">
            {sector.workers != null ? sector.workers.toLocaleString("en-US") : "—"}
          </span>
        </div>

        {/* Expand drill-down + overflow actions menu */}
        <div className="flex items-center justify-end gap-0.5 text-right">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-label={expanded ? "Hide margin breakdown" : "Show margin breakdown"}
            title="Margin build & production policy"
            className="px-1 text-muted hover:text-primary"
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
          <div className="relative inline-block" data-sector-menu-root>
            <button
              type="button"
              onClick={onMenuToggle}
              aria-expanded={isMenuOpen}
              aria-haspopup="menu"
              className="px-1 text-sm text-muted hover:text-primary"
              title="Actions"
            >
              ⋯
            </button>
            <div
              className={`${isMenuOpen ? "flex" : "hidden"} absolute right-0 z-20 min-w-[100px] flex-col gap-1 rounded-lg border border-card-border bg-card p-1.5 shadow-panel ${
                shouldOpenMenuUpward ? "bottom-full mb-1" : "top-full mt-1"
              }`}
              role="menu"
            >
              <Link
                href={`/corporation/${corpId}/sector/${sector._id}`}
                onClick={onMenuToggle}
                className="rounded px-2.5 py-1.5 text-xs text-muted hover:text-primary hover:bg-card-elevated/80 transition-colors text-left"
              >
                Details
              </Link>
              {isCeo && (
                <button
                  type="button"
                  onClick={() => {
                    onMenuToggle();
                    onAbandonSector(sector._id);
                  }}
                  disabled={abandoningSectorId === sector._id}
                  className="rounded px-2.5 py-1.5 text-xs text-error hover:bg-error/10 transition-colors text-left disabled:opacity-50"
                  title="Abandon sector — revenue returns to unowned pool"
                >
                  {abandoningSectorId === sector._id ? "Abandoning…" : "Abandon"}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Mobile card ───────────────────────────────────────────────── */}
      <div className={`lg:hidden p-4 space-y-3 ${isMothballed ? "opacity-60" : ""}`}>
        {/* Identity row */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            {STATE_FLAGS[sector.stateId] ? (
              <Image
                src={STATE_FLAGS[sector.stateId]}
                alt={sector.stateName}
                width={24}
                height={16}
                className="rounded-sm object-cover shrink-0 w-6 h-4"
                unoptimized={bypassNextImageOptimization(STATE_FLAGS[sector.stateId])}
              />
            ) : (
              <span className="inline-flex items-center justify-center w-6 h-4 rounded-sm bg-card-elevated text-[7px] font-bold text-muted shrink-0">
                {sector.stateId.slice(0, 3)}
              </span>
            )}
            <Link
              href={`/corporation/${corpId}/sector/${sector._id}`}
              className="text-primary hover:underline font-semibold text-sm truncate"
            >
              {sector.displayName ?? sector.stateName}
            </Link>
            <span
              className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium shrink-0 ${typeColor}`}
            >
              {sector.sectorLabel}
            </span>
            {isMothballed && (
              <MothballedPill
                className="shrink-0"
                sectorType={sector.sectorType as CorporationType}
              />
            )}
            {sector.forSale && (
              <span
                className="inline-flex items-center rounded-full border border-success/40 bg-success/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-success shrink-0"
                title={`Listed for sale at ${fmtAnchor(sector.forSale.priceAnchor)}`}
              >
                For Sale
              </span>
            )}
            {sector.embargoSuspended && (
              <span
                className="inline-flex items-center rounded-full border border-error/40 bg-error/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-error shrink-0"
                title="Suspended by a total trade embargo against your nation — this sector earns no revenue until the embargo is lifted. Consider selling or relocating it."
              >
                Embargoed
              </span>
            )}
          </div>
          <Link
            href={`/corporation/${corpId}/sector/${sector._id}`}
            className="shrink-0 text-muted hover:text-primary transition-colors"
            title="View sector details"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M9 18l6-6-6-6" />
            </svg>
          </Link>
        </div>

        {/* Strategy + Status */}
        <div className="flex items-center gap-2 flex-wrap">
          {strategySelect(true)}
          {statusBadge}
        </div>

        {/* Metrics grid */}
        <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          {plantsMode ? (
            <>
              <div>
                <span className="text-[10px] text-muted uppercase tracking-wide">Capacity</span>
                <div className="text-sm tabular-nums font-medium text-foreground mt-0.5">
                  {formatUnits(sector.capacityUnits)}
                </div>
                <div className="text-[10px] text-muted/70">{CAPACITY_UNIT_LABEL}</div>
                <div className="text-[10px] tabular-nums text-muted">
                  {plantCount.toLocaleString("en-US")} {plantNoun}
                </div>
                <BuildQueueBadge queue={buildQueue} className="mt-1" />
              </div>
              <div>
                <span className="text-[10px] text-muted uppercase tracking-wide">Fill</span>
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  <FillChip fill={sector.fillRate} band={sector.fillRateBand} />
                  <DeliveryLimitedPill
                    fraction={deliveryLimited}
                    freightClass={sector.deliveryLimitedFreightClass}
                  />
                </div>
              </div>
            </>
          ) : (
            <>
              <div>
                <span
                  className="text-[10px] text-muted uppercase tracking-wide cursor-help"
                  title={`Growth target is applied over ${GROWTH_RATE_TURNS_PER_YEAR} turns (one game year)`}
                >
                  Growth Target
                </span>
                <div className="mt-1">
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
              </div>
              <div>
                <span
                  className="text-[10px] text-muted uppercase tracking-wide"
                  title="The growth rate actually applied this turn. It trends toward your target over time."
                >
                  Active Rate
                </span>
                <div className="mt-1">
                  <ActiveRateDisplay
                    currentRate={sector.currentGrowthRate}
                    targetRate={sector.targetGrowthRate}
                    align="left"
                  />
                </div>
              </div>
            </>
          )}
          <div>
            <span className="text-[10px] text-muted uppercase tracking-wide">
              Revenue {scaleLabel}
            </span>
            <div className="text-sm tabular-nums font-medium text-success mt-0.5">
              {fmtScaled(plantsMode ? realized : displayRevenue)}
            </div>
            {!plantsMode && showRealizationGap && (
              <div className="text-[10px] tabular-nums text-muted/70">
                nameplate {fmtScaled(nameplate)}
              </div>
            )}
            {!plantsMode && (
              <div className="text-[10px] tabular-nums text-muted">
                {sector.currentGrowthCost == null
                  ? "—"
                  : `-${fmtScaled(sector.currentGrowthCost)} cost`}
              </div>
            )}
          </div>
          <div>
            <span className="text-[10px] text-muted uppercase tracking-wide">
              Profit {scaleLabel}
            </span>
            <div
              className={`text-sm tabular-nums font-medium mt-0.5 ${sector.profit >= 0 ? "text-success" : "text-error"}`}
            >
              {fmtMoney(sector.profit * scaleFactor)}
            </div>
            <div
              className="text-[10px] tabular-nums text-muted"
              title={
                fillAdjusted != null
                  ? `Profit over the cost of everything made, unsold units included. Effective margin on sold units only: ${sector.effectiveProfitMargin}%.`
                  : undefined
              }
            >
              {fillAdjusted != null
                ? `${fillAdjusted}% after unsold`
                : `${sector.effectiveProfitMargin}% margin`}
            </div>
          </div>
        </div>

        {/* Build capacity — the primary CEO action under plants */}
        {plantsMode && isCeo && (
          <Link
            href={sectorBuildUrl(corpId, sector._id)}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-sm font-semibold text-primary transition-colors hover:bg-primary/20"
          >
            Build capacity here
          </Link>
        )}

        {/* Margin build & production policy toggle */}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-card-border bg-card-muted/30 px-3 py-1.5 text-xs font-medium text-muted hover:text-foreground"
        >
          {expanded ? "Hide margin breakdown" : "Margin build & production policy"}
          <svg
            className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`}
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

        {/* Mobile abandon */}
        {isCeo &&
          (mobileAbandonConfirm ? (
            <div className="rounded-lg border border-error/30 bg-error/10 p-3">
              <p className="text-sm font-semibold text-error">Are you sure?</p>
              <p className="mt-1 text-xs text-error/80">
                Abandoning a sector returns its revenue to the unowned pool.
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => setMobileAbandonConfirm(false)}
                  className="flex-1 rounded-lg border border-card-border px-3 py-2 text-sm font-medium text-muted hover:bg-card-elevated"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMobileAbandonConfirm(false);
                    onAbandonSector(sector._id);
                  }}
                  disabled={abandoningSectorId === sector._id}
                  className="flex-1 rounded-lg border border-error/40 bg-error px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-error/90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {abandoningSectorId === sector._id ? "Abandoning…" : "Yes, Abandon"}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setMobileAbandonConfirm(true)}
              disabled={abandoningSectorId === sector._id}
              className="w-full rounded-lg border border-error/30 bg-error/10 px-3 py-2 text-sm font-semibold text-error transition-colors hover:bg-error/15 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {abandoningSectorId === sector._id ? "Abandoning…" : "Abandon Sector"}
            </button>
          ))}
      </div>

      {/* ── Margin build & production-policy drill-down ───────────────── */}
      {expanded && <SectorMarginDrilldown sector={sector} isCeo={isCeo} corpId={corpId} />}

      {/* ── Strategy change confirmation ──────────────────────────────── */}
      {pendingChange && pendingChange.sectorId === sector._id && (
        <div className="px-4 lg:px-6 pb-3 pt-1">
          <StrategyChangeConfirm
            sectorType={sector.sectorType as CorporationType}
            currentStrategyId={currentId}
            targetStrategyId={pendingChange.targetStrategyId}
            dailyRevenue={sector.revenue}
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

      {/* ── Cancel transition confirmation ────────────────────────────── */}
      {cancelPending && onCancelTransition && (
        <div className="px-4 lg:px-6 pb-3 pt-1">
          <div className="rounded-lg border border-error/30 bg-error/10 p-3 flex items-center justify-between gap-3">
            <div className="text-xs text-error">
              Cancel transition? Cost: {fmtMoney(cancelCostDisplay)}
            </div>
            <div className="flex gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => setCancelPending(false)}
                className="rounded border border-card-border px-2 py-0.5 text-[11px] text-muted hover:bg-card-elevated"
              >
                No
              </button>
              <button
                type="button"
                onClick={() => {
                  onCancelTransition(sector._id);
                  setCancelPending(false);
                }}
                className="rounded bg-error px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-error/90"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </li>
  );
}
