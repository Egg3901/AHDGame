import {
  computeConsumptionTaxAdjustedGrowthRate,
  computeRealizedRevenueGrowthRate,
  computeTrailingRevenueGrowthRate,
  computeWeightedGrowthRate,
  sumRealizedRevenue,
  SECTOR_SIGNAL_MIN,
  SECTOR_SIGNAL_MAX,
  DEFAULT_UNOWNED_GROWTH_RATE,
  INERTIA,
  MAX_POLICY_DELTA,
  NEUTRAL_GDP_GROWTH,
  OKUN_COEFFICIENT_DOWN,
  OKUN_COEFFICIENT_UP,
  UNEMPLOYMENT_INERTIA,
  UNEMPLOYMENT_MAX,
  UNEMPLOYMENT_MIN,
  type RevenueTrendBaseline,
} from "@/lib/turn/gdpGrowth";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import type { CorporationType } from "@/lib/constants/corporations";
import { fundingResponse } from "../spendingChannel";
import { SOCIAL_SPEND_HALF_SAT } from "./social";
import { advanceOutputGap, GDP_GROWTH_BOUND } from "../outputGap";
import { tfpBasket } from "../potentialGrowth";
import type { FiscalTradeInputs } from "../providers";
import type { RegistryNode } from "../types";
import type { EconomicModelState } from "@/lib/constants/economicModels";
import { concentrationMultiplier } from "@/lib/economicModels/effects";
import {
  labourWageIncomePassthrough,
  labourUnemploymentWagePressure,
  labourUnemploymentAutomationPressure,
} from "@/lib/labour/laborCost";

/** Per-state payload the phase extracts from `sectorRevenueTaxProvider` for one state. */
export interface SectorRevenueTaxPayload {
  owned: Array<{
    revenue: number;
    currentGrowthRate: number;
    sectorType?: CorporationType;
    realizedRevenue?: number;
    hostRevenue?: number;
    hostRealizedRevenue?: number;
  }>;
  unowned: Array<{ revenue: number; sectorType?: CorporationType }>;
  federalSalesTax: number;
  stateSalesTax: number;
  countryId: string;
  /** §6.1 (P7b): the region's LAGGED economic model, for sector GDP concentration. */
  model?: EconomicModelState;
  /**
   * P2/D7: `marketSystemMode >= "plants"`. When true the owned-sector
   * contribution to the cyclical signal switches from `currentGrowthRate` (now
   * vestigial — capacity, not the growth field, drives revenue) to the region's
   * annualized realized-revenue delta, and the unowned 0.5 pin drops out.
   */
  plantsEnabled?: boolean;
  /**
   * P2/D7: Σ owned-sector realized revenue persisted for this region on a PRIOR
   * turn, plus the turn gap since. Same unit as `realizedRevenueNow` (host
   * currency once `sectorRealizedRevenueUnit === "host"`, else the legacy ₳
   * snapshot). Absent on the flip turn / unseeded regions → legacy signal.
   */
  realizedRevenuePrev?: number;
  turnsSincePrev?: number;
  /**
   * This turn's Σ owned realized revenue in the same unit as `realizedRevenuePrev`.
   * The phase computes it so the node does not have to know host vs ₳. When
   * omitted the node falls back to summing `owned` (legacy ₳ path).
   */
  realizedRevenueNow?: number;
  /**
   * Trailing revenue trend (plants + host only): this turn's revenue-level EMA
   * and the matured snapshot baseline the phase selected. When both are present
   * the node measures growth over the baseline span instead of annualizing one
   * turn's delta by 48 — the one-turn path stays as the cold-start fallback.
   */
  revenueEmaNow?: number;
  revenueTrendBaseline?: RevenueTrendBaseline | null;
}

