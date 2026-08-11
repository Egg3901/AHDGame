import {
  MODEL_ARCHETYPES,
  ECONOMIC_MODEL_IDS,
  AFFINITY_WEIGHTS,
  PRIMARY_WEIGHT,
  SECONDARY_WEIGHT,
  SCORE_INERTIA,
  STATE_CAPITALIST_OWNERSHIP_THRESHOLD,
  type EconomicModelId,
  type EconomicModelArchetype,
} from "@/lib/constants/economicModels";

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

export interface ModelSignals {
  sector: number;
  spend: number;
  law: number;
}

/**
 * Sector signal — GRADED weighted-share (decision 2026-06-14). Normalizes by the
 * MAX achievable weighted sum (`PRIMARY_WEIGHT · totalRevenue`) so the signal
 * stays resolved across [0,1] instead of pegging at 1 for any clear primary.
 */
export function sectorSignal(
  a: EconomicModelArchetype,
  revenueByType: Record<string, number>,
  totalRevenue: number
): number {
  if (!a.primarySector || totalRevenue <= 0) return 0;
  const primaryRev = revenueByType[a.primarySector] ?? 0;
  const secRev = a.secondarySectors.reduce((s, t) => s + (revenueByType[t] ?? 0), 0);
  const weighted = PRIMARY_WEIGHT * primaryRev + SECONDARY_WEIGHT * secRev;
  return clamp01(weighted / (PRIMARY_WEIGHT * totalRevenue));
}

/** Spending signal — normalized weighted overlap of the budget mix with the
 *  model's spending signature. 0 when the model has no signature (no /0). */
export function spendSignal(
  a: EconomicModelArchetype,
  spendingShare: Record<string, number>
): number {
  const keys = Object.keys(a.spendingSignature);
  const sigTotal = keys.reduce((s, k) => s + a.spendingSignature[k]!, 0);
  if (sigTotal <= 0) return 0;
  const overlap = keys.reduce((s, k) => s + (spendingShare[k] ?? 0) * a.spendingSignature[k]!, 0);
  return clamp01(overlap / sigTotal);
}

/** Law signal — active fraction of the model's flagship laws. */
export function lawSignal(a: EconomicModelArchetype, activeLawTags: Set<string>): number {
  if (a.lawSignature.length === 0) return 0;
  const active = a.lawSignature.filter((t) => activeLawTags.has(t)).length;
  return active / a.lawSignature.length;
}

/** Blended 0–1 affinity (D6: 0.4 sector + 0.4 spend + 0.2 law). */
export function affinity(s: ModelSignals): number {
  return (
    AFFINITY_WEIGHTS.sector * s.sector +
    AFFINITY_WEIGHTS.spend * s.spend +
    AFFINITY_WEIGHTS.law * s.law
  );
}

/** Slow drift toward 100·affinity (shares the metric-engine simBaseline EMA shape). */
export function driftScore(prevScore: number, affinity01: number, inertia = SCORE_INERTIA): number {
  return inertia * prevScore + (1 - inertia) * (100 * affinity01);
}

export interface ClassifyInput {
  revenueByType: Record<string, number>;
  totalRevenue: number;
  spendingShare: Record<string, number>;
  activeLawTags: Set<string>;
  /**
   * Share (0–1) of the scope's corporate sectors owned by National Corporations.
   * The State-Capitalist activation lever: at ≥ STATE_CAPITALIST_OWNERSHIP_THRESHOLD
   * it drives that model's affinity (overriding its generic signal). Absent → 0.
   */
  stateOwnershipShare?: number;
}

export interface ClassifyResult {
  scores: Record<EconomicModelId, number>;
  signals: Record<EconomicModelId, ModelSignals>;
  affinities: Record<EconomicModelId, number>;
  leader: EconomicModelId;
  intensity: number;
}

/**
 * Per-turn classification: drift each non-mixed model's score toward its blended
 * affinity, pick the leader, and report intensity (= leader's score). `mixed` is
 * excluded from scoring (it is the §5.5 hysteresis residual when the leader is
 * below the dominance floor). Cold start (no prev score) seeds the score at
 * 100·affinity so turn 0 reflects the affinity with no drift lag.
 */
export function classify(
  prevScores: Partial<Record<EconomicModelId, number>>,
  input: ClassifyInput
): ClassifyResult {
  const scores = {} as Record<EconomicModelId, number>;
  const signals = {} as Record<EconomicModelId, ModelSignals>;
  const affinities = {} as Record<EconomicModelId, number>;

  for (const id of ECONOMIC_MODEL_IDS) {
    if (id === "mixed") {
      signals[id] = { sector: 0, spend: 0, law: 0 };
      affinities[id] = 0;
      scores[id] = 0;
      continue;
    }
    const a = MODEL_ARCHETYPES[id];
    const s: ModelSignals = {
      sector: sectorSignal(a, input.revenueByType, input.totalRevenue),
      spend: spendSignal(a, input.spendingShare),
      law: lawSignal(a, input.activeLawTags),
    };
    let aff = affinity(s);
    // State-Capitalist lever: high state (National-Corporation) ownership of the
    // economy's sectors IS the command-economy signal, overriding the weak energy
    // sector signal once it clears the threshold.
    if (id === "stateCapitalist") {
      const share = input.stateOwnershipShare ?? 0;
      if (share >= STATE_CAPITALIST_OWNERSHIP_THRESHOLD) aff = Math.max(aff, share);
    }
    const prev = prevScores[id] ?? 100 * aff; // cold start = affinity score
    signals[id] = s;
    affinities[id] = aff;
    scores[id] = clamp(driftScore(prev, aff), 0, 100);
  }

  let leader: EconomicModelId = "militaryIndustrial";
  let best = -Infinity;
  for (const id of ECONOMIC_MODEL_IDS) {
    if (id === "mixed") continue;
    if (scores[id] > best) {
      best = scores[id];
      leader = id;
    }
  }

  return { scores, signals, affinities, leader, intensity: clamp(scores[leader], 0, 100) };
}
