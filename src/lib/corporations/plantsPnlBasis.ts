/**
 * The plants-tier P&L a sector's read surfaces should use, and the money
 * breakdown of the modifier stack that produced it.
 *
 * ─── Why this module exists ─────────────────────────────────────────────────
 *
 * Under plants a sector's profit is real cost arithmetic:
 *
 *     operatingCost = inputs + labour + otherOpex + financialLegs - policyCredit
 *     totalCost     = operatingCost + upkeep + compliance + growth
 *     profit        = revenue - totalCost
 *
 * `effectiveProfitMargin` is that model's OUTPUT, and a capped one:
 * `min(100, 100 x (1 - operatingCost / revenue))`. The cap is correct for a
 * display percentage, because a margin above 100 says nothing a player can
 * read. It is wrong as a source of money, for two independent reasons:
 *
 *  1. When `policyCredit` outruns the operating bill, `operatingCost` is
 *     NEGATIVE and the booked profit legitimately exceeds revenue. A reader
 *     that inverts the capped percentage recovers an operating cost of exactly
 *     zero and reports profit == revenue, understating what the engine paid
 *     out. Nine prod media sectors sat at or on the cap.
 *  2. The margin's scope is `operatingCost` only. Upkeep and compliance are
 *     outside it and inside the profit, so an inverting reader drops them on
 *     EVERY plants sector, capped or not.
 *
 * So the turn persists its assembled lines (`sector.plantsPnl`) and readers use
 * them. `derivedMarginPct` stays exactly what it is documented to be: a capped
 * display and compatibility value, carrying no money.
 *
 * The fallback path (no `plantsPnl` on the row) is the old inversion, unchanged,
 * so a sector that has not run a plants turn since this shipped renders exactly
 * as it did before.
 */
import type { CorporateSector } from "@/lib/db/types";

/** The persisted plants P&L, all lines on the DAILY basis of `sector.revenue`. */
export type PlantsPnl = NonNullable<CorporateSector["plantsPnl"]>;

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * The persisted P&L, or null when it is absent or incomplete.
 *
 * Every money line must be present and finite: a partial row would let a caller
 * build a cost chain that does not reconcile, which is the failure this whole
 * change exists to remove. A partial row falls back to the margin inversion,
 * which at least reconciles against itself.
 */
export function readPlantsPnl(
  sector: Pick<CorporateSector, "plantsPnl">
): (PlantsPnl & { policyPp: number }) | null {
  const p = sector.plantsPnl;
  if (!p || typeof p !== "object") return null;
  const lines: (keyof PlantsPnl)[] = [
    "revenue",
    "inputs",
    "labour",
    "upkeep",
    "compliance",
    "otherOpex",
    "financialLegs",
    "policyCredit",
    "operatingCost",
    "totalCost",
    "profit",
  ];
  for (const k of lines) if (!finite(p[k])) return null;
  return { ...p, policyPp: finite(p.policyPp) ? p.policyPp : 0 };
}

/** One named modifier inside the policy stack, in percentage points AND money. */
export interface PolicyStackRow {
  /** Stable key for React and for tests. */
  key: string;
  label: string;
  /** The modifier's own percentage points, as the margin drilldown shows it. */
  pp: number;
  /**
   * The modifier's share of `policyCredit`, same money units as every other
   * line on the panel. Positive is a credit, negative a charge.
   */
  anchor: number;
}

/**
 * The itemized modifier rows the corporation page's `SectorMarginDrilldown`
 * shows, minus the ones the physical model prices directly.
 *
 * Kept deliberately identical to that component's row set and ordering so the
 * two surfaces cannot disagree about what the stack contains. Commodity
 * pressure is excluded because under plants it IS the inputs bill and the sale
 * price, so counting it here would price the same condition twice, which is the
 * double-count the physical model was built to remove.
 */
export interface PolicyStackInput {
  unemploymentModifier?: number | null;
  gridReliabilityModifier?: number | null;
  corruptionModifier?: number | null;
  workforceSkillModifier?: number | null;
  crimeRateModifier?: number | null;
  broadbandModifier?: number | null;
  roadConditionModifier?: number | null;
  carbonEmissionsModifier?: number | null;
  costOfLivingModifier?: number | null;
  stateSectorSpecializationModifier?: number | null;
  stateMetricsModifier?: number | null;
  regionalConditionsModifier?: number | null;
  homeLocationModifier?: number | null;
  foreignTariffModifier?: number | null;
  domesticTariffMalus?: number | null;
  subsidyModifier?: number | null;
  sectorTypeMatchModifier?: number | null;
  sprawlModifier?: number | null;
  typeSwitchModifier?: number | null;
  strategyTransitionModifier?: number | null;
  sustainedNegativeProductionPenalty?: number | null;
  techMarginBonus?: number | null;
  inflationModifier?: number | null;
  debtToGdpModifier?: number | null;
  deficitToGdpModifier?: number | null;
}

