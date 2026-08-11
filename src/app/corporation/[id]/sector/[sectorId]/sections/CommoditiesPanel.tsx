"use client";

import Link from "next/link";
import { InfoTooltip } from "@/components/InfoTooltip";
import ShortageBadge from "../components/ShortageBadge";
import type { CountryId } from "@/lib/constants/countries";
import type { CurrencyCode } from "@/lib/constants/currencies";
import {
  getCommodityDisplayCurrency,
  convertCommodityPrice,
} from "@/lib/commodity-map/commodityPriceDisplay";
import type { CommoditiesData, CommodityFlow, ExtractionCapacityRow } from "../types";

interface CommoditiesPanelProps {
  commodities: CommoditiesData;
  countryId: CountryId;
  /** Extraction only — per-resource state capacity, so supply rows can show
   *  "your output vs what is left" without sending the player to another tab. */
  capacityRows?: ExtractionCapacityRow[] | null;
  forexEnabled: boolean;
  exchangeRates: Partial<Record<CurrencyCode, number>>;
}

/** Compact unit formatter shared by the row header and the capacity strip. */
function fmtUnits(value: number): string {
  const v = Math.abs(value);
  if (v >= 1000) return `${(value / 1000).toFixed(1)}K`;
  if (v >= 10) return Math.round(value).toString();
  return value.toFixed(1);
}

function formatPrice(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(
    Math.round(value * 100) / 100
  );
}

function getPriceToneClass(value: number, basePrice: number, isDemand: boolean): string {
  if (value === basePrice) return "text-muted";
  const isHigh = value > basePrice;
  if (isDemand) {
    return isHigh ? "text-error" : "text-success";
  }
  return isHigh ? "text-success" : "text-error";
}

