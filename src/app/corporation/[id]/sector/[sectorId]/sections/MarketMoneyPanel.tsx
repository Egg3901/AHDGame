"use client";

import { InfoTooltip } from "@/components/InfoTooltip";
import { useCurrency } from "@/contexts/CurrencyContext";
import { Coins } from "lucide-react";
import { MONEY_PERIOD_FACTOR } from "@/lib/constants/moneyTimescale";
import type { PlantsData, Financials, CorporationRef } from "../types";
import type { CurrencyCode } from "@/lib/constants/currencies";
import DetailsDisclosure from "../components/DetailsDisclosure";
import { fmtUnits, fmtPct, PLANTS_CLOCK_NOTE } from "../lib/plants";
import type { CorporationType } from "@/lib/constants/corporations";
import { facilityPlural } from "@/lib/constants/facilityVocabulary";
import { COMMODITY_LABELS, type CommodityType } from "@/lib/constants/commodities";

interface MarketMoneyPanelProps {
  plants: PlantsData;
  /** Drives the facility noun in the cost lines. */
  sectorType: CorporationType;
  financials: Financials | null;
  corporation: CorporationRef;
}

/**
 * Market and money. Replaces the financials panel under plants.
 *
 * The chain reads top to bottom with nothing skipped:
 *   offered → sold → unsold → revenue → each physical cost → profit
 *
 * Every cost line comes out of the SAME operating bill the turn engine charged,
 * so `revenue − Σ(lines) = profit` holds on screen exactly. "Other running
 * costs" is the residual by construction, which is what makes the identity
 * exact rather than approximately right.
 */
