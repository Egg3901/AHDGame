import { fundingResponse, maintenanceDecay } from "../spendingChannel";
import { warRoadTargetPenalty, warRoadExtraDecay, type WarDamage } from "@/lib/military/warDamage";
import type { EngineNodeContext, RegistryNode } from "../types";

/**
 * Infrastructure nodes (spec P2c §4.3), LIVE via the generic phase wiring. The
 * capital metrics use MAINTENANCE-DECAY: the stock erodes by ≤decay per turn and
 * the funding target holds it up — sustained underfunding visibly degrades
 * roads/transit/broadband/water/grid; adequate funding pins them at the level
 * the spend supports. The decay runs on the node's own prior simBASELINE (see
 * capitalCompute's CRITICAL SEMANTICS note) — own-prev/baseline reads are not
 * topo edges, so no cycle.
 *
 * Cold-start parity is structural (P2a/P2b-proven). Constants are first-pass
 * directional; the balance pass tunes decay/targets.
 */

// Per-capita infrastructure spend at which the channel reaches half its response.
//
// Recalibrated per ticket #826 item 14 (spend-response recalibration pass,
// infrastructure category). The old value (2) saturated the response near
// ~99.8-99.96% at realistic US spend, so infra bills barely moved
// roadCondition/waterQuality/etc — confirmed live in prod (roadCondition
// simBaseline ~94.8, waterQuality/broadbandAccess ~99.7-99.9 across states
// with an 8x population range).
//
// Real per-capita range (US, GDP cost-scale-adjusted via
// src/lib/budget/costs.ts COST_SCALE_ANCHORS.US, scaleHigh=1.27 at 2023
// GDP/capita):
//   - Baseline (today's enacted defaults): us_transportation + us_broadband_energy
//     nominal $636 + $339 = $975/capita x 1.27 = ~$1238/capita.
//   - Max (all 4 infrastructure-domain bills — us_transportation,
//     us_broadband_energy, us_state_transportation, us_state_utilities — enacted
//     at their most-expansive option): (1273+679+1273+764) x 1.27 = ~$5066/capita.
//   - Min (all 4 eliminated): $0/capita.
// (See src/lib/seeds/reference/legislationTypes.ts for the per-option
// per-capita cost arrays.)
//
// 1200 sits near the empirically-confirmed current baseline (~$1238/capita),
// putting baseline spend near the middle of the response curve (~51%) instead
// of pinned at the ceiling (~99.8%), while max realistic spend now reaches
// ~81% — a real ~30-point spread a player's bills can move.
export const INFRA_SPEND_HALF_SAT = 1200;

const spendResp = (ctx: EngineNodeContext): number =>
  fundingResponse(ctx.spending["infrastructure"] ?? 0, INFRA_SPEND_HALF_SAT, 100); // 0..100

/** Funding-supported level for a capital metric, scaled to its realistic band. */
const supportedLevel = (ctx: EngineNodeContext, floor: number, span: number): number =>
  floor + (spendResp(ctx) / 100) * span;

/**
 * Capital-stock compute: erode unless funding holds the stock up.
 *
 * CRITICAL SEMANTICS: the decay must run on the node's own prior simBASELINE,
 * not its stored value — the coexistence wrapper preserves
 * `policyDelta = storedValue − prevSimBaseline`, so decaying from the stored
 * value gets exactly cancelled (the per-turn drop is re-classified as policy
 * delta and added back; sim-test-proven). Decaying the baseline erodes the
 * VALUE while law effects (the §4.7 keep-listed sub-allocation acts) ride on
 * top undisturbed. The EMA damps a baseline step by (1−inertia), so the
 * baseline step is scaled by 1/(1−inertia) to make the VALUE erode at the
 * intended `decayPerTurn`.
 */
const capitalCompute =
  (
    id: string,
    floor: number,
    span: number,
    decayPerTurn: number,
    inertia: number,
    fallback: number
  ) =>
  (ctx: EngineNodeContext): number => {
    const base = Number.isFinite(ctx.prevSimBaseline[id])
      ? ctx.prevSimBaseline[id]
      : Number.isFinite(ctx.prev[id])
        ? ctx.prev[id]
        : fallback;
    const effectiveDecay = decayPerTurn / (1 - inertia);
    return maintenanceDecay(base, supportedLevel(ctx, floor, span), effectiveDecay);
  };

