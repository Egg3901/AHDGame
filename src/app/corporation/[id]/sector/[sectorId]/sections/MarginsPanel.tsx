"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import {
  Activity,
  AlertTriangle,
  Crown,
  Gavel,
  GraduationCap,
  Home,
  Landmark,
  Layers,
  MapPin,
  Package,
  Percent,
  Power,
  Receipt,
  RefreshCw,
  Route,
  Scale,
  ShieldAlert,
  Star,
  Truck,
  Users,
  Wind,
  Wifi,
  Zap,
  PackageX,
} from "lucide-react";
import ModifierRow from "../components/ModifierRow";
import type { Margins } from "../types";

interface MarginsPanelProps {
  margins: Margins;
  defaultExpanded?: boolean;
  /** Labels of this sector's input commodities (from the commodities panel),
   *  used to attribute tariff friction to the imported inputs causing it. */
  inputLabels?: string[];
  /**
   * Plants tier: realized profit over the cost of everything PRODUCED
   * (plants.truth.fillAdjustedMarginPct). When present it leads and the
   * effective margin is demoted to a secondary row, because the effective
   * figure divides by sold revenue only and misleads badly at low fills.
   */
  fillAdjustedMarginPct?: number | null;
}

/**
 * Every margin modifier the payload carries, flattened to (label, pp) so they
 * can be ranked against each other. Kept in one list rather than reusing the
 * grouped JSX below because the ranking is deliberately group-blind: what the
 * player wants is "what is hitting me hardest", not "what is hitting me hardest
 * within State Conditions".
 */
export function topMarginDrivers(margins: Margins): { label: string; value: number }[] {
  // `stateMetricsModifier` is the TOTAL of the individual state-metric rows
  // below it, and only that total enters the effective margin
  // (`computeAllMarginModifiers` folds `stateMetricTotal`, never the components
  // separately). Ranking both would double-count: the player would see "State
  // metrics −8pp" sitting above "Unemployment −3pp" which is part of that −8.
  // Use whichever level the engine actually applied.
  const useStateMetricTotal = typeof margins.stateMetricsModifier === "number";
  const stateMetricRows: [string, number | null | undefined][] = useStateMetricTotal
    ? [["State conditions", margins.stateMetricsModifier]]
    : [
        ["Unemployment", margins.unemploymentModifier],
        ["Power grid", margins.gridReliabilityModifier],
        ["Corruption", margins.corruptionModifier],
        ["Workforce skill", margins.workforceSkillModifier],
        ["Crime rate", margins.crimeRateModifier],
        ["Broadband access", margins.broadbandModifier],
        ["Road condition", margins.roadConditionModifier],
        ["Carbon emissions", margins.carbonEmissionsModifier],
        ["Cost of living", margins.costOfLivingModifier],
      ];
  const candidates: [string, number | null | undefined][] = [
    ["Commodity markets", margins.commodityModifier],
    ...stateMetricRows,
    ["Home location", margins.homeLocationModifier],
    ["State specialization", margins.stateSectorSpecializationModifier],
    ["Sector type match", margins.sectorTypeMatchModifier],
    ["Logistics sprawl", margins.sprawlModifier],
    ["Inflation", margins.inflationModifier],
    ["National debt", margins.debtToGdpModifier],
    ["Deficit spending", margins.deficitToGdpModifier],
    ["Type switch penalty", margins.typeSwitchModifier],
    ["Strategy transition", margins.strategyTransitionModifier],
    ["Foreign tariff", margins.foreignTariffModifier],
    ["Tariff friction", margins.domesticTariffMalus],
    ["Government subsidy", margins.subsidyModifier],
    ["Market dominance", margins.dominanceMarginPenalty],
    ["Regulatory burden", margins.dominanceRegulatoryBurdenPp],
    ["Sustained under-production", margins.sustainedNegativeProductionPenalty],
    ["Active crises", margins.crisisMarginPenalty],
  ];
  return candidates
    .filter((c): c is [string, number] => typeof c[1] === "number" && Math.abs(c[1]) >= 0.05)
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    .slice(0, 5);
}

