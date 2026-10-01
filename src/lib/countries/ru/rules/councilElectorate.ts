/**
 * Council electorates divide each current macroregional register among its subjects.
 * freezeRussianCouncilElectorate uses historical population weights with exact
 * remainders, preserving every registered voter and excluding nested double counts.
 */
import { freezeRussianDumaElectorate } from "./assemblyElectorate";
import { RUSSIAN_COUNCIL_SUBJECTS_1993 } from "../data/councilSubjects1993";
import { RUSSIAN_COUNCIL_POPULATION_WEIGHTS_1991 } from "../data/councilPopulation1991";
import { planRussianCouncilDistricts } from "./councilDistricts";

export function freezeRussianCouncilElectorate(
  regions: Parameters<typeof freezeRussianDumaElectorate>[0],
  unregisteredByRegion: Parameters<typeof freezeRussianDumaElectorate>[1]
): Record<string, number> {
  const regional = freezeRussianDumaElectorate(regions, unregisteredByRegion);
  const result: Record<string, number> = {};
  for (const [regionId, registered] of Object.entries(regional)) {
    const subjects = RUSSIAN_COUNCIL_SUBJECTS_1993.filter((row) => row[2] === regionId);
    const totalWeight = subjects.reduce(
      (sum, [number]) =>
        sum + BigInt(RUSSIAN_COUNCIL_POPULATION_WEIGHTS_1991[`RU-council-${number}`]),
      BigInt(0)
    );
    const allocations = subjects.map(([number]) => {
      const id = `RU-council-${number}`;
      const weighted = BigInt(registered) * BigInt(RUSSIAN_COUNCIL_POPULATION_WEIGHTS_1991[id]);
      return { id, number, voters: weighted / totalWeight, remainder: weighted % totalWeight };
    });
    const unallocated =
      BigInt(registered) - allocations.reduce((sum, row) => sum + row.voters, BigInt(0));
    allocations.sort((a, b) =>
      a.remainder === b.remainder ? a.number - b.number : a.remainder > b.remainder ? -1 : 1
    );
    for (const [index, row] of allocations.entries()) {
      result[row.id] = Number(row.voters + (BigInt(index) < unallocated ? BigInt(1) : BigInt(0)));
    }
  }
  planRussianCouncilDistricts(result);
  return result;
}