/**
 * Share of a region's sector revenue coming from the logistics sector at which
 * freight is considered adequately provisioned. Roughly the real
 * transport-and-warehousing share of output.
 */
export const ROAD_FREIGHT_REFERENCE_SHARE = 0.05;

/** Most the freight term can ADD to the road-condition target, in points. */
export const ROAD_FREIGHT_MAX_BONUS = 6;

/** Most the freight term can SUBTRACT, in points. */
export const ROAD_FREIGHT_MAX_PENALTY = 4;

/**
 * Freight adequacy term for the road-condition target (ticket #1143).
 *
 * Same shape, and the same rationale, as `gridEnergyAdequacyTerm` (suggestion
 * #90) — but for freight → transport instead of generation → grid. Before this,
 * `roadCondition` (and `transportEfficiency`, which composites it) moved ONLY on
 * government infrastructure spending. A player could build the logistics sector
 * every turn and watch the road/transport reading sit still, while
 * `getRoadConditionMarginModifier` taxed every ROAD_CONDITION_SECTORS
 * corporation in the state — manufacturing among them — for the low reading.
 * The player-visible symptom (ticket #1143): the region shows freight
 * over-supplied while Manufacturing is penalized for "low logistics," two
 * screens that never reconciled because logistics-sector output was not an input
 * to the metric the penalty reads.
 *
 * Logistics-sector revenue share is the freight-provisioning proxy (mirrors the
 * energy term's revenue-share model): an oversupplied freight sector still earns
 * revenue, so its share is high → bonus → the road/logistics-cost line the
 * corporation sees improves. A thin logistics sector → penalty.
 *
 * Returns 0 with no sector data, so a region the provider cannot see keeps
 * exactly its old spending-only target.
 */
export function freightLogisticsAdequacyTerm(
  rows: Array<{ revenue: number; sectorType?: string }>
): number {
  let logistics = 0;
  let total = 0;
  for (const row of rows) {
    const rev = Number.isFinite(row.revenue) ? Math.max(0, row.revenue) : 0;
    if (rev <= 0) continue;
    total += rev;
    if (row.sectorType === "logistics") logistics += rev;
  }
  if (total <= 0) return 0;

  const share = logistics / total;
  // Ratio of actual logistics share to the reference. 1 = adequately provisioned.
  const ratio = share / ROAD_FREIGHT_REFERENCE_SHARE;
  if (ratio >= 1) {
    // Diminishing returns above adequacy: extra freight capacity past what the
    // region needs still helps, but must not buy arbitrarily perfect roads.
    return ROAD_FREIGHT_MAX_BONUS * Math.min(1, (ratio - 1) / 1.5);
  }
  return -ROAD_FREIGHT_MAX_PENALTY * (1 - ratio);
}

export const roadConditionNode: RegistryNode = {
  id: "infrastructure.roadCondition",
  categoryId: "infrastructure",
  metricId: "roadCondition",
  kind: "derived",
  // Maintenance-decay off infrastructure spend, plus the region's own freight
  // provisioning (ticket #1143) so logistics-sector build-out lifts the metric
  // the corp margin penalty reads.
  inputs: [
    { spending: "infrastructure" },
    { provider: "sectorRevenueTax" },
    // A war fought across this country's ground. See `warDamage`: the host is
    // damaged, an expeditionary belligerent is not.
    { provider: "warDamage" },
  ],
  bounds: [0, 100],
  inertia: 0.85,
  decimals: 2, // 2dp storage: per-turn decay steps (~0.05) stall on a 0.1 rounding grain
  // THRESHOLDS [40 worst, 90 best]; ~3 pts/yr erosion without upkeep. Same
  // baseline-decay semantics as capitalCompute (decay the simBaseline, scaled by
  // 1/(1−inertia)) with the freight-adequacy term added to the supported target.
  compute: (ctx) => {
    const id = "infrastructure.roadCondition";
    const base = Number.isFinite(ctx.prevSimBaseline[id])
      ? ctx.prevSimBaseline[id]
      : Number.isFinite(ctx.prev[id])
        ? ctx.prev[id]
        : 65;
    const payload = ctx.providers["sectorRevenueTax"] as
      | {
          owned: Array<{ revenue: number; sectorType?: string }>;
          unowned: Array<{ revenue: number; sectorType?: string }>;
        }
      | undefined;
    const freightTerm = payload
      ? freightLogisticsAdequacyTerm([...payload.owned, ...payload.unowned])
      : 0;
    // War takes the roads BOTH ways: it lowers the level funding can hold, and it
    // destroys faster than neglect does. Lowering the floor alone is far too gentle
    // unfunded erosion is 0.06 a turn, so a war would need ~400 turns to reach a
    // reduced floor and the War for Germany ran 130. Both terms are zero at peace,
    // which is the overwhelmingly common case and bit-identical to before.
    const war = ctx.providers["warDamage"] as WarDamage | undefined;
    const target = supportedLevel(ctx, 35, 60) + freightTerm - warRoadTargetPenalty(war);
    const decay = (0.06 + warRoadExtraDecay(war)) / (1 - 0.85);
    return maintenanceDecay(base, target, decay);
  },
};

