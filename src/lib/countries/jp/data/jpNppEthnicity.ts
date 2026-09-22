import type { NPPEthnicity } from "@/lib/db/types";

/**
 * Ethnic mix used when generating Japanese non-player politicians.
 *
 * Moved out of `src/lib/npp/generator.ts`, which now forwards to this. Values
 * unchanged.
 *
 * ⚠ A DRAW TABLE, NOT A CENSUS. These weights pick a portrait and a name
 * register for a generated politician, so they describe the Diet's visible
 * composition rather than the population's. The zero entries are kept rather
 * than omitted so the full vocabulary stays visible: a missing key and a zero
 * weight behave identically in the draw, but only one of them says the omission
 * was deliberate.
 */
export const JP_ETHNICITY_WEIGHTS: Array<[NPPEthnicity, number]> = [
  ["asian", 97],
  ["other", 2],
  ["white", 1],
  ["black", 0],
  ["hispanic", 0],
];