/**
 * sectorGrowth node — the revenue-weighted, consumption-tax-adjusted sector
 * growth: the CYCLICAL SIGNAL (the supply/production path, §5.2). This is the old
 * `gdpGrowth` node's exact logic (helpers + constants + INERTIA EMA + policy/tax
 * coexistence) — only renamed. Under P1c-2 it no longer IS gdpGrowth; it feeds the
 * gdpGrowth node below, which reverts it toward potential via the output gap. N5:
 * the INERTIA EMA smooths THIS series; the gap-closure is a separate series.
 */
/**
 * Net-exports coupling weight (T5): how strongly LAGGED `tradeGrowth`'s deviation
 * from the world baseline tilts the cyclical sector signal. Lagged + baseline-
 * centered so it is parity-neutral at the steady state (no same-turn oscillation,
 * cold-start safe). First-pass; pinned by the Laffer/sim calibration tests.
 */
export const TRADE_NX_WEIGHT = 0.15;

export const sectorGrowthNode: RegistryNode = {
  id: "economic.sectorGrowth",
  categoryId: "economic",
  metricId: "sectorGrowth",
  kind: "derived",
  // The lagged tradeGrowth edge feeds the net-exports impulse (T5); lagged so the
  // trade↔output loop is cross-turn-damped (and registry-node prev is populated
  // by the phase, so no extra projection is needed).
  inputs: [{ provider: "sectorRevenueTax" }, { lagged: "economic.tradeGrowth" }],
  bounds: [SECTOR_SIGNAL_MIN, SECTOR_SIGNAL_MAX],
  inertia: INERTIA,
  maxPolicyDelta: MAX_POLICY_DELTA,
  decimals: 3,
  compute: (ctx) => {
    const p = ctx.providers["sectorRevenueTax"] as SectorRevenueTaxPayload | undefined;
    if (!p) return DEFAULT_UNOWNED_GROWTH_RATE;
    // §6.1 (P7b): concentrate the weighted average toward the region's model's
    // aligned sectors (lagged; parity-neutral when p.model is absent / mixed).
    const legacySector = computeWeightedGrowthRate(p.owned, p.unowned, (st) =>
      concentrationMultiplier(p.model, st)
    );
    // P2/D7 (plants): realized-revenue delta replaces the vestigial growth-rate
    // average. Region level, unowned mass excluded, pre-clamped to the node
    // bounds. No baseline yet (flip turn) → legacy signal, so the cutover turn
    // cannot spike the EMA. Non-plants is untouched (byte-identical).
    const realizedNow =
      typeof p.realizedRevenueNow === "number" && Number.isFinite(p.realizedRevenueNow)
        ? p.realizedRevenueNow
        : sumRealizedRevenue(p.owned, true);
    // Trailing trend first (noise-proof), one-turn delta as the cold-start
    // fallback while the snapshot log matures, legacy weighted average last.
    const trailingSignal = p.plantsEnabled
      ? computeTrailingRevenueGrowthRate(p.revenueEmaNow, p.revenueTrendBaseline, TURNS_PER_YEAR)
      : null;
    const plantsSignal =
      trailingSignal ??
      (p.plantsEnabled
        ? computeRealizedRevenueGrowthRate(
            realizedNow,
            p.realizedRevenuePrev,
            p.turnsSincePrev,
            TURNS_PER_YEAR
          )
        : null);
    const sector = plantsSignal ?? legacySector;
    const taxAdjusted = computeConsumptionTaxAdjustedGrowthRate(
      sector,
      p.federalSalesTax,
      p.stateSalesTax,
      p.countryId
    );
    // Net-exports impulse: trade growth above the world baseline adds demand,
    // below it subtracts. Missing prev → baseline → zero impulse (parity).
    const tradeGrowthLagged = ctx.prev["economic.tradeGrowth"] ?? WORLD_TRADE_BASELINE;
    return taxAdjusted + TRADE_NX_WEIGHT * (tradeGrowthLagged - WORLD_TRADE_BASELINE);
  },
};

