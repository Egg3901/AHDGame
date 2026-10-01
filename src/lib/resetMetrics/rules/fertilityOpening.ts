import { birthRateIndexToTFR } from "@/lib/demographics/flows/fertility";

export interface OpeningFertilitySeed {
  regionId: string;
  population: number;
  legacyBirthRateIndex: number;
}

export interface RebasingFertilitySeed extends OpeningFertilitySeed {
  openingTfr: number;
  openingBirthRateIndex: number;
}

export interface OpeningFertilityRebase {
  targetNationalTfr: number;
  originalNationalTfr: number;
  multiplier: number;
  regions: RebasingFertilitySeed[];
}

function tfrToBirthRateIndex(tfr: number, replacementTfr: number): number {
  const ratio = tfr / replacementTfr;
  return ratio <= 1 ? ((ratio - 0.4) / 0.6) * 50 : 50 + ((ratio - 1) / 2.4) * 50;
}

/**
 * Rebase only the reset's opening observations to official country-level TFR.
 * The proportionate adjustment keeps within-country regional differences and
 * does not mutate the live v1 birth-rate index or cohort stock.
 */
export function rebaseOpeningFertility(
  seeds: readonly OpeningFertilitySeed[],
  targetNationalTfr: number,
  replacementTfr = 2.06
): OpeningFertilityRebase {
  if (!Number.isFinite(targetNationalTfr) || targetNationalTfr <= 0) {
    throw new Error("target national TFR must be positive and finite");
  }
  if (!Number.isFinite(replacementTfr) || replacementTfr <= 0 || seeds.length === 0) {
    throw new Error("opening fertility requires a replacement anchor and regions");
  }
  const ids = new Set<string>();
  let population = 0;
  let weightedTfr = 0;
  for (const seed of seeds) {
    if (
      !seed.regionId ||
      ids.has(seed.regionId) ||
      !Number.isFinite(seed.population) ||
      seed.population <= 0 ||
      !Number.isFinite(seed.legacyBirthRateIndex) ||
      seed.legacyBirthRateIndex < 0 ||
      seed.legacyBirthRateIndex > 100
    ) {
      throw new Error(`invalid opening fertility seed ${seed.regionId}`);
    }
    ids.add(seed.regionId);
    population += seed.population;
    weightedTfr += seed.population * birthRateIndexToTFR(seed.legacyBirthRateIndex, replacementTfr);
  }
  const originalNationalTfr = weightedTfr / population;
  const multiplier = targetNationalTfr / originalNationalTfr;
  const regions = seeds.map((seed): RebasingFertilitySeed => {
    const openingTfr = birthRateIndexToTFR(seed.legacyBirthRateIndex, replacementTfr) * multiplier;
    const openingBirthRateIndex = tfrToBirthRateIndex(openingTfr, replacementTfr);
    if (openingBirthRateIndex < 0 || openingBirthRateIndex > 100) {
      throw new Error(`1991 fertility target exceeds index range for ${seed.regionId}`);
    }
    return { ...seed, openingTfr, openingBirthRateIndex };
  });
  return { targetNationalTfr, originalNationalTfr, multiplier, regions };
}
