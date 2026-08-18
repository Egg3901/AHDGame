"use client";

import Link from "next/link";
import { InfoTooltip } from "@/components/InfoTooltip";
import { ArrowDownToLine, ArrowUpFromLine, Pickaxe } from "lucide-react";
import type { CountryId } from "@/lib/constants/countries";
import { COMMODITY_LABELS, type CommodityType } from "@/lib/constants/commodities";
import { THROUGHPUT_MIN } from "@/lib/market/throughput";
import type { CurrencyCode } from "@/lib/constants/currencies";
import {
  getCommodityDisplayCurrency,
  convertCommodityPrice,
} from "@/lib/commodity-map/commodityPriceDisplay";
import ShortageBadge from "../components/ShortageBadge";
import DetailsDisclosure from "../components/DetailsDisclosure";
import type { CommoditiesData, CommodityFlow, ExtractionCapacityRow, PlantsData } from "../types";
import { fmtUnits, fmtPct } from "../lib/plants";

interface InputsOutputsPanelProps {
  commodities: CommoditiesData;
  plants: PlantsData;
  countryId: CountryId;
  /** Extraction only — what is left in the ground in this region. */
  capacityRows?: ExtractionCapacityRow[] | null;
  isExtraction: boolean;
  forexEnabled: boolean;
  exchangeRates: Partial<Record<CurrencyCode, number>>;
}

function fmtPrice(v: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(
    Math.round(v * 100) / 100
  );
}

/**
 * Inputs and outputs, side by side.
 *
 * The old page split these across two panels in two tabs: what the sector BUYS
 * lived in one place and what it SELLS in another, so the single most useful
 * comparison in the whole economy — the price of what you buy against the price
 * of what you sell — was never on screen at once. Under plants that gap is
 * worse, because the input bill is now a real bill. This puts them adjacent.
 */