function GroupHeader({ label }: { label: string }) {
  return (
    <div className="mb-2 border-b border-card-border pb-1 text-[10px] font-semibold uppercase tracking-widest text-muted">
      {label}
    </div>
  );
}

export default function MarginsPanel({
  margins,
  defaultExpanded = false,
  inputLabels = [],
  fillAdjustedMarginPct = null,
}: MarginsPanelProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [metricEffectsExpanded, setMetricEffectsExpanded] = useState(false);
  const blendStr = margins.commoditySupplyDemandBlendPct
    ? `${margins.commoditySupplyDemandBlendPct.global}/${margins.commoditySupplyDemandBlendPct.national}/${margins.commoditySupplyDemandBlendPct.local}`
    : null;
  const metricContributions = margins.stateMetricContributions ?? [];
  const topPositiveMetricEffects = metricContributions
    .filter((effect) => effect.modifier > 0)
    .slice(0, 3);
  const topNegativeMetricEffects = metricContributions
    .filter((effect) => effect.modifier < 0)
    .slice(0, 3);
  const visibleMetricEffects = [...topPositiveMetricEffects, ...topNegativeMetricEffects];

  // Ranked drivers. The grouped list below shows every modifier at equal visual
  // weight, so a −0.2pp broadband row looks as important as a −14pp commodity
  // squeeze and the player cannot tell what is actually hurting them — "there's
  // a lot of big warnings and it's hard to see which ones are actually affecting
  // me" (#gameplay-advisors, 2026-07-29). Rank by absolute impact and lead with
  // it; the full breakdown stays underneath for anyone who wants it.
  const drivers = topMarginDrivers(margins);

  return (
    <div className="rounded-xl border border-card-border bg-card">
      {/* Collapsed header — always visible */}
      <button
        type="button"
        onClick={() => setIsExpanded((v) => !v)}
        className="flex w-full items-center justify-between px-6 py-4 text-left"
      >
        <div>
          <h2 className="text-lg font-bold text-foreground">Profit Margin Breakdown</h2>
          <p className="text-xs text-muted">
            Base {margins.base}% · state, corporate & national modifiers
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={`text-lg font-bold tabular-nums ${
              margins.effective >= margins.base ? "text-success" : "text-error"
            }`}
          >
            {margins.effective}%
          </span>
          <ChevronRight
            className={`h-4 w-4 shrink-0 text-muted transition-transform duration-150 ${
              isExpanded ? "rotate-90" : ""
            }`}
          />
        </div>
      </button>

      {/* Expanded body */}
      {isExpanded && (
        <div className="border-t border-card-border px-6 pb-6 pt-4">
          <p className="mb-4 text-xs text-muted">
            State conditions affect operating costs. Margin determines what share of revenue becomes
            profit.
          </p>

          {/* Base margin */}
          <div className="mb-4 flex items-center justify-between border-b border-card-border pb-3 text-sm">
            <span className="text-[11px] font-medium uppercase tracking-wider text-muted">
              Base margin
            </span>
            <span className="text-base font-bold tabular-nums text-foreground">
              {margins.base}%
            </span>
          </div>

          {/* Ranked drivers — what is actually moving this margin, biggest first */}
          {drivers.length > 0 && (
            <div className="mb-4 rounded-lg border border-card-border bg-card-elevated/40 p-3">
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-primary">
                Biggest effects right now
              </div>
              <div className="space-y-1.5">
                {drivers.map((d) => {
                  const share = Math.min(
                    100,
                    (Math.abs(d.value) / Math.abs(drivers[0].value)) * 100
                  );
                  return (
                    <div key={d.label} className="flex items-center gap-2">
                      <span className="w-40 shrink-0 truncate text-[11px] text-muted">
                        {d.label}
                      </span>
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-card-border">
                        <div
                          className={`h-full rounded-full ${d.value > 0 ? "bg-success" : "bg-error"}`}
                          style={{ width: `${share}%` }}
                        />
                      </div>
                      <span
                        className={`w-14 shrink-0 text-right text-[11px] font-semibold tabular-nums ${
                          d.value > 0 ? "text-success" : "text-error"
                        }`}
                      >
                        {d.value > 0 ? "+" : ""}
                        {d.value.toFixed(1)}pp
                      </span>
                    </div>
                  );
                })}
              </div>
              <p className="mt-2 text-[10px] leading-snug text-muted">
                Ranked by size, largest first. Everything else is below and is moving your margin by
                less than these.
              </p>
            </div>
          )}

          {/* Group 1: State Conditions */}
          <div className="mb-4 space-y-2">
            <GroupHeader label="State Conditions" />
            <ModifierRow
              label="Unemployment"
              modifier={margins.unemploymentModifier}
              rawValue={margins.unemploymentRate}
              rawUnit="%"
              tooltip="Below 3%: tight labor squeezes margins (up to -5%). Above 3%: cheap labor boosts margins (up to +5% at 10%+)."
              icon={Users}
            />
            <ModifierRow
              label="Power grid"
              modifier={margins.gridReliabilityModifier}
              rawValue={margins.gridReliability}
              rawUnit="% uptime"
              tooltip="Above 95% uptime: no effect. Below 95%: linear penalty up to -4% at 85% or lower."
              icon={Zap}
            />
            <ModifierRow
              label="Corruption"
              modifier={margins.corruptionModifier}
              rawValue={margins.corruptionIndex}
              rawUnit=" index"
              tooltip="Higher corruption means bribes, regulatory shakedowns, and contract uncertainty. Linear penalty up to -3% at corruption index 100."
              icon={Scale}
            />
            {margins.workforceSkillModifier != null && (
              <ModifierRow
                label="Workforce skill"
                modifier={margins.workforceSkillModifier}
                rawValue={margins.workforceSkill}
                rawUnit=" / 100"
                tooltip="Skilled workforce (above 50) boosts productivity and reduces errors (+4% max). Low skill (below 50) raises training costs (-4% max)."
                icon={GraduationCap}
              />
            )}
            {margins.crimeRateModifier != null && (
              <ModifierRow
                label="Crime rate"
                modifier={margins.crimeRateModifier}
                rawValue={margins.crimeRate}
                rawUnit=" / 100k"
                tooltip="Higher crime increases theft, vandalism, and reduces customer foot traffic. Linear penalty up to -5% at high crime levels."
                icon={ShieldAlert}
              />
            )}
            {margins.broadbandModifier != null && (
              <ModifierRow
                label="Broadband access"
                modifier={margins.broadbandModifier}
                rawValue={margins.broadbandAccess}
                rawUnit="%"
                tooltip="Above 70% coverage: no effect. Below 70%: connectivity gaps slow operations. Up to -4% at 40% or lower."
                icon={Wifi}
              />
            )}
            {margins.roadConditionModifier != null && (
              <ModifierRow
                label="Road condition"
                modifier={margins.roadConditionModifier}
                rawValue={margins.roadCondition}
                rawUnit=" / 100"
                tooltip="Good roads (above 60) lower logistics costs (+3% max). Poor roads (below 60) raise them (-3% max). Driven by state infrastructure spending AND the region's own freight capacity — a strong local logistics sector lifts this, a thin one drags it."
                icon={Route}
              />
            )}
            {margins.carbonEmissionsModifier != null && (
              <ModifierRow
                label="Carbon emissions"
                modifier={margins.carbonEmissionsModifier}
                rawValue={margins.carbonEmissions}
                rawUnit=" MT/capita"
                tooltip="Higher state emissions signal tighter regulatory environments and compliance costs. Linear penalty up to -3% at 25+ MT per capita."
                icon={Wind}
              />
            )}
            {margins.costOfLivingModifier != null && (
              <ModifierRow
                label="Cost of living"
                modifier={margins.costOfLivingModifier}
                rawValue={margins.costOfLiving}
                rawUnit=" index"
                tooltip="Below national average (100): lower labor costs boost margins (+3% max at 70). Above 100: higher wages compress margins (-3% max at 130+)."
                icon={Home}
              />
            )}
            {margins.stateSectorSpecializationModifier !== 0 && (
              <ModifierRow
                label="State specialization"
                modifier={margins.stateSectorSpecializationModifier}
                rawValue={null}
                rawUnit=""
                tooltip="This state favors certain sectors. Primary specialization: +10%. Secondary: +5%."
                icon={Star}
              />
            )}
            {metricContributions.length > 0 && (
              <div className="border-t border-card-border pt-2">
                <button
                  type="button"
                  onClick={() => setMetricEffectsExpanded((v) => !v)}
                  className="flex w-full items-center justify-between py-2 text-left text-xs font-semibold text-foreground"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <Activity className="h-3.5 w-3.5 shrink-0 text-muted" />
                    <span>Metric effects</span>
                    {margins.stateMetricsModifier != null && (
                      <span
                        className={`tabular-nums ${
                          margins.stateMetricsModifier >= 0 ? "text-success" : "text-error"
                        }`}
                      >
                        {margins.stateMetricsModifier >= 0 ? "+" : ""}
                        {margins.stateMetricsModifier.toFixed(1)}pp
                      </span>
                    )}
                  </span>
                  <ChevronRight
                    className={`h-3.5 w-3.5 shrink-0 text-muted transition-transform duration-150 ${
                      metricEffectsExpanded ? "rotate-90" : ""
                    }`}
                  />
                </button>
                {metricEffectsExpanded && (
                  <div className="space-y-2 pb-1 pt-2">
                    {visibleMetricEffects.map((effect) => (
                      <div
                        key={`${effect.category}.${effect.metricId}.${effect.channel}`}
                        className="grid gap-1 text-xs"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="min-w-0 truncate font-medium text-foreground">
                            {effect.label}
                          </span>
                          <span
                            className={`shrink-0 tabular-nums ${
                              effect.modifier >= 0 ? "text-success" : "text-error"
                            }`}
                          >
                            {effect.modifier >= 0 ? "+" : ""}
                            {effect.modifier.toFixed(2)}pp
                          </span>
                        </div>
                        <div className="text-[11px] leading-snug text-muted">
                          {effect.rationale}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Group 2: Corporate Factors */}
          <div className="mb-4 space-y-2">
            <GroupHeader label="Corporate Factors" />
            <ModifierRow
              label="Commodity markets"
              modifier={margins.commodityModifier}
              rawValue={null}
              rawUnit=""
              tooltip={`How commodity supply and demand hit your margin. Shortages of the things you buy push your costs up. Selling into a market that is short of your goods pushes your margin up. Big swings matter less and less the further they go.${blendStr ? ` Global, national and regional prices count for ${blendStr}%.` : ""}`}
              icon={Package}
            />
            <ModifierRow
              label="Home location"
              modifier={margins.homeLocationModifier}
              rawValue={null}
              rawUnit=""
              tooltip="Sectors in your HQ state get +10% margin. Sectors in the same nation (different state) get +5%. International sectors get no bonus."
              icon={MapPin}
            />
            {margins.sectorTypeMatchModifier !== 0 && (
              <ModifierRow
                label="Sector type match"
                modifier={margins.sectorTypeMatchModifier}
                rawValue={null}
                rawUnit=""
                tooltip="Sectors matching your primary type get +5%. Secondary type match: +2.5%. Mismatched: -15% penalty."
                icon={Layers}
              />
            )}
            {margins.sprawlModifier !== 0 && (
              <ModifierRow
                label="Logistical sprawl"
                modifier={margins.sprawlModifier}
                rawValue={null}
                rawUnit=""
                tooltip="Penalty for operating too many sectors. -0.5% per 2 sectors over 15. Reducible via logistics spending."
                icon={Truck}
              />
            )}
            {margins.typeSwitchModifier !== 0 && (
              <ModifierRow
                label="Type switch penalty"
                modifier={margins.typeSwitchModifier}
                rawValue={null}
                rawUnit=""
                tooltip="Temporary -10% penalty for 24 hours after switching primary or secondary corporation type."
                icon={RefreshCw}
              />
            )}
            {margins.strategyTransitionModifier !== 0 && (
              <ModifierRow
                label="Strategy transition"
                modifier={margins.strategyTransitionModifier}
                rawValue={null}
                rawUnit=""
                tooltip="Temporary -5% penalty while the sector retools to a new operating strategy. Fades over 12 turns."
                icon={RefreshCw}
              />
            )}
            {margins.foreignTariffModifier !== 0 && (
              <ModifierRow
                label="Foreign tariff"
                modifier={margins.foreignTariffModifier}
                rawValue={null}
                rawUnit=""
                tooltip="Tariff penalty applied to foreign corporations operating in this country. Proportional to the effective tariff rate."
                icon={PackageX}
              />
            )}
            {margins.domesticTariffMalus !== 0 && (
              <>
                <ModifierRow
                  label="Tariff friction"
                  modifier={margins.domesticTariffMalus}
                  rawValue={null}
                  rawUnit=""
                  tooltip={`Supply-chain friction cost for domestic corporations when tariffs are active in this country. Reflects higher input costs from trade barriers${inputLabels.length > 0 ? ` on imported inputs: ${inputLabels.join(", ")}` : ""}.`}
                  icon={PackageX}
                />
                <p className="-mt-1 pl-8 text-[11px] leading-snug text-muted">
                  via imported inputs{inputLabels.length > 0 ? `: ${inputLabels.join(", ")}` : ""}.
                  A domestic-only seller still pays tariffs through its imported inputs.
                </p>
              </>
            )}
            {margins.dominanceMarginPenalty !== 0 && (
              <ModifierRow
                label="Market dominance"
                modifier={margins.dominanceMarginPenalty}
                rawValue={null}
                rawUnit=""
                tooltip="Margin pressure on dominant sectors (>50% of state market). Models regulatory scrutiny, customer backlash, and political risk. Scales linearly to -15pp at 100% market share."
                icon={Crown}
              />
            )}
            {margins.dominanceRegulatoryBurdenPp !== 0 && (
              <ModifierRow
                label="Regulatory burden"
                modifier={margins.dominanceRegulatoryBurdenPp}
                rawValue={null}
                rawUnit=""
                tooltip="Compliance, antitrust legal, and lobbying costs for dominant sectors. Deducted from revenue (shown as a margin-equivalent here). Up to 5% of revenue at 100% share."
                icon={Gavel}
              />
            )}
            {margins.sustainedNegativeProductionPenalty !== 0 && (
              <ModifierRow
                label="Sustained low production"
                modifier={margins.sustainedNegativeProductionPenalty}
                rawValue={null}
                rawUnit=""
                tooltip="A margin penalty for running below normal production for a long time. You get 48 turns free, then it grows to -15 points after about 22 game days. Going back to normal production winds the penalty back down instead of clearing it at once."
                icon={Power}
              />
            )}
          </div>

          {/* Group 3: National Economy */}
          <div className="mb-4 space-y-2">
            <GroupHeader label="National Economy" />
            {margins.subsidyModifier !== 0 && (
              <ModifierRow
                label="Active subsidies"
                modifier={margins.subsidyModifier}
                rawValue={null}
                rawUnit=""
                tooltip="Industry subsidies enacted by the legislature. Each qualifying active program adds +15 percentage points to margin for eligible sectors."
                icon={Receipt}
              />
            )}
            {margins.inflationModifier !== 0 && (
              <ModifierRow
                label="Inflation"
                modifier={margins.inflationModifier}
                rawValue={margins.inflationRate}
                rawUnit="%"
                tooltip="Below 2% inflation: mild bonus (up to +2%). Above 2%: rising costs compress margins (up to -8% at 10%+)."
                icon={Percent}
              />
            )}
            {margins.debtToGdpModifier !== 0 && (
              <ModifierRow
                label="National debt"
                modifier={margins.debtToGdpModifier}
                rawValue={margins.debtToGdpRatio}
                rawUnit="% of GDP"
                tooltip="Heavy government debt makes investors nervous about the whole economy. The penalty starts once national debt passes half the size of the economy, and stops at -15%."
                icon={Landmark}
              />
            )}
            {margins.deficitToGdpModifier !== 0 && (
              <ModifierRow
                label="Deficit spending"
                modifier={margins.deficitToGdpModifier}
                rawValue={margins.deficitToGdpPct}
                rawUnit="% of GDP"
                tooltip="Government deficit spending stimulates the economy, boosting corporate margins. Up to +5% bonus at 10% deficit-to-GDP."
                icon={Receipt}
              />
            )}
          </div>

          {/* Group 4: Active Crises */}
          {margins.crisisMarginPenalty != null && margins.crisisMarginPenalty !== 0 && (
            <div className="mb-4 space-y-2">
              <GroupHeader label="Active Crises" />
              <ModifierRow
                label="Crisis margin shock"
                modifier={margins.crisisMarginPenalty}
                rawValue={null}
                rawUnit=""
                tooltip="Decaying margin penalty from active disasters or infrastructure crises affecting this state. Ramps down to zero as each crisis expires."
                icon={AlertTriangle}
              />
              {margins.activeCrises && margins.activeCrises.length > 0 && (
                <div className="flex flex-wrap gap-x-3 gap-y-1 pl-1 text-xs">
                  {margins.activeCrises.map((c) => (
                    <Link
                      key={c.id}
                      href={`/world/crises/${c.id}`}
                      className="text-primary hover:underline"
                    >
                      {c.name} →
                    </Link>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Margin totals. When the plants tier supplies a fill-adjusted
              figure (profit over the cost of everything PRODUCED), that number
              leads and the effective margin is demoted to a secondary row: the
              effective figure divides by SOLD revenue only, so at a low fill it
              reads healthy while the sector loses money (ticket #1027 family). */}
          {fillAdjustedMarginPct != null ? (
            <>
              <div className="mt-2 flex items-center justify-between rounded-lg border border-card-border bg-card-elevated px-3 py-2.5">
                <span className="text-sm font-semibold text-foreground">After unsold output</span>
                <span
                  className={`text-base font-bold tabular-nums ${
                    fillAdjustedMarginPct >= 0 ? "text-success" : "text-error"
                  }`}
                >
                  {fillAdjustedMarginPct.toFixed(1)}%
                </span>
              </div>
              <div
                className="mt-1.5 flex items-center justify-between px-3"
                title="Counts only the units that sold. When part of your output goes unsold this number overstates how the sector is really doing. The number above counts everything you made."
              >
                <span className="text-xs text-muted">Effective margin (sold units only)</span>
                <span className="text-xs tabular-nums text-muted">{margins.effective}%</span>
              </div>
            </>
          ) : (
            <div className="mt-2 flex items-center justify-between rounded-lg border border-card-border bg-card-elevated px-3 py-2.5">
              <span className="text-sm font-semibold text-foreground">Effective margin</span>
              <span
                className={`text-base font-bold tabular-nums ${
                  margins.effective >= margins.base ? "text-success" : "text-error"
                }`}
              >
                {margins.effective}%
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