function CommodityItem({
  flow,
  isDemand,
  countryId,
  capacityRow,
  forexEnabled,
  exchangeRates,
}: {
  flow: CommodityFlow;
  isDemand: boolean;
  countryId: CountryId;
  /** State capacity for this resource, when it is an extractable. */
  capacityRow?: ExtractionCapacityRow | null;
  forexEnabled: boolean;
  exchangeRates: Partial<Record<CurrencyCode, number>>;
}) {
  const currencyCode = getCommodityDisplayCurrency(countryId);
  const displayGlobal = convertCommodityPrice(
    flow.globalPrice,
    currencyCode,
    forexEnabled,
    exchangeRates
  );
  const displayNational = convertCommodityPrice(
    flow.nationalPrice,
    currencyCode,
    forexEnabled,
    exchangeRates
  );
  const displayRegional = convertCommodityPrice(
    flow.regionalPrice,
    currencyCode,
    forexEnabled,
    exchangeRates
  );
  const displayBase = convertCommodityPrice(
    flow.basePrice,
    currencyCode,
    forexEnabled,
    exchangeRates
  );

  return (
    <div>
      <div className="flex items-center gap-2 text-sm">
        <Link
          href={`/commodity/${flow.commodity}`}
          className={`inline-flex items-center justify-center w-6 h-6 rounded text-[10px] font-bold border ${flow.colors} hover:opacity-80 transition-opacity shrink-0`}
        >
          {flow.icon}
        </Link>
        <Link
          href={`/commodity/${flow.commodity}`}
          className="text-foreground flex-1 truncate hover:text-primary transition-colors"
        >
          {flow.label}
          {isDemand && flow.shortageRatio != null && flow.shortageRatio > 1 && (
            <ShortageBadge ratio={flow.shortageRatio} />
          )}
        </Link>
        <span
          className={`font-medium tabular-nums text-xs shrink-0 ${isDemand ? "text-error" : "text-success"}`}
        >
          {flow.units >= 1000
            ? `${(flow.units / 1000).toFixed(1)}K`
            : flow.units >= 10
              ? Math.round(flow.units).toString()
              : flow.units.toFixed(1)}{" "}
          {flow.unit}
        </span>
      </div>
      <div className="ml-8 mt-0.5 space-y-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px]">
          <span className="text-muted tabular-nums">{flow.weight}% weight</span>
          <span
            className={`tabular-nums ${getPriceToneClass(displayGlobal, displayBase, isDemand)}`}
          >
            G {formatPrice(displayGlobal)}
          </span>
          <span
            className={`tabular-nums ${getPriceToneClass(displayNational, displayBase, isDemand)}`}
          >
            N {formatPrice(displayNational)}
          </span>
          <span
            className={`tabular-nums ${getPriceToneClass(displayRegional, displayBase, isDemand)}`}
          >
            R {formatPrice(displayRegional)}
          </span>
        </div>
        {flow.priceImpact !== 0 && (
          <div>
            <InfoTooltip
              trigger={
                <span
                  className={`text-[10px] font-medium tabular-nums ${
                    flow.priceImpact > 0 ? "text-success" : "text-error"
                  }`}
                >
                  {flow.priceImpact > 0 ? "+" : ""}
                  {flow.priceImpact}% margin
                </span>
              }
            >
              {isDemand
                ? "How this input's current market price moves your sector's profit margin vs. baseline. Positive means it's cheaper than normal right now (helps your margin); negative means it's pricier (squeezes it). It's a percentage-point contribution to margin, not the sector's total margin."
                : "How this output's current market price moves your sector's profit margin vs. baseline. Positive means it's selling above its normal price (helps your margin); negative means it's selling below (squeezes it). It's a percentage-point contribution to margin, not the sector's total margin."}
            </InfoTooltip>
          </div>
        )}
        {flow.priceImpact === 0 && <span className="text-[10px] text-muted">balanced</span>}
        {isDemand && flow.inputAvailability != null && flow.inputAvailability < 0.98 && (
          <div
            className={`text-[10px] font-medium tabular-nums ${
              flow.inputAvailability < 0.6 ? "text-error" : "text-warning"
            }`}
            title={`The world market only supplies ${Math.round(flow.inputAvailability * 100)}% of the demand for this input. That is a global shortage, not something about your state or region. Whichever input is hardest to get caps what you can make, so lock in supply or switch inputs.`}
          >
            {Math.round(flow.inputAvailability * 100)}% available globally (input-limited)
          </div>
        )}
        {!isDemand && flow.soldFraction != null && (
          <div>
            <InfoTooltip
              trigger={
                <span
                  className={`text-[10px] font-medium tabular-nums ${
                    flow.soldFraction >= 0.995
                      ? "text-success"
                      : flow.soldFraction >= 0.7
                        ? "text-warning"
                        : "text-error"
                  }`}
                >
                  {Math.round(flow.soldFraction * 100)}% of this output sold
                </span>
              }
            >
              How much of THIS commodity cleared last turn. The Pricing panel shows one blended
              figure across every output this sector makes, so a sector that sells one commodity out
              completely and another barely at all still reads as a middling number there. Use this
              row to see which output is the one not selling.
            </InfoTooltip>
          </div>
        )}
        {!isDemand &&
          flow.realizationFactor != null &&
          flow.realizationPriceOverBase != null &&
          Math.abs(flow.realizationFactor - 1) >= 0.005 && (
            <div
              className={`text-[10px] font-medium tabular-nums ${
                flow.realizationFactor > 1 ? "text-success" : "text-error"
              }`}
              title={`Market price is ${flow.realizationPriceOverBase.toFixed(2)}× the normal price as of last turn, so what you earn here is multiplied by ${flow.realizationFactor}. Shortages pay more, gluts pay less.`}
            >
              Realizes ×{flow.realizationFactor.toFixed(2)} @{" "}
              {flow.realizationPriceOverBase.toFixed(2)}× base
            </div>
          )}
        {/* "How much am I pulling vs how much is left?" — the two halves of that
            question used to live on different tabs: your output here on Market,
            state capacity over on Operations in ResourceCapacityPanel. Player
            report, #gameplay-advisors 2026-07-29. Put both on the row. */}
        {!isDemand && capacityRow && (
          <div className="rounded border border-card-border/60 bg-card-elevated/40 px-2 py-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] tabular-nums">
              <span className="text-muted">
                you <span className="font-semibold text-foreground">{fmtUnits(flow.units)}</span>
              </span>
              <span className="text-muted/50">·</span>
              <span className="text-muted">
                state capacity{" "}
                <span className="font-semibold text-foreground">
                  {fmtUnits(capacityRow.capacity)}
                </span>
              </span>
              <span className="text-muted/50">·</span>
              <span
                className={
                  capacityRow.headroom > 0
                    ? "text-success"
                    : capacityRow.headroom < 0
                      ? "text-error"
                      : "text-muted"
                }
                title={
                  capacityRow.headroom >= 0
                    ? "Unclaimed capacity left in this state, across every extraction sector operating here. Room to grow into."
                    : "Sectors here are trying to pull out more than this state's deposits can give. Every sector, including yours, gets cut back to fit."
                }
              >
                {capacityRow.headroom >= 0
                  ? `${fmtUnits(capacityRow.headroom)} headroom`
                  : `${fmtUnits(Math.abs(capacityRow.headroom))} over the limit`}
              </span>
            </div>
            <div className="mt-1 h-1 overflow-hidden rounded-full bg-card-border">
              <div
                className={`h-full rounded-full ${
                  capacityRow.headroom < 0 ? "bg-error" : "bg-success"
                }`}
                style={{
                  width: `${Math.min(100, capacityRow.capacity > 0 ? (capacityRow.desired / capacityRow.capacity) * 100 : 0)}%`,
                }}
                title={`All extraction sectors in this state want ${fmtUnits(capacityRow.desired)} of ${fmtUnits(capacityRow.capacity)} capacity`}
              />
            </div>
          </div>
        )}
        {!isDemand && flow.capacityMultiplier != null && flow.capacityMultiplier < 1 && (
          <div>
            <InfoTooltip
              trigger={
                <span
                  className={`text-[10px] font-medium tabular-nums ${
                    flow.capacityMultiplier <= 0
                      ? "text-muted"
                      : flow.capacityMultiplier < 0.5
                        ? "text-error"
                        : "text-warning"
                  }`}
                >
                  {flow.capacityMultiplier <= 0
                    ? "No deposits in this state (0% capacity)"
                    : `Capacity utilization: ${Math.round(flow.capacityMultiplier * 100)}% (revenue-limited)`}
                </span>
              }
            >
              Extraction capacity is a per-state ceiling on how much of this raw resource you can
              pull to market. Revenue-limited means you have the output but only the share that fits
              under capacity earns revenue; the rest is stranded. Raise it by acquiring capacity,
              focusing your extraction, or expanding into states with headroom.
            </InfoTooltip>
          </div>
        )}
      </div>
    </div>
  );
}