export default function InputsOutputsPanel({
  commodities,
  plants,
  countryId,
  capacityRows,
  isExtraction,
  forexEnabled,
  exchangeRates,
}: InputsOutputsPanelProps) {
  const currencyCode = getCommodityDisplayCurrency(countryId);
  const price = (v: number) =>
    fmtPrice(convertCommodityPrice(v, currencyCode, forexEnabled, exchangeRates));

  // Per-output clear rate, NOT the sector-wide blend. `plants.fillRate` is
  // soldUnits/producedUnits summed across the whole mix, so painting it on every
  // output row told a gas-and-oil extractor the same number twice and hid which
  // commodity was actually the one sitting unsold. Fall back to the blend only
  // when the per-commodity figure has not been persisted yet.
  const soldShareFor = (f: CommodityFlow) => f.soldFraction ?? plants.fillRate;
  const hasPerOutput = commodities.supplies.some((f) => f.soldFraction != null);
  // What the engine actually applied, floored at THROUGHPUT_MIN, the raw
  // availability ratio on the rows above is uncapped and is not the throttle.
  const throttleApplied = commodities.throughput?.applied ?? commodities.throughput?.projected;

  return (
    <div className="rounded-xl border border-card-border bg-card p-6 shadow-card">
      <h2 className="text-heading-sm font-bold text-foreground">What goes in, what comes out</h2>
      <p className="mb-4 mt-1 text-body-sm text-muted">
        Your plants buy the things on the left and make the things on the right. Prices are per
        unit, in {currencyCode}.{" "}
        {hasPerOutput && "Each thing you make sells at its own rate, the rows are not one number."}
      </p>

      {/*
        Grid items default to min-width:auto, so a buy-row that cannot shrink
        (icon + label + price + "66% on the world market") overflows into the
        make column and paints over it. `min-w-0` lets the track shrink; wrap
        on each row so the trailing stats drop under the label instead of
        colliding. Two columns only from xl, lg was still too tight.
      */}
      <div data-io-grid className="grid min-w-0 grid-cols-1 gap-5 xl:grid-cols-2">
        {/* Inputs ───────────────────────────────────────────────────────────*/}
        <section aria-labelledby="io-inputs" className="min-w-0">
          <h3
            id="io-inputs"
            className="mb-2 flex items-center gap-1.5 text-body-xs font-semibold uppercase tracking-wider text-muted"
          >
            <ArrowDownToLine className="h-3.5 w-3.5" aria-hidden /> Things you buy
          </h3>
          {commodities.demands.length === 0 ? (
            <p className="rounded-lg border border-dashed border-card-border px-3 py-4 text-center text-body-sm text-muted">
              This sector buys nothing on the commodity market.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {commodities.demands.map((f) => (
                <FlowRow
                  key={f.commodity}
                  flow={f}
                  countryId={countryId}
                  priceText={price(f.billedUnitPrice ?? f.marketPrice)}
                  right={
                    f.inputAvailability != null && f.inputAvailability < 0.999 ? (
                      <InfoTooltip
                        width={280}
                        trigger={
                          <span className="cursor-help border-b border-dotted border-warning/40 text-body-xs font-semibold tabular-nums text-warning">
                            {fmtPct(f.inputAvailability)} on the world market
                          </span>
                        }
                      >
                        <p className="mb-1 font-semibold text-foreground">
                          {fmtPct(f.inputAvailability)} of {f.label} demand is covered
                        </p>
                        <p className="text-muted">
                          This is the WORLD market for {f.label}, not this region. It is what
                          everyone everywhere wants against what everyone everywhere makes.
                        </p>
                      </InfoTooltip>
                    ) : null
                  }
                  badge={
                    f.shortageRatio != null && f.shortageRatio > 1.2 ? (
                      <ShortageBadge ratio={f.shortageRatio} />
                    ) : null
                  }
                />
              ))}
            </ul>
          )}
          {commodities.throughput?.bindingInput && (
            <p className="mt-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-body-sm text-foreground">
              Short supply of{" "}
              <span className="font-semibold">
                {COMMODITY_LABELS[commodities.throughput.bindingInput as CommodityType] ??
                  commodities.throughput.bindingInput}
              </span>{" "}
              is holding your line back. That is the &quot;waiting on inputs&quot; slice in the run
              meter above.
              {throttleApplied != null && (
                <>
                  {" "}
                  Your plants ran at{" "}
                  <span className="font-semibold tabular-nums">{fmtPct(throttleApplied)}</span> of
                  what they could have. A shortage never cuts you below {fmtPct(THROUGHPUT_MIN)}, so
                  a worse world number than that does not bite any harder.
                </>
              )}
            </p>
          )}
        </section>

        {/* Outputs ──────────────────────────────────────────────────────────*/}
        <section aria-labelledby="io-outputs" className="min-w-0">
          <h3
            id="io-outputs"
            className="mb-2 flex items-center gap-1.5 text-body-xs font-semibold uppercase tracking-wider text-muted"
          >
            <ArrowUpFromLine className="h-3.5 w-3.5" aria-hidden /> Things you make
          </h3>
          {commodities.supplies.length === 0 ? (
            <p className="rounded-lg border border-dashed border-card-border px-3 py-4 text-center text-body-sm text-muted">
              This sector makes nothing the commodity market tracks.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {commodities.supplies.map((f) => (
                <FlowRow
                  key={f.commodity}
                  flow={f}
                  countryId={countryId}
                  priceText={price(f.marketPrice)}
                  right={(() => {
                    const share = soldShareFor(f);
                    if (share == null) return null;
                    const perOutput = f.soldFraction != null;
                    return (
                      <InfoTooltip
                        width={280}
                        trigger={
                          <span
                            className={`cursor-help border-b border-dotted border-muted/40 text-body-xs tabular-nums ${
                              share < 0.9 ? "text-warning" : "text-muted"
                            }`}
                          >
                            {fmtPct(share)} sold
                          </span>
                        }
                      >
                        <p className="mb-1 font-semibold text-foreground">
                          {perOutput
                            ? `${fmtPct(share)} of your ${f.label} sold`
                            : `${fmtPct(share)} of everything you make sold`}
                        </p>
                        <p className="text-muted">
                          {perOutput
                            ? "This is this output on its own. Each thing you make can clear at a different rate, so read the rows against each other to find the one that is not moving."
                            : "This sector has not cleared a turn yet, so this is the average across everything you make, not this output on its own."}
                        </p>
                      </InfoTooltip>
                    );
                  })()}
                  badge={null}
                />
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Deposits (extraction only) ─────────────────────────────────────────*/}
      {isExtraction && capacityRows && capacityRows.length > 0 && (
        <div className="mt-5 border-t border-card-border pt-4">
          <h3 className="mb-2 flex items-center gap-1.5 text-body-xs font-semibold uppercase tracking-wider text-muted">
            <Pickaxe className="h-3.5 w-3.5" aria-hidden /> What is left in the ground here
          </h3>
          <ul className="space-y-1.5">
            {capacityRows.map((row) => {
              const used = row.capacity > 0 ? Math.min(1, row.desired / row.capacity) : 1;
              return (
                <li
                  key={row.resource}
                  className="rounded-lg border border-card-border bg-background/40 p-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate text-body-sm text-foreground">{row.resource}</span>
                    <span className="shrink-0 text-body-sm tabular-nums text-muted">
                      {fmtUnits(row.desired)} wanted / {fmtUnits(row.capacity)} available
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-track">
                    <div
                      className={`h-full ${row.headroom < 0 ? "bg-error" : "bg-success"}`}
                      style={{ width: `${used * 100}%` }}
                    />
                  </div>
                  {row.headroom < 0 && (
                    <p className="mt-1.5 text-body-xs text-error">
                      Everyone here wants more than the ground holds. Your output is cut to fit.
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <DetailsDisclosure className="mt-4">
        <dl className="space-y-1.5 text-body-sm">
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted">Net effect of prices on your margin</dt>
            <dd
              className={`tabular-nums ${
                commodities.commodityMarginModifier >= 0 ? "text-success" : "text-error"
              }`}
            >
              {commodities.commodityMarginModifier >= 0 ? "+" : ""}
              {commodities.commodityMarginModifier}%
            </dd>
          </div>
          {commodities.throughput && (
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted">Input availability applied last turn</dt>
              <dd className="tabular-nums text-foreground">
                {fmtPct(commodities.throughput.applied)}
              </dd>
            </div>
          )}
          {commodities.commoditySupplyDemandBlendPct && (
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted">Price blend (world / country / region)</dt>
              <dd className="tabular-nums text-foreground">
                {commodities.commoditySupplyDemandBlendPct.global}% /{" "}
                {commodities.commoditySupplyDemandBlendPct.national}% /{" "}
                {commodities.commoditySupplyDemandBlendPct.local}%
              </dd>
            </div>
          )}
        </dl>
      </DetailsDisclosure>
    </div>
  );
}

function FlowRow({
  flow,
  countryId,
  priceText,
  right,
  badge,
}: {
  flow: CommodityFlow;
  countryId: CountryId;
  priceText: string;
  right: React.ReactNode;
  badge: React.ReactNode;
}) {
  return (
    <li className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-card-border bg-background/40 px-3 py-2">
      <Link
        href={`/commodities/${flow.commodity}?country=${countryId}`}
        className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded border text-body-xs font-bold transition-opacity hover:opacity-80 ${flow.colors}`}
        aria-label={`Open the ${flow.label} market`}
      >
        {flow.icon}
      </Link>
      {/* `min-w-0` on the tooltip wrapper, not just the inner span: InfoTooltip
          renders an inline-block, which as a flex child refuses to shrink below
          its content, so the label overran the numbers on the right instead of
          truncating. */}
      <InfoTooltip
        width={260}
        className="min-w-0 flex-1"
        trigger={
          <span className="block cursor-help truncate border-b border-dotted border-muted/40 text-body-sm text-foreground">
            {flow.label}
          </span>
        }
      >
        <p className="mb-1 font-semibold text-foreground">{flow.label}</p>
        <p className="text-muted">
          {fmtUnits(flow.units, 1)} {flow.unit} a day at {priceText} each.
        </p>
      </InfoTooltip>
      {badge && <span className="shrink-0">{badge}</span>}
      <span className="shrink-0 text-body-sm tabular-nums text-muted">
        <span className="font-semibold text-foreground">{fmtUnits(flow.units, 1)}</span> ·{" "}
        {priceText}
      </span>
      {right && <span className="shrink-0">{right}</span>}
    </li>
  );
}
