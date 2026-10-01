/**
 * Russian presidential registration freezes the registered voting-age electorate.
 * russianPresidentialRegisteredVoters applies the existing general-election
 * registration gate to each region, using the same population fallback for old saves.
 */
import { scalePoolToRegistered } from "@/lib/electionEngine/rules/registration";
export function russianPresidentialRegisteredVoters(
  regions: readonly { id: string; population: number; votingEligiblePopulation?: number }[],
  unregisteredByRegion: Readonly<Record<string, number | undefined>>
): number {
  if (!regions.length || new Set(regions.map((region) => region.id)).size !== regions.length)
    throw new Error("Russian presidential electorate is missing or duplicated");
  let registered = 0;
  for (const region of regions) {
    const eligible = region.votingEligiblePopulation ?? region.population;
    if (!Number.isFinite(eligible) || eligible < 0)
      throw new Error("Invalid Russian regional electorate");
    const voters = Math.floor(scalePoolToRegistered(eligible, unregisteredByRegion[region.id]));
    if (!Number.isSafeInteger(voters) || !Number.isSafeInteger(registered + voters))
      throw new Error("Russian presidential electorate exceeds supported precision");
    registered += voters;
  }
  if (registered < 1) throw new Error("Russian presidential electorate is empty");
  return registered;
}
