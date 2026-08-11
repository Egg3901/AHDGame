import {
  calculateFavorabilityAboveThresholdPenalty,
  calculatePoliticalInfluenceDecay,
} from "@shared/constants/formulas";

/** 5% per-turn infamy decay rate. Mirrors the turn processor's infamy decay in policyEffects. */
export const INFAMY_DECAY_RATE = 0.05;

export interface DecayProjection {
  current: number;
  decayAmount: number;
  projected: number;
  isDecaying: boolean;
}

export function projectInfluenceDecay(pi: number): DecayProjection {
  const decayAmount = calculatePoliticalInfluenceDecay(pi);
  return {
    current: pi,
    decayAmount: Math.round(decayAmount * 100) / 100,
    projected: Math.round(Math.max(0, pi - decayAmount) * 100) / 100,
    isDecaying: decayAmount > 0.01,
  };
}

export function projectFavorabilityDecay(fav: number): DecayProjection {
  const decayAmount = calculateFavorabilityAboveThresholdPenalty(fav);
  return {
    current: fav,
    decayAmount: Math.round(decayAmount * 100) / 100,
    projected: Math.round(Math.max(0, fav - decayAmount) * 100) / 100,
    isDecaying: decayAmount > 0.01,
  };
}

export function projectInfamyDecay(infamy: number): DecayProjection {
  const decayAmount = infamy * INFAMY_DECAY_RATE;
  return {
    current: infamy,
    decayAmount: Math.round(decayAmount * 100) / 100,
    projected: Math.round(Math.max(0, infamy - decayAmount) * 100) / 100,
    isDecaying: decayAmount > 0.01,
  };
}
