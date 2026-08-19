"use client";

import Link from "next/link";
import { Meter } from "@/components/corporation/market/MarketPrimitives";
import type { SectorDetail } from "./CorporationPageTypes";

/**
 * Inline "effective margin build" drill-down for a sector row — the player-corp
 * analogue of the SOE efficiency formula. Shows base margin → the modifier stack
 * → effective margin, plus a production-policy readout. Built entirely from the
 * typed fields the corporation-detail query already returns; the dedicated
 * sector page carries the exhaustive breakdown (raw metric values, sprawl /
 * dominance / subsidy terms) and the editable production-policy control.
 */

interface ModRow {
  label: string;
  value: number | null | undefined;
}

function PolicyMeterTone(level: number): "up" | "down" | "warning" {
  if (level > 0) return "warning"; // over-producing — floods the market
  if (level < 0) return "down"; // under-producing
  return "up";
}

function ModifierLine({ label, value }: { label: string; value: number }) {
  const tone = value > 0 ? "text-success" : value < 0 ? "text-error" : "text-muted";
  return (
    <div className="flex items-center justify-between py-1 text-[12px]">
      <span className="text-muted">{label}</span>
      <span className={`font-semibold tabular-nums ${tone}`}>
        {value > 0 ? "+" : ""}
        {value.toFixed(1)}
      </span>
    </div>
  );
}

function Group({ title, rows }: { title: string; rows: ModRow[] }) {
  const present = rows.filter(
    (r): r is { label: string; value: number } => r.value != null && r.value !== 0
  );
  if (present.length === 0) return null;
  return (
    <div>
      <div className="mb-1 border-b border-card-border pb-1 text-[10px] font-semibold uppercase tracking-widest text-muted">
        {title}
      </div>
      {present.map((r) => (
        <ModifierLine key={r.label} label={r.label} value={r.value} />
      ))}
    </div>
  );
}