export default function CommoditiesPanel({
  commodities,
  countryId,
  capacityRows,
  forexEnabled,
  exchangeRates,
}: CommoditiesPanelProps) {
  const capacityByResource = new Map((capacityRows ?? []).map((r) => [r.resource, r]));
  if (commodities.supplies.length === 0 && commodities.demands.length === 0) {
    return null;
  }

  return (
    <div className="rounded-xl border border-card-border bg-card p-6">
      <h2 className="text-lg font-bold text-foreground mb-1">Commodity Flows</h2>
      <p className="text-xs text-muted mb-2">
        What this sector produces and consumes daily, with per-commodity impact on margins.
      </p>
      <p className="text-xs text-muted mb-4">
        G = global price, N = national price, R = regional price. Numbers are shown in the sector
        currency.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {commodities.supplies.length > 0 && (
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-muted mb-2">
              Supplies (output revenue)
            </div>
            <div className="space-y-2.5">
              {commodities.supplies.map((s) => (
                <CommodityItem
                  key={s.commodity}
                  flow={s}
                  isDemand={false}
                  countryId={countryId}
                  capacityRow={capacityByResource.get(s.commodity) ?? null}
                  forexEnabled={forexEnabled}
                  exchangeRates={exchangeRates}
                />
              ))}
            </div>
          </div>
        )}
        {commodities.demands.length > 0 && (
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-muted mb-2">
              Demands (input costs)
            </div>
            <div className="space-y-2.5">
              {commodities.demands.map((d) => (
                <CommodityItem
                  key={d.commodity}
                  flow={d}
                  isDemand={true}
                  countryId={countryId}
                  forexEnabled={forexEnabled}
                  exchangeRates={exchangeRates}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {commodities.throughput && (
        <div className="mt-4 pt-3 border-t border-card-border flex items-center justify-between text-sm">
          <InfoTooltip
            trigger={
              <span className="text-muted border-b border-dotted border-muted/40 cursor-default">
                Input throughput
              </span>
            }
            width={300}
          >
            <p className="text-muted text-xs">
              Whichever input is hardest to get caps what you can make. If the world market supplies
              only 60% of the steel everyone wants, you can only build about 60% of your cars, no
              matter what is available in your own state or region. This limit phases in over 5 game
              years so supply chains have time to adapt, and it never cuts you below 50%.
              {commodities.throughput.bindingInput && (
                <>
                  {" "}
                  Binding input:{" "}
                  <span className="font-medium text-foreground">
                    {commodities.throughput.bindingInput.replace(/_/g, " ")}
                  </span>
                  .
                </>
              )}
              {commodities.throughput.applied != null && (
                <>
                  {" "}
                  Last turn&apos;s applied throttle:{" "}
                  <span className="font-medium text-foreground tabular-nums">
                    ×{commodities.throughput.applied.toFixed(2)}
                  </span>
                  .
                </>
              )}
            </p>
          </InfoTooltip>
          <span
            className={`font-bold tabular-nums ${
              commodities.throughput.projected >= 0.98
                ? "text-muted"
                : commodities.throughput.projected >= 0.8
                  ? "text-warning"
                  : "text-error"
            }`}
          >
            ×{commodities.throughput.projected.toFixed(2)}
          </span>
        </div>
      )}

      {commodities.priceRealization && (
        <div className="mt-4 pt-3 border-t border-card-border flex items-center justify-between text-sm">
          <InfoTooltip
            trigger={
              <span className="text-muted border-b border-dotted border-muted/40 cursor-default">
                Price realization
              </span>
            }
            width={300}
          >
            <p className="text-muted text-xs">
              Your realized revenue is scaled by the market price of what you sell, using last
              turn&apos;s prices weighted by your output mix. Selling into a shortage pays a premium
              (up to +50%); selling into a glut discounts your revenue (down to −30%). Expand where
              prices are above normal, but the bonus shrinks as the shortage closes.
              {commodities.priceRealization.applied != null && (
                <>
                  {" "}
                  Last turn this sector realized{" "}
                  <span className="font-medium text-foreground tabular-nums">
                    ×{commodities.priceRealization.applied.toFixed(2)}
                  </span>
                  .
                </>
              )}
            </p>
          </InfoTooltip>
          <span
            className={`font-bold tabular-nums ${
              Math.abs(commodities.priceRealization.projected - 1) < 0.005
                ? "text-muted"
                : commodities.priceRealization.projected > 1
                  ? "text-success"
                  : "text-error"
            }`}
          >
            ×{commodities.priceRealization.projected.toFixed(2)}
          </span>
        </div>
      )}

      <div className="mt-4 pt-3 border-t border-card-border flex items-center justify-between text-sm">
        <InfoTooltip
          trigger={
            <span className="text-muted border-b border-dotted border-muted/40 cursor-default">
              Net commodity modifier
            </span>
          }
          width={280}
        >
          <p className="text-muted text-xs">
            Sum of input and output commodity effects, blended across global, national, and regional
            supply and demand. Raw D/S above 3x continues to worsen, but margin pressure uses a
            softened effective ratio.
            {commodities.commoditySupplyDemandBlendPct ? (
              <>
                {" "}
                Current blend (global / national / regional):{" "}
                <span className="font-medium text-foreground tabular-nums">
                  {commodities.commoditySupplyDemandBlendPct.global}/
                  {commodities.commoditySupplyDemandBlendPct.national}/
                  {commodities.commoditySupplyDemandBlendPct.local}
                </span>
                .
              </>
            ) : null}
          </p>
        </InfoTooltip>
        <span
          className={`font-bold tabular-nums ${
            commodities.commodityMarginModifier === 0
              ? "text-muted"
              : commodities.commodityMarginModifier > 0
                ? "text-success"
                : "text-error"
          }`}
        >
          {commodities.commodityMarginModifier > 0 ? "+" : ""}
          {commodities.commodityMarginModifier}%
        </span>
      </div>
    </div>
  );
}