/**
 * gdpGrowth node (P1c-2) — the INTEGRATED rate: `potential + cyclical`, where the
 * cyclical part is the output gap's realized change (§5.2). Reverts toward
 * `potential` (the attractor) as the gap closes; the sector signal's deviation
 * from potential is the impulse. `potential` (`economic.potentialGrowth`) and the
 * prior gap (`economic.outputGapPrev`) are threaded in by the phase via
 * `seedCurrent` (they are not registry nodes). No EMA / no policy delta here —
 * the EMA + tax/legislation coexistence live on `sectorGrowth`; this node is the
 * deterministic gap integration. The phase persists the new gap to
 * `state.outputGap`.
 *
 * bounds widened to mirror OUTPUT_GAP_BOUND (2026-06-30 incident): a live
 * GAP_CLOSURE change left `state.outputGap` calibrated to the old steady
 * state, so the first turns under the new constant computed a realized gap
 * swing past the old [-10,15] floor — every region got floor-clamped to an
 * identical -10 instead of showing the true (still bad, but distinct and
 * recovering) value, which fed Okun's law the same worst-case number for
 * every turn the floor bound. [-15,15] gives headroom for a closure-constant
 * transient without distorting the signal Okun's law and others read.
 */
export const gdpGrowthNode: RegistryNode = {
  id: "economic.gdpGrowth",
  categoryId: "economic",
  metricId: "gdpGrowth",
  kind: "derived",
  inputs: ["economic.sectorGrowth"],
  bounds: [...GDP_GROWTH_BOUND],
  inertia: 0,
  maxPolicyDelta: 0,
  decimals: 3,
  compute: (ctx) => {
    const sector = ctx.current["economic.sectorGrowth"] ?? 0;
    const potential = ctx.current["economic.potentialGrowth"] ?? NEUTRAL_GDP_GROWTH;
    const prevGap = ctx.current["economic.outputGapPrev"] ?? 0;
    return advanceOutputGap(prevGap, sector, potential, TURNS_PER_YEAR).gdpGrowth;
  },
};

/**
 * unemploymentRate node — Okun's law on gdpGrowth. A VALUE-EMA with no policy
 * delta (maxPolicyDelta:0), mirroring gdpGrowth.ts exactly: target =
 * clamp(prevUnemployment − okun·gdpDeviation), then 0.85·prev + 0.15·target.
 * The phase feeds `prevSimBaseline["economic.unemploymentRate"]` = the prior
 * unemployment VALUE (defaulted to 4.5 when absent), used for BOTH the Okun
 * target's prev term and the EMA blend. decimals 2; bounds [1,15] (floor
 * matches metricDefinitions minValue 1 so 1953 FR IDF 1.5% survives; ceiling
 * stays tighter than the def's Depression-level 25).
 *
 * v2-3a/v2-3b (gated on labourSystemMode ≥ "macro"): a labour wage-index Δ
 * AND a separate automation-index Δ each add a one-time labor-demand bump,
 * summed and applied AFTER the Okun target/clamp (so the Okun mechanism's
 * own invariants are untouched), then the combined value is re-clamped to
 * the node's bounds. See `labourUnemploymentWagePressure` (3a) for why this
 * reads `economic.labourWageIndexDelta` — the SAME signal medianIncomeNode
 * (v2-2) reads — instead of the wage LEVEL, and `labourUnemploymentAutomationPressure`
 * (3b) for the separate, sign-inverted automation signal.
 */