export const publicTransitNode: RegistryNode = {
  id: "infrastructure.publicTransit",
  categoryId: "infrastructure",
  metricId: "publicTransit",
  kind: "derived",
  inputs: [{ spending: "infrastructure" }],
  bounds: [0, 100],
  inertia: 0.85,
  decimals: 2, // 2dp storage: per-turn decay steps (~0.05) stall on a 0.1 rounding grain
  // THRESHOLDS [15, 90] — transit needs sustained operating funding.
  compute: capitalCompute("infrastructure.publicTransit", 10, 85, 0.05, 0.85, 45),
};

export const broadbandAccessNode: RegistryNode = {
  id: "infrastructure.broadbandAccess",
  categoryId: "infrastructure",
  metricId: "broadbandAccess",
  kind: "derived",
  inputs: [{ spending: "infrastructure" }],
  bounds: [0, 100],
  inertia: 0.9,
  decimals: 2, // 2dp storage: per-turn decay steps (~0.05) stall on a 0.1 rounding grain
  // THRESHOLDS [50, 99]; built networks degrade slowly (0.03/turn).
  compute: capitalCompute("infrastructure.broadbandAccess", 45, 55, 0.03, 0.9, 75),
};

export const waterQualityNode: RegistryNode = {
  id: "infrastructure.waterQuality",
  categoryId: "infrastructure",
  metricId: "waterQuality",
  kind: "derived",
  inputs: [{ spending: "infrastructure" }],
  bounds: [0, 100],
  inertia: 0.88,
  decimals: 2, // 2dp storage: per-turn decay steps (~0.05) stall on a 0.1 rounding grain
  // THRESHOLDS [70, 99].
  compute: capitalCompute("infrastructure.waterQuality", 65, 35, 0.04, 0.88, 88),
};

/**
 * Share of a region's sector revenue coming from generation and utilities at
 * which the grid is considered adequately supplied. Roughly matches the real
 * electricity + utilities share of output.
 */
export const GRID_ENERGY_REFERENCE_SHARE = 0.04;

/** Most the energy term can ADD to the reliability target, in points. */
export const GRID_ENERGY_MAX_BONUS = 0.8;

/** Most the energy term can SUBTRACT, in points. */
export const GRID_ENERGY_MAX_PENALTY = 0.5;

/**
 * Generation adequacy term for the grid target (suggestion #90).
 *
 * Before this, `powerGridReliability` moved on infrastructure SPENDING and
 * lagged renewables and nothing else. An Energy Secretary could build
 * generation every turn for a game decade and watch the number sit still,
 * because no amount of installed energy capacity was an input to the grid
 * metric — while `getGridReliabilityMarginModifier` taxed every corporation in
 * the state for the resulting low reading. Generation was disconnected from the
 * one metric it should obviously drive.
 *
 * Returns 0 with no sector data, so a region the provider cannot see keeps
 * exactly its old spending-only target.
 */
export function gridEnergyAdequacyTerm(
  rows: Array<{ revenue: number; sectorType?: string }>
): number {
  let energy = 0;
  let total = 0;
  for (const row of rows) {
    const rev = Number.isFinite(row.revenue) ? Math.max(0, row.revenue) : 0;
    if (rev <= 0) continue;
    total += rev;
    if (row.sectorType === "energy" || row.sectorType === "utilities") energy += rev;
  }
  if (total <= 0) return 0;

  const share = energy / total;
  // Ratio of actual generation share to the reference. 1 = adequately supplied.
  const ratio = share / GRID_ENERGY_REFERENCE_SHARE;
  if (ratio >= 1) {
    // Diminishing returns above adequacy: doubling generation past what the
    // region needs should help, but it must not buy an arbitrarily perfect grid.
    return GRID_ENERGY_MAX_BONUS * Math.min(1, (ratio - 1) / 1.5);
  }
  return -GRID_ENERGY_MAX_PENALTY * (1 - ratio);
}

