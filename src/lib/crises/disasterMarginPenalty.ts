import type { Crisis } from "@/lib/db/types/crisis";

export interface DisasterEffectEntry {
  value: number;
  startTurn: number;
  durationTurns: number;
  sectorType: string | null;
  strategyId: string | null;
  /** See CrisisEffect.physicality. Absent = financial (margin-only). */
  physicality?: "physical" | "financial";
}

type DecayCrisis = Pick<Crisis, "effects" | "startTurn" | "durationTurns" | "regionIds">;

/**
 * Index every active crisis's decaying `profitMargin` effects by the stateId they
 * apply to. `resolveStateIds` maps a crisis to its affected states; it defaults to
 * `crisis.regionIds` (region-scoped infrastructure disasters), but the turn engine
 * and sector-detail query pass a scope-aware resolver so global/country economic
 * crises (Pandemic, Recession, …) reach every corp in scope, not just regions.
 */
export function buildDisasterEffectsByState<T extends DecayCrisis>(
  crises: T[],
  resolveStateIds: (crisis: T) => readonly string[] = (c) => c.regionIds
): Map<string, DisasterEffectEntry[]> {
  const result = new Map<string, DisasterEffectEntry[]>();
  for (const crisis of crises) {
    const decayEffects = crisis.effects.filter(
      (e) => e.effectType === "decay" && e.targetType === "profitMargin"
    );
    if (decayEffects.length === 0 || crisis.durationTurns == null) continue;
    for (const stateId of resolveStateIds(crisis)) {
      const list = result.get(stateId) ?? [];
      for (const eff of decayEffects) {
        list.push({
          value: eff.value,
          startTurn: crisis.startTurn,
          durationTurns: crisis.durationTurns,
          sectorType: eff.sectorType,
          strategyId: eff.strategyId,
          physicality: eff.physicality,
        });
      }
      result.set(stateId, list);
    }
  }
  return result;
}

/**
 * Transient, linearly-decaying margin penalty for a sector during active
 * natural disasters. Full `value` at startTurn, ramping to 0 at
 * `startTurn + durationTurns`. Penalties from overlapping disasters sum.
 * Returns <= 0 (a margin delta in percentage points).
 */
export function computeDisasterMarginPenalty(
  entries: DisasterEffectEntry[],
  sector: { sectorType: string; strategyId: string | null },
  currentTurn: number
): number {
  const { marginPenalty, productionPenalty } = computeDisasterPenaltySplit(
    entries,
    sector,
    currentTurn,
    false
  );
  // plantsEnabled=false puts everything in the margin bucket, so this is the
  // pre-P3.5 total by construction.
  return marginPenalty + productionPenalty;
}

/** Result of splitting active disaster penalties into their two legs. */
export interface DisasterPenaltySplit {
  /**
   * Percentage-point margin delta (<= 0), summed over the FINANCIAL effects.
   * Feeds `totalMarginMod` exactly as the whole penalty used to.
   */
  marginPenalty: number;
  /**
   * Percentage-point delta (<= 0) summed over the PHYSICAL effects. Not a margin
   * number — it is consumed as a production haircut via `disasterProductionFactor`.
   * Always 0 when `plantsEnabled` is false.
   */
  productionPenalty: number;
}

/**
 * P3.5 canonical output: split the active, decaying disaster penalties for a
 * sector into a financial (margin) leg and a physical (production) leg.
 *
 * Below the plants tier — and for every effect that carries no `physicality`,
 * which is every crisis spawned before P3.5 — the whole penalty lands in
 * `marginPenalty`, so `marginPenalty + productionPenalty` equals the old
 * `computeDisasterMarginPenalty` total and behaviour is byte-identical.
 *
 * Under plants, physical events (a blackout, a shut port, a halted plant) stop
 * being a discount on a full shipment and start reducing the shipment: their
 * points route to `productionPenalty`, which the caller turns into a factor
 * with `disasterProductionFactor`.
 */
export function computeDisasterPenaltySplit(
  entries: DisasterEffectEntry[],
  sector: { sectorType: string; strategyId: string | null },
  currentTurn: number,
  plantsEnabled: boolean
): DisasterPenaltySplit {
  let marginPenalty = 0;
  let productionPenalty = 0;
  for (const entry of entries) {
    if (entry.sectorType && entry.sectorType !== sector.sectorType) continue;
    if (entry.strategyId && entry.strategyId !== sector.strategyId) continue;
    if (entry.durationTurns <= 0) continue;
    const expiryTurn = entry.startTurn + entry.durationTurns;
    const turnsRemaining = expiryTurn - currentTurn;
    if (turnsRemaining <= 0) continue;
    const clamped = Math.min(turnsRemaining, entry.durationTurns);
    const decayed = entry.value * (clamped / entry.durationTurns);
    if (plantsEnabled && entry.physicality === "physical") {
      productionPenalty += decayed;
    } else {
      marginPenalty += decayed;
    }
  }
  return { marginPenalty, productionPenalty };
}

/**
 * Convert a physical penalty in margin percentage points into a multiplicative
 * production factor: P points of penalty (P <= 0) become `1 - |P|/100`.
 * Clamped to [0, 1] so overlapping catastrophes idle a sector rather than
 * inverting its output. Returns exactly 1 for no physical penalty, which keeps
 * the flip turn and every non-plants world unchanged.
 */
export function disasterProductionFactor(productionPenalty: number): number {
  if (!Number.isFinite(productionPenalty) || productionPenalty >= 0) return 1;
  return Math.max(0, Math.min(1, 1 + productionPenalty / 100));
}