export const unemploymentNode: RegistryNode = {
  id: "economic.unemploymentRate",
  categoryId: "economic",
  metricId: "unemploymentRate",
  kind: "derived",
  inputs: ["economic.gdpGrowth"],
  bounds: [UNEMPLOYMENT_MIN, UNEMPLOYMENT_MAX],
  inertia: UNEMPLOYMENT_INERTIA,
  maxPolicyDelta: 0,
  decimals: 2,
  compute: (ctx) => {
    const gdp = ctx.current["economic.gdpGrowth"] ?? 0;
    const prevRaw = ctx.prevSimBaseline["economic.unemploymentRate"];
    const prevUnemployment = Number.isFinite(prevRaw) ? prevRaw : 4.5;
    // Okun off the REAL output gap (growth vs potential, P1c-2) instead of a fixed
    // 2.0 — a low-potential (shrinking-workforce) economy isn't permanently "in
    // recession". Falls back to NEUTRAL_GDP_GROWTH when potential isn't seeded.
    const potential = ctx.current["economic.potentialGrowth"] ?? NEUTRAL_GDP_GROWTH;
    const gdpDeviation = gdp - potential;
    const okunCoeff = gdpDeviation > 0 ? OKUN_COEFFICIENT_DOWN : OKUN_COEFFICIENT_UP;
    const okunTarget = Math.max(
      UNEMPLOYMENT_MIN,
      Math.min(UNEMPLOYMENT_MAX, prevUnemployment - gdpDeviation * okunCoeff)
    );
    const wageDelta = ctx.current["economic.labourWageIndexDelta"] ?? 0;
    const automationDelta = ctx.current["economic.automationIndexDelta"] ?? 0;
    const labourPressure =
      labourUnemploymentWagePressure(wageDelta) +
      labourUnemploymentAutomationPressure(automationDelta);
    return Math.max(UNEMPLOYMENT_MIN, Math.min(UNEMPLOYMENT_MAX, okunTarget + labourPressure));
  },
};

/**
 * povertyRate — LIVE (P3a; was the P0 reference node). Drivers: unemployment +
 * incomeInequality (Gini-100, a same-turn social node) push poverty up; the
 * social spending channel relieves it; crimeRate is a LAGGED edge (per-100k
 * post-P3a; breaks the poverty↔crime cycle, which P3b closes from the other
 * side). The medianIncome LEVEL term was DROPPED: incomes are local-currency
 * (a ¥5M median maxed the old $50k-normalized relief clamp) and the node ctx
 * has no countryId for normalization — a currency-normalized income term is
 * named for the balance pass.
 */
export const povertyRateNode: RegistryNode = {
  id: "economic.povertyRate",
  categoryId: "economic",
  metricId: "povertyRate",
  kind: "derived",
  // Bounds must span every ERA. [3,35] ceiling snapped TR_SEA's authored 68
  // (and GR rural 40–48) down to 35 on turn 1. Match metricDefinitions [3,80].
  inputs: [
    "economic.unemploymentRate", // live engine node → topo edge
    "social.incomeInequality", // live social node (P3a) → topo edge
    { spending: "social" },
    { lagged: "publicSafety.crimeRate" },
  ],
  bounds: [3, 80],
  inertia: 0.85,
  // 2dp storage (P3b): the lagged crime term moves the target ~0.04/turn —
  // below 1dp's half-grain, where policy-delta preservation reabsorbs every
  // step (the P2c rounding-plateau class) and the crime→poverty edge dies.
  decimals: 2,
  compute: (ctx) => {
    const unemployment = ctx.current["economic.unemploymentRate"] ?? 5;
    const inequality = ctx.current["social.incomeInequality"] ?? 42; // Gini-100 (node baseline 42)
    const crimeLagged = ctx.prev["publicSafety.crimeRate"] ?? 4500; // per 100k, last turn (node baseline 4500)
    const socialResponse = fundingResponse(ctx.spending["social"] ?? 0, SOCIAL_SPEND_HALF_SAT, 100);

    // Balance pass: centering refs match the driven nodes' baselines
    // (incomeInequality 42, crimeRate 4500) so each deviation term is 0 at the
    // cross-tier equilibrium — internally consistent + correct missing-input
    // fallback. Slopes unchanged (they drive the live response).
    return (
      13 +
      (unemployment - 5) * 0.6 +
      (inequality - 42) * 0.15 +
      (crimeLagged - 4500) * 0.0004 -
      socialResponse * 0.06
    );
  },
};