const POLICY_STACK_LABELS: { key: keyof PolicyStackInput; label: string }[] = [
  { key: "subsidyModifier", label: "Subsidies" },
  { key: "foreignTariffModifier", label: "Foreign tariff" },
  { key: "domesticTariffMalus", label: "Tariff friction" },
  { key: "techMarginBonus", label: "Tech tree bonus" },
  { key: "homeLocationModifier", label: "Home location" },
  { key: "sectorTypeMatchModifier", label: "Sector match" },
  { key: "sprawlModifier", label: "Sprawl" },
  { key: "typeSwitchModifier", label: "Type switch penalty" },
  { key: "strategyTransitionModifier", label: "Strategy transition" },
  { key: "sustainedNegativeProductionPenalty", label: "Sustained under-production" },
  { key: "stateSectorSpecializationModifier", label: "State specialization" },
  { key: "stateMetricsModifier", label: "State metric effects" },
  { key: "regionalConditionsModifier", label: "Regional conditions" },
  { key: "unemploymentModifier", label: "Unemployment" },
  { key: "gridReliabilityModifier", label: "Power grid" },
  { key: "corruptionModifier", label: "Corruption" },
  { key: "workforceSkillModifier", label: "Workforce skill" },
  { key: "crimeRateModifier", label: "Crime rate" },
  { key: "broadbandModifier", label: "Broadband access" },
  { key: "roadConditionModifier", label: "Road condition" },
  { key: "carbonEmissionsModifier", label: "Carbon emissions" },
  { key: "costOfLivingModifier", label: "Cost of living" },
  { key: "inflationModifier", label: "Inflation" },
  { key: "debtToGdpModifier", label: "National debt" },
  { key: "deficitToGdpModifier", label: "Deficit spending" },
];

/**
 * Split `policyCredit` across the modifiers that produced it.
 *
 * The engine reaches a plants sector's profit through ONE line, so the only
 * honest split is proportional to each modifier's percentage points. The whole
 * set is then scaled by `policyCredit / (revenue x sum(pp) / 100)` so the rows
 * sum to the line they explain EXACTLY. That factor is not a fudge: it is the
 * soft cap the engine applies to the stacked total (a big pile asymptotes
 * instead of pinning), plus the handful of terms the read path cannot see
 * itemized (the nationalization penalty, SOE efficiency). Folding it in is what
 * lets a player add the rows up and land on the line.
 *
 * A `remainderPp` row carries whatever the itemized set does not name, so the
 * split is complete rather than quietly short.
 *
 * Returns an empty list when there is no stack to explain: a zero credit, a
 * zero pp total (nothing to be proportional to), or a degenerate revenue.
 */
export function buildPolicyStackRows(args: {
  /** `plantsPnl.policyCredit`, the line being explained. */
  policyCreditAnchor: number;
  /** `plantsPnl.revenue`, the basis the credit was computed against. */
  revenueAnchor: number;
  mods: PolicyStackInput;
  /**
   * Percentage points inside the stack that the itemized set does not name
   * (the corporation page's "Other factors" remainder), commodity excluded.
   */
  remainderPp?: number;
}): PolicyStackRow[] {
  const { policyCreditAnchor, revenueAnchor, mods, remainderPp = 0 } = args;
  if (!finite(policyCreditAnchor) || policyCreditAnchor === 0) return [];
  if (!finite(revenueAnchor) || revenueAnchor <= 0) return [];

  const named = POLICY_STACK_LABELS.map(({ key, label }) => {
    const v = mods[key];
    return { key: key as string, label, pp: finite(v) ? v : 0 };
  }).filter((r) => r.pp !== 0);
  const rest = finite(remainderPp) && Math.abs(remainderPp) >= 0.05 ? remainderPp : 0;
  const rows = rest !== 0 ? [...named, { key: "other", label: "Other factors", pp: rest }] : named;

  const sumPp = rows.reduce((s, r) => s + r.pp, 0);
  if (!(Math.abs(sumPp) > 1e-9)) return [];
  // Scale so the parts sum to the whole. See the docblock: the difference is
  // the soft cap plus the unlisted terms, not rounding slack.
  const perPp = policyCreditAnchor / sumPp;
  return rows.map((r) => ({ ...r, anchor: r.pp * perPp }));
}
