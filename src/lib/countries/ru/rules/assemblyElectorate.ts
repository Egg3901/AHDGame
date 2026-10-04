/**
 * Russian Duma registration freezes the same regional voter pools as general elections.
 * freezeRussianDumaElectorate validates regional identities and voter precision;
 * planRussianDumaDistricts then divides those voters between individual seats.
 */
import { scalePoolToRegistered } from "@/lib/electionEngine/rules/registration";
import { planRussianDumaDistricts } from "./assemblyDistricts";

export function freezeRussianDumaElectorate(
  regions: readonly { id: string; population: number; votingEligiblePopulation?: number }[],
  unregisteredByRegion: Readonly<Record<string, number | undefined>>
): Record<string, number> {
  if (new Set(regions.map((row) => row.id)).size !== regions.length)
    throw new Error("Russian Duma registration has duplicate regions");
  const register = Object.fromEntries(
    regions.map((row) => {
      const eligible = row.votingEligiblePopulation ?? row.population;
      if (!Number.isFinite(eligible) || eligible < 0)
        throw new Error("Invalid Russian Duma regional electorate");
      return [row.id, Math.floor(scalePoolToRegistered(eligible, unregisteredByRegion[row.id]))];
    })
  );
  // The district plan validates the complete post-Soviet map and safe totals.
  planRussianDumaDistricts(register);
  return register;
}