/**
 * medianIncome — RELATIVE form (P3a): incomes are local-currency across six
 * economies, so the node NEVER anchors absolutes — it grows its own prior
 * simBaseline by the wage-growth rate (productivity + labor-market tightness),
 * per turn. inertia 0 (the compute itself is the increment); the policy delta
 * (e.g. minimum-wage acts) rides on top.
 *
 * v2-2 (gated on labourSystemMode ≥ "macro"): a CHANGE in the labour wage
 * index adds a one-time impulse to wageGrowthAnnualPct via
 * `labourWageIncomePassthrough`. Read from `ctx.current` rather than declared
 * in `inputs` — the phase seeds it manually (like potentialGrowth/
 * outputGapPrev) so the gate can live at the read site instead of the write
 * site (the corp turn writes the field at the lower "wages" tier). Absent ⇒
 * 0 — byte-identical to pre-v2-2 behaviour.
 */
export const medianIncomeNode: RegistryNode = {
  id: "economic.medianIncome",
  categoryId: "economic",
  metricId: "medianIncome",
  kind: "derived",
  // Bounds must span every ERA. Floor 1000 was a modern-USD assumption —
  // NG NORTH_EAST authors 100 (and JP 600–900, CN 320–480) on the 1953 seed
  // scale. Match metricDefinitions [0, 10_000_000].
  inputs: ["economic.productivityGrowth", "economic.unemploymentRate"],
  bounds: [0, 10_000_000],
  inertia: 0,
  decimals: 0,
  compute: (ctx) => {
    const id = "economic.medianIncome";
    const base = Number.isFinite(ctx.prevSimBaseline[id])
      ? ctx.prevSimBaseline[id]
      : Number.isFinite(ctx.prev[id])
        ? ctx.prev[id]
        : 50_000;
    const productivity = ctx.current["economic.productivityGrowth"] ?? 1.2; // %/yr
    const unemployment = ctx.current["economic.unemploymentRate"] ?? 5;
    const tightness = (5 - unemployment) * 0.3; // tight labor market bids wages up
    const labourPressure = labourWageIncomePassthrough(
      ctx.current["economic.labourWageIndexDelta"] ?? 0
    );
    const wageGrowthAnnualPct = productivity + tightness + labourPressure;
    return base * (1 + wageGrowthAnnualPct / 100 / TURNS_PER_YEAR);
  },
};

/**
 * costOfLiving — 100-centered index, drifting slowly toward a structural level
 * set by urbanization (denser regions cost more). Housing-supply pressure joins
 * in P3d when the housing cluster animates.
 */
export const costOfLivingNode: RegistryNode = {
  id: "economic.costOfLiving",
  categoryId: "economic",
  metricId: "costOfLiving",
  kind: "derived",
  inputs: ["population.urbanizationRate"], // seedCurrent root
  bounds: [40, 200],
  inertia: 0.95,
  decimals: 2, // 2dp: cabinet effects (≤0.05/turn) are reabsorbed at a coarser grain — bug #0800
  compute: (ctx) => {
    const urbanization = ctx.current["population.urbanizationRate"] ?? 55;
    return 100 + (urbanization - 55) * 0.3;
  },
};

/**
 * productivityGrowth — the surfaced TFP readout (P2d), animated from the SAME
 * basket formula that drives potential growth, so the metric and the engine
 * input agree (any level difference is the preserved seed delta — the universal
 * coexistence story). skill/transport are same-turn node reads; rdIntensity /
 * urbanizationRate come via seedCurrent (policy roots, not yet animated).
 * The phase's potential-growth basket reads PREV values (the C3 lag); this node
 * reads same-turn — a one-turn skew, irrelevant at these inertias.
 */