export const powerGridReliabilityNode: RegistryNode = {
  id: "infrastructure.powerGridReliability",
  categoryId: "infrastructure",
  metricId: "powerGridReliability",
  kind: "derived",
  // Maintenance-decay, a small renewables-modernization term (lagged — grid
  // investment follows the energy transition; Environment animates in P3), and
  // the region's own generation adequacy (suggestion #90).
  inputs: [
    { spending: "infrastructure" },
    { lagged: "environment.renewableEnergy" },
    { provider: "sectorRevenueTax" },
  ],
  bounds: [0, 100],
  inertia: 0.9,
  decimals: 2, // 2dp storage: per-turn decay steps (~0.05) stall on a 0.1 rounding grain
  // THRESHOLDS [97, 99.9] — a tight realistic band, tiny per-turn drift. Same
  // baseline-decay semantics as capitalCompute (decay the simBaseline, scaled by
  // 1/(1−inertia)) with the renewables-modernization term added to the target.
  compute: (ctx) => {
    const id = "infrastructure.powerGridReliability";
    const base = Number.isFinite(ctx.prevSimBaseline[id])
      ? ctx.prevSimBaseline[id]
      : Number.isFinite(ctx.prev[id])
        ? ctx.prev[id]
        : 98.5;
    const renewables = ctx.prev["environment.renewableEnergy"] ?? 25; // lagged, 0-100
    const payload = ctx.providers["sectorRevenueTax"] as
      | {
          owned: Array<{ revenue: number; sectorType?: string }>;
          unowned: Array<{ revenue: number; sectorType?: string }>;
        }
      | undefined;
    const energyTerm = payload ? gridEnergyAdequacyTerm([...payload.owned, ...payload.unowned]) : 0;
    const target = 97 + (spendResp(ctx) / 100) * 2.7 + (renewables - 25) * 0.004 + energyTerm;
    return maintenanceDecay(base, target, 0.02 / (1 - 0.9));
  },
};

export const infrastructureInvestmentGapNode: RegistryNode = {
  id: "infrastructure.infrastructureInvestmentGap",
  categoryId: "infrastructure",
  metricId: "infrastructureInvestmentGap",
  kind: "derived",
  // Needed-vs-actual investment: the inverse of the funding response (LOWER is
  // better — THRESHOLDS [5 best, 45 worst]). No decay: it tracks current spend.
  inputs: [{ spending: "infrastructure" }],
  bounds: [0, 100],
  inertia: 0.7,
  decimals: 2, // 2dp: cabinet effects (≤0.05/turn) are reabsorbed at a coarser grain — bug #0800
  compute: (ctx) => 50 - (spendResp(ctx) / 100) * 45,
};

export const transportEfficiencyNode: RegistryNode = {
  id: "infrastructure.transportEfficiency",
  categoryId: "infrastructure",
  metricId: "transportEfficiency",
  kind: "derived",
  // Composite of the transport capital stocks — the P2d TFP hand-off.
  inputs: ["infrastructure.publicTransit", "infrastructure.roadCondition"],
  bounds: [0, 100],
  inertia: 0.8,
  decimals: 2, // 2dp: cabinet effects (≤0.05/turn) are reabsorbed at a coarser grain — bug #0800
  compute: (ctx) => {
    const transit = ctx.current["infrastructure.publicTransit"] ?? 45;
    const roads = ctx.current["infrastructure.roadCondition"] ?? 65;
    return transit * 0.45 + roads * 0.55;
  },
};

/**
 * Infrastructure derived nodes, registered in `METRIC_REGISTRY`. Topo within
 * tier: {publicTransit, roadCondition} → transportEfficiency.
 */
export const INFRASTRUCTURE_NODES: RegistryNode[] = [
  roadConditionNode,
  publicTransitNode,
  broadbandAccessNode,
  waterQualityNode,
  powerGridReliabilityNode,
  infrastructureInvestmentGapNode,
  transportEfficiencyNode,
];
