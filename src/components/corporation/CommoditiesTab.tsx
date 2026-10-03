"use client";

import { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import { Skeleton } from "@/components/ui";
import { useCurrency } from "@/contexts/CurrencyContext";
import type { CorpCommodityFlow, CorpCommodityRegion } from "@/lib/corporations/corpCommodityFlows";
import type { CorpMarketSharePosition } from "@/lib/corporations/corpMarketShare";
import { DenseSection, TableScroll, Td, Th } from "./dense/DenseKit";

interface CommoditiesResponse {
  clearingEnabled: boolean;
  ledgerEnabled?: boolean;
  brandLoyaltyEnabled?: boolean;
  brandLoyaltySliceEnabled?: boolean;
  sectorQualityEnabled?: boolean;
  supplyAgreementsEnabled?: boolean;
  commodities: CorpCommodityFlow[];
  regions: CorpCommodityRegion[];
  marketShare?: CorpMarketSharePosition[];
  isPrivate?: boolean;
}

/** Compact unit formatter — thousands separators, at most one decimal. */
function fmtUnits(n: number): string {
  const abs = Math.abs(n);
  const decimals = abs > 0 && abs < 10 ? 1 : 0;
  return n.toLocaleString("en-US", { maximumFractionDigits: decimals });
}

/**
 * Corporation-level commodity flows: what this corporation produces and
 * consumes each turn, global stockpile context, CEO links, and the breakdown by
 * state, as two tables.
 */
export default function CommoditiesTab({
  corpId,
  isCeo = false,
  modViewEnabled = false,
}: {
  corpId: string;
  loading?: boolean;
  isCeo?: boolean;
  modViewEnabled?: boolean;
}) {
  const { formatAmount } = useCurrency();
  const [data, setData] = useState<CommoditiesResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const url = modViewEnabled
          ? `/api/corporations/${corpId}/commodities?modView=1`
          : `/api/corporations/${corpId}/commodities`;
        const res = await fetch(url);
        if (res.ok && !cancelled) setData(await res.json());
      } catch {
        // ignore — render empty state below
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [corpId, modViewEnabled]);

  if (loading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  const commodities = data?.commodities ?? [];
  const regions = data?.regions ?? [];

  if (commodities.length === 0) {
    return (
      <DenseSection title="Commodity flows">
        <p className="py-2 text-xs text-muted">
          {data?.isPrivate
            ? "Commodity flows are not disclosed for private corporations."
            : "This corporation isn't producing or consuming any commodities yet."}
        </p>
      </DenseSection>
    );
  }

  const features = [
    data?.clearingEnabled && "posted pricing (clearing)",
    data?.brandLoyaltyEnabled &&
      `brand loyalty${data.brandLoyaltySliceEnabled ? " (live in clearing)" : " (shadow accrual)"}`,
    data?.sectorQualityEnabled && "output quality",
    data?.supplyAgreementsEnabled && "supply agreements",
  ].filter(Boolean) as string[];

  const units = (n: number) => (n > 0 ? fmtUnits(n) : "");
  const money = (n: number | null) => (n == null ? "" : formatAmount(n));
  const netTone = (n: number) => (n > 0 ? "text-success" : n < 0 ? "text-error" : "text-muted");
  const COLS = 11;

  return (
    <div className="space-y-6">
      <DenseSection
        title="Per-turn commodity flows"
        meta={`${commodities.length} ${commodities.length === 1 ? "commodity" : "commodities"}`}
      >
        <p className="py-1 text-xs text-muted">
          Net production is this corporation&apos;s own output minus its input use. Purchases do not
          change it. The private supply line under a commodity shows where consumed inputs came
          from. Stock and cover are the world&apos;s shadow inventory from the market ledger, not
          this corporation&apos;s.
        </p>
        {features.length > 0 && (
          <p className="pb-1 text-xs text-muted">
            Market features on: {features.join(", ")}.
            {isCeo && data?.supplyAgreementsEnabled && (
              <>
                {" "}
                Private supply deals are under{" "}
                <Link
                  href={`/corporation/${corpId}?tab=commodities#supply-agreements`}
                  className="text-foreground underline underline-offset-2"
                >
                  Supply agreements
                </Link>
                .
              </>
            )}
          </p>
        )}
        <TableScroll>
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <Th>Commodity</Th>
                <Th align="right">Price</Th>
                <Th align="right">Output</Th>
                <Th align="right" title="Output valued at the current market price, per turn">
                  Value
                </Th>
                <Th align="right">Consumed</Th>
                <Th align="right" title="Consumption valued at the current market price, per turn">
                  Cost
                </Th>
                <Th align="right">Net production</Th>
                <Th align="right" title="Net production valued at the current market price">
                  Net value
                </Th>
                <Th align="right" title="Global stock in the market ledger">
                  Stock
                </Th>
                <Th align="right" title="Turns of global demand the stock covers">
                  Cover
                </Th>
                <Th>
                  <span className="sr-only">Links</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {commodities.map((c) => {
                const price = c.market.price ?? null;
                const ps = c.privateSupply;
                const pooled = [
                  c.market.surplusUnitsPooled != null && c.market.surplusUnitsPooled > 0
                    ? `Pooled surplus ${fmtUnits(c.market.surplusUnitsPooled)}`
                    : null,
                  c.market.unmetDemandUnitsPooled != null && c.market.unmetDemandUnitsPooled > 0
                    ? `Pooled unmet demand ${fmtUnits(c.market.unmetDemandUnitsPooled)}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(". ");
                return (
                  <Fragment key={c.commodity}>
                    <tr className="hover:bg-card-elevated/40">
                      <Td>
                        <span className="text-foreground">{c.label}</span>{" "}
                        <span className="text-[11px] text-muted">{c.unit}</span>
                      </Td>
                      <Td align="right" className="text-muted">
                        {price != null ? formatAmount(price) : ""}
                      </Td>
                      <Td align="right" className="text-foreground">
                        {units(c.outputUnits)}
                      </Td>
                      <Td align="right" className="text-muted">
                        {price != null && c.outputUnits > 0 ? money(c.outputUnits * price) : ""}
                      </Td>
                      <Td align="right" className="text-foreground">
                        {units(c.consumptionUnits)}
                      </Td>
                      <Td align="right" className="text-muted">
                        {price != null && c.consumptionUnits > 0
                          ? money(c.consumptionUnits * price)
                          : ""}
                      </Td>
                      <Td align="right" className={netTone(c.netUnits)}>
                        {c.netUnits > 0 ? "+" : ""}
                        {fmtUnits(c.netUnits)}
                      </Td>
                      <Td align="right" className={netTone(c.netUnits)}>
                        {price != null
                          ? `${c.netUnits > 0 ? "+" : ""}${formatAmount(c.netUnits * price)}`
                          : ""}
                      </Td>
                      <Td align="right" className="text-foreground" title={pooled || undefined}>
                        {c.market.stockUnits != null ? fmtUnits(c.market.stockUnits) : ""}
                        {pooled && <span className="ml-1 text-[10px] text-warning">*</span>}
                      </Td>
                      <Td align="right" className="text-foreground">
                        {c.market.coverTurns != null ? `${c.market.coverTurns.toFixed(1)}t` : ""}
                      </Td>
                      <Td numeric={false} className="whitespace-normal text-xs">
                        <span className="flex flex-wrap gap-x-2.5 gap-y-0.5">
                          <Link
                            href={`/commodity/${c.commodity}`}
                            className="text-foreground underline decoration-card-border underline-offset-2 hover:decoration-foreground"
                          >
                            Market
                          </Link>
                          {isCeo &&
                            data?.clearingEnabled &&
                            c.outputSectors?.map((s) => (
                              <Link
                                key={s.sectorId}
                                href={`/corporation/${corpId}/sector/${s.sectorId}`}
                                className="text-foreground underline decoration-card-border underline-offset-2 hover:decoration-foreground"
                              >
                                Pricing: {s.label}
                              </Link>
                            ))}
                          {isCeo && data?.supplyAgreementsEnabled && c.outputUnits > 0 && (
                            <Link
                              href={`/corporation/${corpId}?tab=commodities#supply-agreements`}
                              className="text-foreground underline decoration-card-border underline-offset-2 hover:decoration-foreground"
                            >
                              Supply deal
                            </Link>
                          )}
                        </span>
                      </Td>
                    </tr>
                    {ps && (
                      <tr>
                        <td
                          colSpan={COLS}
                          className="border-b border-card-border/60 pb-2 pl-4 pr-2 text-xs text-muted"
                        >
                          <span className="font-medium text-foreground">Private supply</span>{" "}
                          <span className="font-mono tabular-nums text-foreground">
                            {fmtUnits(ps.consumptionCoveredUnits)} of{" "}
                            {fmtUnits(ps.consumptionUnits)} {c.unit} consumed came from private
                            supply.
                          </span>{" "}
                          <span>
                            {fmtUnits(
                              Math.max(0, ps.consumptionUnits - ps.consumptionCoveredUnits)
                            )}{" "}
                            {c.unit} came from the open market or other sources.
                          </span>{" "}
                          <span className="tabular-nums">
                            Delivered on turn {ps.turn}. {fmtUnits(ps.coveragePercent)}% covered.
                            Contracted cap: {fmtUnits(ps.contractedUnits)} {c.unit}/turn.
                          </span>
                          {ps.previousTurn !== undefined &&
                            ps.previousDeliveredUnits !== undefined &&
                            ps.previousConsumptionUnits !== undefined && (
                              <span className="tabular-nums">
                                {" "}
                                Previous turn {ps.previousTurn}:{" "}
                                {fmtUnits(ps.previousDeliveredUnits)} delivered against{" "}
                                {fmtUnits(ps.previousConsumptionUnits)} consumed.
                              </span>
                            )}{" "}
                          <span>
                            Delivery can be below the cap when the supplier cannot cover all active
                            agreements or when your corporation consumes less. Scarce supplier
                            output is divided proportionally across active agreements.
                          </span>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </TableScroll>
      </DenseSection>

      {regions.length > 0 && (
        <DenseSection title="By region" meta="units per turn">
          <TableScroll>
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <Th>State</Th>
                  <Th>Produces</Th>
                  <Th>Consumes</Th>
                </tr>
              </thead>
              <tbody>
                {regions.map((r) => {
                  const made = r.rows.filter((row) => row.outputUnits > 0);
                  const used = r.rows.filter((row) => row.consumptionUnits > 0);
                  return (
                    <tr key={r.stateId} className="align-top">
                      <Td>
                        <span className="text-foreground">{r.stateName}</span>
                        {r.region && (
                          <span className="ml-1.5 text-[11px] text-muted">{r.region}</span>
                        )}
                      </Td>
                      <Td className="whitespace-normal text-xs">
                        {made.map((row, i) => (
                          <span key={row.commodity} className="text-foreground">
                            {row.label}{" "}
                            <span className="font-mono tabular-nums text-success">
                              {fmtUnits(row.outputUnits)}
                            </span>
                            {i < made.length - 1 ? ", " : ""}
                          </span>
                        ))}
                      </Td>
                      <Td className="whitespace-normal text-xs">
                        {used.map((row, i) => (
                          <span key={row.commodity} className="text-foreground">
                            {row.label}{" "}
                            <span className="font-mono tabular-nums text-muted">
                              {fmtUnits(row.consumptionUnits)}
                            </span>
                            {i < used.length - 1 ? ", " : ""}
                          </span>
                        ))}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableScroll>
        </DenseSection>
      )}
    </div>
  );
}