export const productivityGrowthNode: RegistryNode = {
  id: "economic.productivityGrowth",
  categoryId: "economic",
  metricId: "productivityGrowth",
  kind: "derived",
  // Bounds must span every ERA. [−3,6] ceiling snapped JP's authored 1953
  // recovery productivity (8.0) down to 6 on turn 1. Match metricDefinitions
  // [−3,12].
  inputs: [
    "education.workforceSkill",
    "infrastructure.transportEfficiency",
    "infrastructure.broadbandAccess",
    "infrastructure.powerGridReliability",
    "economic.rdIntensity", // seedCurrent (root)
    "population.urbanizationRate", // seedCurrent (root)
  ],
  bounds: [-3, 12],
  inertia: 0.9,
  decimals: 2,
  compute: (ctx) =>
    tfpBasket({
      rdIntensity: ctx.current["economic.rdIntensity"],
      workforceSkill: ctx.current["education.workforceSkill"],
      transportEfficiency: ctx.current["infrastructure.transportEfficiency"],
      broadbandAccess: ctx.current["infrastructure.broadbandAccess"],
      powerGridReliability: ctx.current["infrastructure.powerGridReliability"],
      urbanizationRate: ctx.current["population.urbanizationRate"],
    }),
};

/**
 * Real-wage growth clamp (annualized %). The medianIncome stock can lurch on a
 * one-turn minimum-wage policy delta or a labor-market swing; clamping the REAL
 * component keeps a single act from compounding the income-tax base absurdly.
 * The nominal inflation pass-through (below) is intentionally OUTSIDE this clamp
 * so hyperinflation still flows into nominal wages.
 */
export const REAL_WAGE_CLAMP: readonly [number, number] = [-5, 15];

/**
 * Fraction of LAGGED inflation that passes through into nominal wage growth
 * (first-pass; pinned by the BR-1991 calibration test in T7). Low by design: in
 * hyperinflation nominal wages chase prices with a lag, so only a slice
 * compounds the income-tax base each turn rather than the full price level.
 */
export const WAGE_INFLATION_PASSTHROUGH = 0.1;

/**
 * wageGrowth — the ANNUAL wage-growth rate (display %) that compounds the
 * income-tax base. Two components:
 *   REAL    = annualized per-turn growth of the (inflation-free) medianIncome
 *             stock — `((cur−prev)/prev)·TURNS_PER_YEAR·100` — CLAMPED.
 *   NOMINAL = `WAGE_INFLATION_PASSTHROUGH × laggedInflation` (from the
 *             fiscalTradeInputs provider; lagged so the wage↔inflation loop is a
 *             cross-turn damped cycle, never same-turn), NOT clamped.
 * medianIncome is a registry node: `cur` is its same-turn value (topo-ordered
 * before this node) and `prev` is last turn's value (phase populates both). The
 * value is an ANNUAL rate; the per-turn `fiscalBaseGrowth` phase slices it by
 * TURNS_PER_YEAR when it compounds the tax base.
 */
export const wageGrowthNode: RegistryNode = {
  id: "economic.wageGrowth",
  categoryId: "economic",
  metricId: "wageGrowth",
  kind: "derived",
  inputs: ["economic.medianIncome", { provider: "fiscalTradeInputs" }],
  bounds: [-10, 600],
  inertia: 0.6,
  decimals: 1,
  compute: (ctx) => {
    const id = "economic.medianIncome";
    const cur = ctx.current[id];
    const prev = ctx.prev[id];
    const trade = ctx.providers["fiscalTradeInputs"] as FiscalTradeInputs | undefined;
    const laggedInflation = trade?.inflationRate ?? 2;
    let real = 0;
    if (Number.isFinite(cur) && Number.isFinite(prev) && prev > 0) {
      real = ((cur - prev) / prev) * TURNS_PER_YEAR * 100;
    }
    const realClamped = Math.max(REAL_WAGE_CLAMP[0], Math.min(REAL_WAGE_CLAMP[1], real));
    return realClamped + WAGE_INFLATION_PASSTHROUGH * laggedInflation;
  },
};

/**
 * tradeGrowth calibration (first-pass; pinned by the Laffer/sim tests in T7).
 * `WORLD_TRADE_BASELINE` is the neutral global trade tailwind; tariffs and a high
 * foreign-corporate tax are wedges that suppress it (the protectionist Laffer
 * cost); active FTA partners, economic-bloc membership, a weak currency, and a
 * competitive manufacturing base lift it.
 */