export default function MarketMoneyPanel({
  plants,
  sectorType,
  financials,
  corporation,
}: MarketMoneyPanelProps) {
  const sites = facilityPlural(sectorType);
  const { formatAmount, formatPrice, toInternalFrom } = useCurrency();
  const money = (anchor: number) => formatAmount(anchor);
  // Per-unit figures are often well under $1 (plants mixPrice). formatAmount
  // rounds to whole currency units and painted "$0" on a real ~$0.05 sale
  // (ticket #1026). formatPrice keeps cent / sub-cent precision.
  const unitMoney = (anchor: number) => formatPrice(anchor);
  const pnl = plants.pnl;
  const truth = plants.truth ?? null;

  const liquidCode = (corporation.liquidCurrencyCode as CurrencyCode | undefined) ?? undefined;
  const corpMoney = (val: number) =>
    formatAmount(liquidCode ? toInternalFrom(val, liquidCode) : val, liquidCode);

  const offered = plants.producedUnits ?? 0;
  const sold = plants.soldUnits ?? 0;
  const unsold = plants.unsoldUnits ?? 0;

  const costLines: { key: string; label: string; value: number; help: string }[] = [
    {
      key: "inputs",
      label: "Things you bought",
      value: pnl.inputsAnchor,
      help: `What your ${sites} paid for the materials and services they consumed, at today's market prices. When a price moves, this line moves.`,
    },
    {
      key: "labour",
      label: "Wages",
      value: pnl.labourAnchor,
      help: "Pay for the workers staffing this capacity.",
    },
    {
      key: "upkeep",
      label: `Upkeep on idle ${sites}`,
      value: pnl.upkeepAnchor,
      help: "Capacity you own but did not run still costs money to hold: the site, the maintenance, a skeleton crew. Mothballing cuts this further.",
    },
    {
      key: "compliance",
      label: "Regulation",
      value: pnl.complianceAnchor,
      help: "Extra cost the regulator puts on a sector that dominates its market.",
    },
    {
      key: "other",
      label: "Other running costs",
      value: pnl.otherOperatingAnchor,
      help: "Overheads, distribution, insurance and rent. Everything the lines above do not name.",
    },
    {
      key: "growth",
      label: "Growth and building",
      value: pnl.growthAndBuildAnchor,
      help: "What you spend each day expanding this sector.",
    },
  ];

  const totalCosts = costLines.reduce((s, l) => s + l.value, 0);

  return (
    <div className="rounded-xl border border-card-border bg-card p-6 shadow-card">
      <h2 className="flex items-center gap-2 text-heading-sm font-bold text-foreground">
        <Coins className="h-4 w-4 text-muted" aria-hidden />
        Market and money
      </h2>
      <p className="mb-4 mt-1 text-body-sm text-muted">{PLANTS_CLOCK_NOTE}</p>

      {/* Truth headline ─────────────────────────────────────────────────────
          Three numbers, before anything else: how much of the output sells,
          what a produced unit brings in against what it costs, and whether the
          money already sunk into construction ever comes back at this rate.
          These come from the query layer (SectorPlantsSection.truth), computed
          off the same telemetry as the money chain below, so they cannot
          disagree with it. */}
      {truth && (
        <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <UnitTile
            label="Selling"
            value={truth.soldFraction != null ? `${fmtPct(truth.soldFraction)} of output` : "—"}
            tone={
              truth.soldFraction == null
                ? "muted"
                : truth.soldFraction < 0.5
                  ? "warning"
                  : "success"
            }
            help={
              truth.soldByCommodity.length > 0
                ? `The share of what you make that buyers actually take. By product: ${truth.soldByCommodity
                    .map(
                      (s) =>
                        `${COMMODITY_LABELS[s.commodity as CommodityType] ?? s.commodity} ${fmtPct(s.fraction)}`
                    )
                    .join(", ")}.`
                : "The share of what you make that buyers actually take. Units that do not sell cost you money and earn nothing."
            }
          />
          <UnitTile
            label="Per unit made"
            value={
              truth.receivedPerUnitAnchor != null && truth.costPerUnitAnchor != null
                ? `earns ${unitMoney(truth.receivedPerUnitAnchor)}, costs ${unitMoney(truth.costPerUnitAnchor)}`
                : "—"
            }
            tone={
              truth.receivedPerUnitAnchor != null &&
              truth.costPerUnitAnchor != null &&
              truth.receivedPerUnitAnchor < truth.costPerUnitAnchor
                ? "warning"
                : "default"
            }
            help="What a unit coming off the line brought in, counting unsold units as earning nothing, against what it cost to run the operation per unit made: materials, wages, upkeep on idle capacity and overheads."
          />
          <UnitTile
            label="Break even"
            value={
              truth.breakEven.status === "profitable_now"
                ? "Profitable now"
                : truth.breakEven.status === "turns"
                  ? `${fmtUnits(truth.breakEven.turns)} turns`
                  : "Not at current fills"
            }
            tone={
              truth.breakEven.status === "profitable_now"
                ? "success"
                : truth.breakEven.status === "turns"
                  ? "default"
                  : "warning"
            }
            help="How the money already paid for capacity still under construction relates to what this sector clears. A turn count means profit at today's rate pays that spend back in that many turns. Not at current fills means the sector does not clear a profit at today's sales."
          />
        </div>
      )}

      {/* Units chain ────────────────────────────────────────────────────────*/}
      <div className="grid grid-cols-3 gap-2">
        <UnitTile
          label="Offered"
          value={fmtUnits(offered)}
          help={`Units your ${sites} made and put on the market today.`}
        />
        <UnitTile
          label="Sold"
          value={fmtUnits(sold)}
          tone="success"
          chip={plants.fillRate != null ? `${fmtPct(plants.fillRate)} sold` : undefined}
          help="Units buyers actually took. The share that sells is set by your price against the market and by how much demand is left here."
        />
        <UnitTile
          label="Unsold"
          value={fmtUnits(unsold)}
          tone={unsold > 0 ? "warning" : "muted"}
          help="Units you made that nobody bought. You paid to make them and earned nothing back."
        />
      </div>
      {unsold > 0 && (
        <p className="mt-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-body-sm text-foreground">
          {fmtUnits(unsold)} units went unsold.{" "}
          {(plants.demandGapUnits ?? 0) >= 1 ? (
            <>
              Buyers here have room for about {fmtUnits(plants.demandGapUnits)} more units a day.
              Lower your price, or hold off building.
            </>
          ) : (
            <>
              The market for what you make is oversupplied right now, so buyers took all they needed
              and no more. Lower your price to win share from rivals, and hold off building until
              more of your output sells.
            </>
          )}
        </p>
      )}
      {/* Glut explainer: below half fill the missing sales are not a pricing
          tweak away, the market simply does not want the output. Say so plainly
          (same tone as the demand-gap copy above, ticket #1027 follow-up). */}
      {truth?.soldFraction != null && truth.soldFraction < 0.5 && (
        <p className="mt-2 text-body-sm text-muted">
          This market is oversupplied. Output beyond what buyers need goes unsold, and extra sales
          have to be won from rivals on price.
        </p>
      )}
      {pnl.avgSalePriceAnchor != null && (
        <p className="mt-2 text-body-sm text-muted">
          Each unit sold for{" "}
          <span className="font-semibold tabular-nums text-foreground">
            {unitMoney(pnl.avgSalePriceAnchor)}
          </span>{" "}
          on average.
        </p>
      )}

      {/* Money chain ────────────────────────────────────────────────────────*/}
      <div className="mt-5 space-y-1.5">
        <Row
          label="Revenue"
          value={money(pnl.revenueAnchor)}
          tone="success"
          bold
          help="What the units you sold earned. Nothing else in this game turns into income."
        />
        {costLines.map((l) => (
          <Row
            key={l.key}
            label={l.label}
            value={`− ${money(l.value)}`}
            tone="error"
            indent
            help={l.help}
          />
        ))}
        <div className="flex items-center justify-between border-t border-card-border pt-2">
          <span className="text-body-sm text-muted">All costs</span>
          <span className="text-body-sm tabular-nums text-muted">− {money(totalCosts)}</span>
        </div>
        <div className="border-t border-card-border pt-2">
          <Row
            label="Profit"
            value={money(pnl.profitAnchor)}
            tone={pnl.profitAnchor >= 0 ? "success" : "error"}
            bold
            help="Revenue minus every cost line above. Corporation-level costs and tax are settled on the corporation page."
          />
        </div>
      </div>

      <DetailsDisclosure className="mt-4">
        <dl className="space-y-1.5 text-body-sm">
          <DetailRow
            label="Revenue per hour"
            value={money(pnl.revenueAnchor * MONEY_PERIOD_FACTOR.hourly)}
          />
          <DetailRow
            label="Revenue per game year"
            value={money(pnl.revenueAnchor * MONEY_PERIOD_FACTOR.annual)}
          />
          <DetailRow
            label="Profit per unit made"
            value={pnl.profitPerUnitAnchor == null ? "—" : unitMoney(pnl.profitPerUnitAnchor)}
          />
          <DetailRow
            label="Of which disasters and one-off events"
            value={money(pnl.financialEventsAnchor)}
          />
          {financials && (
            <>
              <DetailRow
                label="Corporation overhead charged here"
                value={corpMoney(financials.corpOverheadShare)}
              />
              <DetailRow label="Taxable income" value={corpMoney(financials.taxableIncome)} />
              <DetailRow
                label={`Federal tax (${financials.federalTaxRate}%)`}
                value={corpMoney(financials.federalTaxApprox)}
              />
              <DetailRow
                label={`Regional tax (${financials.stateTaxRate}%)`}
                value={corpMoney(financials.stateTaxApprox)}
              />
            </>
          )}
        </dl>
        <p className="mt-2 text-body-xs text-muted">
          &quot;Other running costs&quot; is whatever the named lines do not explain, so the lines
          above always add up to the profit the turn actually booked.
        </p>
      </DetailsDisclosure>
    </div>
  );
}

