import type { RussianAssemblySeatingNominee } from "../rules/assemblySeating";
import { planRussianDumaDistricts } from "../rules/assemblyDistricts";
import { RU_1991_ECONOMIC_REGION_POPULATION } from "../data/ruPopulation1991";
import { RUSSIAN_COUNCIL_SUBJECTS_1993 } from "../data/councilSubjects1993";
import type { RussianDumaCohortBallot } from "../rules/assemblyCohort";
import type { RussianCouncilCohortBallot } from "../rules/councilCohort";
export function russianAssemblySeatingScenario() {
  const registers = Object.fromEntries(
    Object.keys(RU_1991_ECONOMIC_REGION_POPULATION).map((id) => [id, 1000000])
  );
  const districts = planRussianDumaDistricts(registers);
  const dumaBallots: RussianDumaCohortBallot[] = districts.map((row, index) => ({
    id: `duma-${index}`,
    seatId: row.seatId,
    regionId: row.regionId,
    tier: "constituency",
    registeredVoters: row.registeredVoters,
    againstAllVotes: 0,
    candidates: [0, 1].map((order) => ({
      id: `duma-${index}-${order}`,
      ownerId: `duma-profile-${order}`,
      party: String(order + 1),
      isNpc: true,
      capacity: 1,
      eligible: true,
      registrationOrder: order,
      nominationOrder: order,
      votes:
        order === 0
          ? Math.ceil(row.registeredVoters * 0.6)
          : Math.floor(row.registeredVoters * 0.4),
    })),
  }));
  const national = Object.values(registers).reduce((sum, row) => sum + row, 0);
  dumaBallots.push({
    id: "national",
    seatId: "RU-duma-national-list",
    regionId: "RU",
    tier: "list",
    registeredVoters: national,
    againstAllVotes: 0,
    candidates: [0, 1, 2].map((order) => ({
      id: `list-${order}`,
      ownerId: `duma-profile-${order}`,
      party: String(order + 1),
      isNpc: true,
      capacity: 75,
      eligible: true,
      registrationOrder: order,
      nominationOrder: order,
      votes: Math.floor(national / 3),
    })),
  });
  const councilBallots: RussianCouncilCohortBallot[] = RUSSIAN_COUNCIL_SUBJECTS_1993.map(
    ([number, , regionId]) => ({
      id: `council-${number}`,
      seatId: `RU-council-${number}`,
      regionId,
      registeredVoters: 1000,
      validBallots: 1000,
      againstAllVotes: 0,
      candidates: [0, 1, 2].map((order) => ({
        id: `council-${number}-${order}`,
        ownerId: `council-profile-${order}`,
        party: String(order + 1),
        isNpc: true,
        eligible: true,
        registrationOrder: order,
        votes: [600, 500, 400][order],
      })),
    })
  );
  function nominees(
    ballots: readonly (RussianDumaCohortBallot | RussianCouncilCohortBallot)[]
  ): RussianAssemblySeatingNominee[] {
    return ballots.flatMap((ballot) =>
      ballot.candidates.map((candidate) => ({
        candidateId: candidate.id,
        ownerId: candidate.ownerId,
        isNpc: candidate.isNpc,
        name: `Nominee ${candidate.id}`,
        party: candidate.party,
      }))
    );
  }
  return {
    duma: { ballots: dumaBallots, nominees: nominees(dumaBallots) },
    council: { ballots: councilBallots, nominees: nominees(councilBallots) },
  };
}