export const WORLD_TRADE_BASELINE = 2.5;
export const TARIFF_WEDGE_K = 0.15; // pp of tradeGrowth lost per 1% tariff
export const FOREIGN_TAX_WEDGE_K = 0.03; // pp lost per 1% foreign-corporate tax
export const FTA_OPENNESS_K = 0.4; // pp gained per active FTA partner
export const BLOC_MEMBER_BONUS = 1.0; // pp gained for economic-bloc membership
export const FOREX_COMPETITIVENESS_K = 2.0; // pp per unit of currency weakness (rate/base−1)
export const MANUFACTURING_DRIFT_K = 0.02; // pp per point of mfg competitiveness vs ref
export const MANUFACTURING_REF = 60; // neutral manufacturingCompetitiveness

/**
 * tradeGrowth — the ANNUAL trade/import growth rate (display %) that compounds
 * the trade/tariff tax base. An emergent trade-Laffer curve: raising tariffs
 * (or a punitive foreign-corporate tax) shrinks the base growth, so receipts
 * (rate × shrinking base) turn over. Lifted by FTA partners, economic-bloc
 * membership, a weak (export-competitive) currency, and manufacturing strength.
 * All external inputs come from the `fiscalTradeInputs` provider (P0-R1);
 * `manufacturingCompetitiveness` is a seedCurrent root (its stored value).
 * Applied per-turn downstream (fiscalBaseGrowth slices it by TURNS_PER_YEAR).
 */
export const tradeGrowthNode: RegistryNode = {
  id: "economic.tradeGrowth",
  categoryId: "economic",
  metricId: "tradeGrowth",
  kind: "derived",
  inputs: [{ provider: "fiscalTradeInputs" }, "economic.manufacturingCompetitiveness"],
  bounds: [-30, 30],
  inertia: 0.6,
  decimals: 1,
  compute: (ctx) => {
    const t = ctx.providers["fiscalTradeInputs"] as FiscalTradeInputs | undefined;
    const tariff = t?.tariff ?? 0;
    const foreignTax = t?.foreignCorporateTax ?? 0;
    const ftaPartners = t?.ftaPartnerCount ?? 0;
    const blocMember = t?.blocMember ?? false;
    const forex = t?.forexStrength ?? 0;
    const mfg = ctx.current["economic.manufacturingCompetitiveness"] ?? MANUFACTURING_REF;
    return (
      WORLD_TRADE_BASELINE -
      TARIFF_WEDGE_K * tariff -
      FOREIGN_TAX_WEDGE_K * foreignTax +
      FTA_OPENNESS_K * ftaPartners +
      (blocMember ? BLOC_MEMBER_BONUS : 0) +
      FOREX_COMPETITIVENESS_K * forex +
      MANUFACTURING_DRIFT_K * (mfg - MANUFACTURING_REF)
    );
  },
};

// P6a axis metric (approval-excluded until the P6d cutover): the econ-right
// scoreboard anchor. Tax-level wiring lands with the P6c symmetry sweep.
export const economicFreedomNode: RegistryNode = {
  id: "economic.economicFreedom",
  categoryId: "economic",
  metricId: "economicFreedom",
  kind: "derived",
  inputs: ["economic.regulatoryBurden", "economic.smallBusinessFormation"],
  bounds: [0, 100],
  inertia: 0.9,
  decimals: 1,
  compute: (ctx) => {
    const burden = ctx.current["economic.regulatoryBurden"] ?? 50; // root
    const smallBusiness = ctx.current["economic.smallBusinessFormation"] ?? 8; // root
    return 50 - (burden - 50) * 0.5 + (smallBusiness - 8) * 1.5;
  },
};

