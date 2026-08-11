/**
 * Popular-mood axis weights describe what the public of a country
 * values. Mirrors the shape of `RulingPartyPriorityProfile` (which
 * describes what the ruling party values), but answers a different
 * question: how does public sentiment respond to enacted policy?
 *
 * Each axis weight is in -1..1. Per-turn drift = sum across axes of
 * (axis weight) × (axis delta from enacted bill), scaled by the
 * driver-side coefficient.
 *
 * Tuned per the design doc's slow-buildup principle: a single enacted
 * bill should saturate the per-turn popular-policy cap (~±0.8) only
 * when it pushes hard on every weighted axis. Most turns enact 0-1
 * bills so the policy driver lands near zero.
 */

export const POPULAR_MOOD_AXES = [
  "economicProsperity",
  "civilLiberties",
  "anticorruption",
  "publicServices",
  "nationalism",
  "culturalTradition",
  "internationalStanding",
  "environmentalProtection",
  "lawAndOrder",
] as const;

export type PopularMoodAxis = (typeof POPULAR_MOOD_AXES)[number];

export type PopularMoodAxisProfile = Record<PopularMoodAxis, number>;

/**
 * CN-specific profile. Authored from the design doc's directional
 * proposal: prosperity / liberties / anti-corruption weighted highest;
 * cultural tradition moderate; nationalism positive but small.
 *
 * Conservative tuning to start; revisit in Phase 8 if E2E sims show
 * the scalar moves too fast or too slow.
 */
export const CN_POPULAR_MOOD_PROFILE: PopularMoodAxisProfile = {
  economicProsperity: 0.9,
  civilLiberties: 0.7,
  anticorruption: 0.8,
  publicServices: 0.5,
  nationalism: 0.3,
  culturalTradition: 0.4,
  internationalStanding: 0.3,
  environmentalProtection: 0.2,
  lawAndOrder: 0.5,
};
