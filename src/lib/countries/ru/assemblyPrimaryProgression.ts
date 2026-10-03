/**
 * Assembly registration preserves nominees on bound Duma lists and Council subjects.
 * russianAssemblyPrimaryAdvanceLimit serializes persisted ballot identities once
 * for the shared portable rules used by the turn resolver and candidate display.
 */
import type { Election } from "@/lib/db/types";
import { russianDumaPrimaryAdvanceLimit } from "./rules/assemblyScope";
import { russianCouncilPrimaryAdvanceLimit } from "./rules/councilScope";
export function russianAssemblyPrimaryAdvanceLimit(
  election: Pick<
    Election,
    | "countryId"
    | "electionType"
    | "state"
    | "seatId"
    | "totalSeats"
    | "russianDumaRound"
    | "russianCouncilRound"
  >,
  registeredCandidates: number
): number | null {
  const scope = {
    countryId: election.countryId ?? "US",
    electionType: election.electionType,
    state: election.state,
    seatId: election.seatId,
    totalSeats: election.totalSeats,
    russianDumaRound: election.russianDumaRound
      ? { ...election.russianDumaRound, cohortId: election.russianDumaRound.cohortId.toHexString() }
      : undefined,
    russianCouncilRound: election.russianCouncilRound
      ? {
          ...election.russianCouncilRound,
          cohortId: election.russianCouncilRound.cohortId.toHexString(),
        }
      : undefined,
  };
  return (
    russianDumaPrimaryAdvanceLimit(scope, registeredCandidates) ??
    russianCouncilPrimaryAdvanceLimit(scope, registeredCandidates)
  );
}