/**
 * consumerConfidence — per-state demand-side sentiment (0–100, neutral 60).
 * Mean-reverts (high inertia) toward a target set by local conditions: high
 * unemployment and cost of living depress it; a real-income cushion lifts it.
 * Crisis `$inc`s land on top as a policy delta, capped at ±25 and eroded 10%
 * per turn via policyDeltaDecay (S8) — inertia alone decays the BASELINE, not
 * the preserved delta, so without decay a one-time shock was frozen forever.
 * Approval-excluded (it is a driver of margins/valuation, not a scored
 * outcome). Feeds the consumerConfidence margin signal in
 * sectorMetricMarginProfiles.ts.
 */
export const consumerConfidenceNode: RegistryNode = {
  id: "economic.consumerConfidence",
  categoryId: "economic",
  metricId: "consumerConfidence",
  kind: "derived",
  inputs: ["economic.unemploymentRate", "economic.costOfLiving"],
  bounds: [0, 100],
  inertia: 0.8,
  maxPolicyDelta: 25,
  policyDeltaDecay: 0.9,
  decimals: 1,
  compute: (ctx) => {
    const unemployment = ctx.current["economic.unemploymentRate"] ?? 5;
    const costOfLiving = ctx.current["economic.costOfLiving"] ?? 100; // 100-centered index
    // Target centered at 60: each point of unemployment above 5 shaves ~2.5;
    // each cost-of-living point above 100 shaves ~0.3. Bounds clamp the extremes.
    return 60 - (unemployment - 5) * 2.5 - (costOfLiving - 100) * 0.3;
  },
};

/**
 * investorConfidence — per-state investment-side sentiment (0–100, neutral 60).
 * Mean-reverts toward a target lifted by local growth and a healthy small-business
 * formation rate. Crisis `$inc`s land as a policy delta, capped at ±25 and
 * eroded 10% per turn via policyDeltaDecay (S8; inertia only decays the
 * baseline, not the delta). Approval-excluded. Folded into
 * the share-price sentiment multiplier for HQ'd corps (applyPriceMultipliers.ts).
 * NOTE: distinct from the NATIONAL federalBudget.investorConfidence
 * (src/lib/nationalization/investorConfidence.ts) used for founding/sovereign premiums.
 */
export const investorConfidenceNode: RegistryNode = {
  id: "economic.investorConfidence",
  categoryId: "economic",
  metricId: "investorConfidence",
  kind: "derived",
  inputs: ["economic.gdpGrowth", "economic.smallBusinessFormation"],
  bounds: [0, 100],
  inertia: 0.8,
  maxPolicyDelta: 25,
  policyDeltaDecay: 0.9,
  decimals: 1,
  compute: (ctx) => {
    const gdp = ctx.current["economic.gdpGrowth"] ?? NEUTRAL_GDP_GROWTH;
    const smallBusiness = ctx.current["economic.smallBusinessFormation"] ?? 8; // root
    // Target centered at 60: each point of growth above neutral adds ~4; each
    // small-business-formation point above 8 adds ~1.5.
    return 60 + (gdp - NEUTRAL_GDP_GROWTH) * 4 + (smallBusiness - 8) * 1.5;
  },
};

export const ECONOMIC_NODES: RegistryNode[] = [
  sectorGrowthNode,
  gdpGrowthNode,
  unemploymentNode,
  productivityGrowthNode,
  // P3a — the income/poverty cluster (economic side).
  medianIncomeNode,
  costOfLivingNode,
  povertyRateNode,
  economicFreedomNode,
  // Per-state confidence drivers (approval-excluded): consumer → margins,
  // investor → HQ corp valuation. Both mean-revert; crises move them.
  consumerConfidenceNode,
  investorConfidenceNode,
  // Dynamic fiscal-growth factors: wageGrowth reads off medianIncome + lagged
  // inflation; tradeGrowth off tariff/foreign-tax/FTA/forex/mfg. Both compound
  // their tax base per turn (fiscalBaseGrowth phase).
  wageGrowthNode,
  tradeGrowthNode,
];
