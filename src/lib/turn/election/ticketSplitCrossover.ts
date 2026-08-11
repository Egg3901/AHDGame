/**
 * Ticket-split crossover layer: derive Zweitstimmen (second votes) from Erststimmen (first votes).
 *
 * Models the well-documented German voting behavior where voters split their ballot:
 * - Erststimme (first vote): local candidate (often major party pragmatism)
 * - Zweitstimme (second vote): policy preference (often smaller party, tactical, or protest)
 *
 * Rates by demographic archetype reflect ideological distances and strategic voting patterns.
 */

export interface ArchetypeCrossoverRate {
  fromParty: string; // e.g., "cdu"
  toParty: string; // e.g., "greens"
  rate: number; // 0.00–0.30: fraction of votes that switch
}

/**
 * Default ticket-split rates by demographic archetype.
 * Maps archetype ID → list of crossover rules.
 *
 * Rates are derived from post-election surveys and historical splitting patterns.
 */
export const DEFAULT_CROSSOVER_RATES: Record<string, ArchetypeCrossoverRate[]> = {
  // German demographic archetypes (placeholder names; actual will come from seed)
  urban_professionals: [
    { fromParty: "cdu", toParty: "greens", rate: 0.12 }, // Tech/edu leans Greens
    { fromParty: "cdu", toParty: "spd", rate: 0.08 },
    { fromParty: "spd", toParty: "greens", rate: 0.15 },
  ],
  working_class: [
    { fromParty: "spd", toParty: "linke", rate: 0.1 }, // Left sympathizers
    { fromParty: "cdu", toParty: "afd", rate: 0.08 },
  ],
  rural_traditional: [
    { fromParty: "cdu", toParty: "fdp", rate: 0.06 }, // Liberal economics
    { fromParty: "cdu", toParty: "afd", rate: 0.12 },
  ],
  progressive_urban: [
    { fromParty: "spd", toParty: "greens", rate: 0.18 },
    { fromParty: "greens", toParty: "spd", rate: 0.05 },
  ],
  tactical_voters: [
    { fromParty: "spd", toParty: "greens", rate: 0.25 }, // Backs SPD locally, Greens federally
    { fromParty: "greens", toParty: "spd", rate: 0.2 },
  ],
};

export interface ErststimmeInput {
  partyId: string;
  votes: number;
  byArchetype?: Record<string, number>; // Demographics that voted for this party
}

export interface ZweitstimmeOutput {
  partyId: string;
  votes: number;
  byArchetype?: Record<string, number>;
}

/**
 * Derives Zweitstimmen (second votes) from Erststimmen (first votes) using crossover rates.
 *
 * Algorithm:
 * 1. For each party, start with its Erststimmen as the base
 * 2. For each archetype split within that base, apply crossover rules
 * 3. Redistribute votes to target parties according to crossover rates
 * 4. Accumulate into final Zweitstimmen per party
 *
 * @param erststimmen - Array of { partyId, votes, byArchetype? }
 * @param crossoverRates - Optional override for DEFAULT_CROSSOVER_RATES
 * @returns Array of { partyId, votes, byArchetype? }
 */
export function deriveZweitstimmen(
  erststimmen: ErststimmeInput[],
  crossoverRates: Record<string, ArchetypeCrossoverRate[]> = DEFAULT_CROSSOVER_RATES
): ZweitstimmeOutput[] {
  // Accumulate Zweitstimmen by party
  const zweitstimmen: Record<string, number> = {};
  const zweiByleadertype: Record<string, Record<string, number>> = {};

  // Initialize
  for (const e of erststimmen) {
    zweitstimmen[e.partyId] = 0;
    zweiByleadertype[e.partyId] = {};
  }

  // Process each party's Erststimmen
  for (const erststimme of erststimmen) {
    const { partyId: fromParty, votes: totalVotes, byArchetype = {} } = erststimme;

    // If no archetype breakdown, assume votes are distributed equally
    const archetypeVotes =
      Object.keys(byArchetype).length > 0 ? byArchetype : { _default: totalVotes };

    for (const [archetypeId, archVotes] of Object.entries(archetypeVotes)) {
      if (archVotes === 0) continue;

      // Find crossover rules for this archetype
      const archetypeRules = crossoverRates[archetypeId] ?? [];

      // Rules matching this fromParty
      const applicableRules = archetypeRules.filter((r) => r.fromParty === fromParty);

      // Compute total crossover rate
      let totalCrossover = 0;
      const targetAllocations: Record<string, number> = {};

      for (const rule of applicableRules) {
        targetAllocations[rule.toParty] = rule.rate;
        totalCrossover += rule.rate;
      }

      // Clamp total crossover to [0, 1]
      if (totalCrossover > 1) {
        const scale = 1 / totalCrossover;
        for (const party of Object.keys(targetAllocations)) {
          targetAllocations[party] *= scale;
        }
        totalCrossover = 1;
      }

      // Remaining votes stay with the original party
      const stayRate = 1 - totalCrossover;

      // Allocate
      zweitstimmen[fromParty] += archVotes * stayRate;
      zweiByleadertype[fromParty][archetypeId] =
        (zweiByleadertype[fromParty][archetypeId] ?? 0) + archVotes * stayRate;

      for (const [toParty, rate] of Object.entries(targetAllocations)) {
        zweitstimmen[toParty] = (zweitstimmen[toParty] ?? 0) + archVotes * rate;
        zweiByleadertype[toParty] = zweiByleadertype[toParty] ?? {};
        zweiByleadertype[toParty][archetypeId] =
          (zweiByleadertype[toParty][archetypeId] ?? 0) + archVotes * rate;
      }
    }
  }

  // Convert to output format
  return Object.entries(zweitstimmen).map(([partyId, votes]) => ({
    partyId,
    votes: Math.round(votes), // Round to nearest integer
    byArchetype: zweiByleadertype[partyId],
  }));
}

/**
 * Validates that Zweitstimmen sum to approximately the same total as Erststimmen.
 * Allows for rounding error (±1 vote per 100k).
 */
export function validateZweitstimmenSum(
  erststimmen: ErststimmeInput[],
  zweitstimmen: ZweitstimmeOutput[],
  tolerance: number = 0.01 // 1% tolerance
): boolean {
  const erstsumme = erststimmen.reduce((s, e) => s + e.votes, 0);
  const zweisumme = zweitstimmen.reduce((s, z) => s + z.votes, 0);
  const error = Math.abs(erstsumme - zweisumme) / erstsumme;
  return error <= tolerance;
}