function UnitTile({
  label,
  value,
  help,
  chip,
  tone = "default",
}: {
  label: string;
  value: string;
  help: string;
  chip?: string;
  tone?: "default" | "success" | "warning" | "muted";
}) {
  const toneClass =
    tone === "success"
      ? "text-success"
      : tone === "warning"
        ? "text-warning"
        : tone === "muted"
          ? "text-muted"
          : "text-foreground";
  return (
    <div className="rounded-lg border border-card-border bg-background/40 p-3">
      <InfoTooltip
        width={260}
        trigger={
          <span className="cursor-help border-b border-dotted border-muted/40 text-body-xs font-semibold uppercase tracking-wider text-muted">
            {label}
          </span>
        }
      >
        <p className="mb-1 font-semibold text-foreground">{label}</p>
        <p className="text-muted">{help}</p>
      </InfoTooltip>
      <p className={`mt-1 text-body-lg font-bold tabular-nums ${toneClass}`}>{value}</p>
      {chip && (
        <span className="mt-1 inline-flex rounded-full border border-success/30 bg-success/10 px-1.5 py-0 text-body-xs font-semibold text-success">
          {chip}
        </span>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  help,
  tone,
  bold = false,
  indent = false,
}: {
  label: string;
  value: string;
  help: string;
  tone: "success" | "error";
  bold?: boolean;
  indent?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <InfoTooltip
        width={280}
        trigger={
          <span
            className={`cursor-help border-b border-dotted border-muted/40 text-body-sm ${
              indent
                ? "pl-4 text-muted"
                : bold
                  ? "font-semibold text-foreground"
                  : "text-foreground"
            }`}
          >
            {label}
          </span>
        }
      >
        <p className="mb-1 font-semibold text-foreground">{label}</p>
        <p className="text-muted">{help}</p>
      </InfoTooltip>
      <span
        className={`shrink-0 tabular-nums ${bold ? "text-body-lg font-bold" : "text-body-sm font-medium"} ${
          tone === "success" ? "text-success" : "text-error"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="tabular-nums text-foreground">{value}</dd>
    </div>
  );
}