export function SectorMarginDrilldown({
  sector,
  isCeo,
  corpId,
}: {
  sector: SectorDetail;
  isCeo: boolean;
  corpId: string;
}) {
  // `profitMargin` (base) and `workers` are stripped for private corps viewed by
  // outsiders (redactPrivateSectorRow); effective margin, market share, and the
  // modifier stack are not. Treat the redacted fields as optional so the
  // drill-down degrades to "—" instead of throwing.
  const base = sector.profitMargin as number | undefined;
  const effective = sector.effectiveProfitMargin;
  const workers = sector.workers as number | undefined;
  const net = base != null ? effective - base : null;

  const stateRows: ModRow[] = [
    { label: "Unemployment", value: sector.unemploymentModifier },
    { label: "Power grid", value: sector.gridReliabilityModifier },
    { label: "Corruption", value: sector.corruptionModifier },
    { label: "Workforce skill", value: sector.workforceSkillModifier },
    { label: "Crime rate", value: sector.crimeRateModifier },
    { label: "Broadband access", value: sector.broadbandModifier },
    { label: "Road condition", value: sector.roadConditionModifier },
    { label: "Carbon emissions", value: sector.carbonEmissionsModifier },
    { label: "Cost of living", value: sector.costOfLivingModifier },
    { label: "State specialization", value: sector.stateSectorSpecializationModifier },
    { label: "Metric effects", value: sector.stateMetricsModifier },
    { label: "Regional conditions", value: sector.regionalConditionsModifier },
  ];
  // Physical basis keeps every modifier visible, but commodity pressure is the
  // one influence the physical model prices DIRECTLY (it is the inputs line and
  // the sale price), so its row is relabeled to say where it went instead of
  // implying it still adds percentage points.
  const physicalBasis = sector.marginBasis === "physical" && sector.physicalCosts != null;
  const corporateRows: ModRow[] = [
    {
      label: physicalBasis ? "Commodity markets (priced into inputs & sales)" : "Commodity markets",
      value: sector.commodityModifier,
    },
    { label: "Home location", value: sector.homeLocationModifier },
    { label: "Foreign tariff", value: sector.foreignTariffModifier },
    { label: "Tariff friction", value: sector.domesticTariffMalus },
    { label: "Tech tree bonus", value: sector.techMarginBonus },
  ];
  const nationalRows: ModRow[] = [
    { label: "Inflation", value: sector.inflationModifier },
    { label: "National debt", value: sector.debtToGdpModifier },
    { label: "Deficit spending", value: sector.deficitToGdpModifier },
  ];

  // The itemized rows are a subset of everything folded into the effective
  // margin (sprawl, market dominance, type-switch, strategy transition, sector
  // match, subsidies, nationalization penalty, etc. live on the full sector
  // breakdown). Reconcile the remainder so base + shown + other = effective.
  const sumShown = [...stateRows, ...corporateRows, ...nationalRows].reduce(
    (acc, r) => acc + (r.value ?? 0),
    0
  );
  const otherFactors = net != null ? net - sumShown : null;

  // Physical basis (plants): the effective margin is DERIVED from what the
  // sector actually pays (inputs, wages, upkeep), not from the additive
  // modifier stack (ticket 1072: a 40pt unexplained gap). The cost build is the
  // headline and reconciles exactly; every modifier stays visible below it,
  // reframed as the influences that steer those costs rather than percentage
  // points that sum to the margin.
  const physical = physicalBasis ? sector.physicalCosts! : null;

  const policyLevel = sector.productionPolicyLevel ?? 0;
  const policyTarget = sector.productionPolicy ?? 0;
  const policyPct = ((policyLevel + 25) / 50) * 100;
  const policyDesc =
    policyLevel > 0
      ? "Over-producing: volume up, prices soften"
      : policyLevel < 0
        ? "Under-producing: prices firm, volume down"
        : "Market-neutral output";
  const isDominant = sector.marketSharePercent >= 50;

  return (
    <div className="grid gap-4 border-t border-card-border bg-card-muted/30 p-4 lg:grid-cols-2">
      {/* Effective margin build */}
      <div className="rounded-lg border border-card-border bg-card p-3.5">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-widest text-primary">
            Effective margin build
          </span>
          <span className="text-[11px] text-muted">
            {base != null ? `base ${base.toFixed(1)}% → ` : ""}
            <span
              className={`font-semibold ${net == null || net >= 0 ? "text-success" : "text-error"}`}
            >
              {effective.toFixed(1)}%
            </span>
          </span>
        </div>

        {physical ? (
          <>
            <div className="flex items-center justify-between border-b border-card-border py-1 text-[12px]">
              <span className="text-foreground">Realized revenue</span>
              <span className="font-semibold tabular-nums text-foreground">100.0%</span>
            </div>
            <div className="pt-2">
              <div className="mb-1 border-b border-card-border pb-1 text-[10px] font-semibold uppercase tracking-widest text-muted">
                What this sector pays
              </div>
              <ModifierLine label="Inputs (at market prices)" value={-physical.inputsPp} />
              {physical.laborPp != null && <ModifierLine label="Wages" value={-physical.laborPp} />}
              <ModifierLine label="Upkeep, taxes & other operating" value={-physical.otherPp} />
              {physical.policyPp != null && physical.policyPp !== 0 && (
                <ModifierLine label="Policy, tax and support" value={physical.policyPp} />
              )}
            </div>
            <div className="mt-2 flex items-center justify-between border-t border-card-border pt-2 text-[12px]">
              <span className="font-semibold text-foreground">Effective margin</span>
              <span
                className={`font-bold tabular-nums ${effective >= 0 ? "text-success" : "text-error"}`}
              >
                {effective.toFixed(1)}%
              </span>
            </div>
            <p className="mt-2 text-[11px] leading-snug text-muted">
              This margin comes from real costs, so the cost lines above always add up to it. Every
              modifier listed below reaches your profit through the single &ldquo;policy, tax and
              support&rdquo; line, which the sector page shows in money with each modifier&rsquo;s
              own share.
            </p>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between border-b border-card-border py-1 text-[12px]">
              <span className="text-foreground">Base sector margin</span>
              <span className="font-semibold tabular-nums text-foreground">
                {base != null ? `${base.toFixed(1)}%` : "—"}
              </span>
            </div>
          </>
        )}

        {physical && (
          <div className="mt-3 mb-1 border-b border-card-border pb-1 text-[10px] font-semibold uppercase tracking-widest text-muted">
            What shapes those costs
          </div>
        )}
        <div className="space-y-2 pt-2">
          <Group title="State conditions" rows={stateRows} />
          {sector.regionalConditionModifiers && sector.regionalConditionModifiers.length > 0 && (
            <div>
              <div className="mb-1 border-b border-card-border pb-1 text-[10px] font-semibold uppercase tracking-widest text-muted">
                Regional conditions
              </div>
              {sector.regionalConditionModifiers.map((rc) => (
                <div key={rc.label} className="flex items-center justify-between py-1 text-[12px]">
                  <span className="text-muted">{rc.label}</span>
                  <span
                    className={`font-semibold tabular-nums ${rc.marginEffect > 0 ? "text-success" : rc.marginEffect < 0 ? "text-error" : "text-muted"}`}
                  >
                    {rc.marginEffect > 0 ? "+" : ""}
                    {rc.marginEffect.toFixed(1)}pp
                  </span>
                </div>
              ))}
            </div>
          )}
          <Group title="Corporate factors" rows={corporateRows} />
          <Group title="National economy" rows={nationalRows} />
          {!physical && otherFactors != null && Math.abs(otherFactors) >= 0.05 && (
            <div>
              <div className="mb-1 border-b border-card-border pb-1 text-[10px] font-semibold uppercase tracking-widest text-muted">
                Other factors
              </div>
              <div className="flex items-center justify-between py-1 text-[12px]">
                <span className="text-muted">
                  Sprawl, dominance, subsidies &amp; more — see full breakdown
                </span>
                <span
                  className={`font-semibold tabular-nums ${otherFactors > 0 ? "text-success" : otherFactors < 0 ? "text-error" : "text-muted"}`}
                >
                  {otherFactors > 0 ? "+" : ""}
                  {otherFactors.toFixed(1)}
                </span>
              </div>
            </div>
          )}
        </div>

        {!physical && net != null && (
          <div className="mt-2 flex items-center justify-between border-t border-card-border pt-2 text-[12px]">
            <span className="font-semibold text-foreground">Net modifiers</span>
            <span className={`font-bold tabular-nums ${net >= 0 ? "text-success" : "text-error"}`}>
              {net >= 0 ? "+" : ""}
              {net.toFixed(1)}
            </span>
          </div>
        )}

        {isDominant && (
          <div className="mt-2.5 rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-[11px] text-warning">
            Dominance: holding {sector.marketSharePercent.toFixed(0)}% of this market draws a
            regulatory burden that drags the margin and attracts antitrust scrutiny.
          </div>
        )}

        <div className="mt-2 text-right">
          <Link
            href={`/corporation/${corpId}/sector/${sector._id}`}
            className="text-[11px] font-medium text-secondary hover:underline"
          >
            Full breakdown →
          </Link>
        </div>
      </div>

      {/* Production policy */}
      <div className="rounded-lg border border-card-border bg-card p-3.5">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-widest text-primary">
            Production policy
          </span>
          <span className="text-[11px] text-muted">read-only</span>
        </div>

        <div className="flex items-end justify-between">
          <div className="text-3xl font-bold tabular-nums text-foreground">
            {policyLevel > 0 ? "+" : ""}
            {policyLevel}
            <span className="text-base text-muted">/25</span>
          </div>
          <div className="max-w-[55%] text-right text-[11px] text-muted">{policyDesc}</div>
        </div>

        <div className="mt-3">
          <Meter value={policyPct} tone={PolicyMeterTone(policyLevel)} height={6} />
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-muted">
          <span>−25 restrict</span>
          <span>0</span>
          <span>+25 flood</span>
        </div>

        {policyTarget !== policyLevel && (
          <div className="mt-2 text-[11px] text-muted">
            Target{" "}
            <span className="font-semibold text-foreground">
              {policyTarget > 0 ? "+" : ""}
              {policyTarget}
            </span>{" "}
            — trending from {policyLevel > 0 ? "+" : ""}
            {policyLevel}.
          </div>
        )}

        <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
          <div>
            <div className="text-[9px] uppercase tracking-wide text-muted">Workers</div>
            <div className="font-bold tabular-nums text-foreground">
              {workers != null ? workers.toLocaleString("en-US") : "—"}
            </div>
          </div>
          <div>
            <div className="text-[9px] uppercase tracking-wide text-muted">Mkt share</div>
            <div className="font-bold tabular-nums text-foreground">
              {sector.marketSharePercent.toFixed(0)}%
            </div>
          </div>
          <div>
            <div className="text-[9px] uppercase tracking-wide text-muted">Eff. margin</div>
            <div className="font-bold tabular-nums text-primary">{effective.toFixed(1)}%</div>
          </div>
        </div>

        {isCeo && (
          <div className="mt-3 text-right">
            <Link
              href={`/corporation/${corpId}/sector/${sector._id}`}
              className="text-[11px] font-medium text-secondary hover:underline"
            >
              Set production policy →
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
