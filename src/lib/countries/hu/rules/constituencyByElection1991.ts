/**
 * Hungarian constituency by-elections fill vacant individual mandates only.
 * Their new ballots use ordinary majority and runoff rules; national and
 * territorial awards stay frozen for the original Assembly term.
 */
import { HU_1991_CONSTITUENCIES } from "../data/electoralDistricts1991";
import { countHu1991Constituency, type Hu1991ConstituencyRound } from "./constituency1991";
export interface Hu1991ByElectionBallot {
  id: string;
  first: Hu1991ConstituencyRound;
  second?: Hu1991ConstituencyRound;
}
export type Hu1991ByElectionCount =
  | { kind: "pending"; runoffs: Record<string, string[]> }
  | { kind: "counted"; winners: Record<string, string | null>; vacancies: string[] };
export function countHu1991ByElection(
  vacantDistrictIds: readonly string[],
  ballots: readonly Hu1991ByElectionBallot[]
): Hu1991ByElectionCount {
  const known = new Set(HU_1991_CONSTITUENCIES.map((row) => row.id));
  const vacancies = new Set(vacantDistrictIds);
  if (
    !vacancies.size ||
    vacancies.size !== vacantDistrictIds.length ||
    vacantDistrictIds.some((id) => !known.has(id)) ||
    ballots.length !== vacancies.size ||
    new Set(ballots.map((row) => row.id)).size !== ballots.length ||
    ballots.some((row) => !vacancies.has(row.id))
  )
    throw new Error("Hungarian by-election must cover only its frozen vacant constituencies");
  const winners: Record<string, string | null> = {},
    runoffs: Record<string, string[]> = {};
  const vacant: string[] = [],
    firstPeople = new Set<string>(),
    winningPeople = new Set<string>();
  for (const ballot of [...ballots].sort((a, b) => a.id.localeCompare(b.id))) {
    for (const person of ballot.first.candidates) {
      if (firstPeople.has(person.candidateId))
        throw new Error("Hungarian by-election duplicates a person");
      firstPeople.add(person.candidateId);
    }
    const count = countHu1991Constituency(ballot.first, ballot.second);
    if (count.kind === "runoff") {
      runoffs[ballot.id] = count.candidateIds;
      continue;
    }
    if (count.winnerId) {
      if (winningPeople.has(count.winnerId))
        throw new Error("Hungarian by-election gives a person two mandates");
      winningPeople.add(count.winnerId);
    } else vacant.push(ballot.id);
    winners[ballot.id] = count.winnerId;
  }
  return Object.keys(runoffs).length
    ? { kind: "pending", runoffs }
    : { kind: "counted", winners, vacancies: vacant };
}
