/**
 * Nationwide ballots aggregate regional electorates once per country and turn.
 * nationwideBallotCountries identifies the shared preload scope;
 * bindBallotElectorate applies Russia's frozen registers to each ballot separately.
 */
import type { Election } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import type { AccumulateVoteTurnPreload } from "./types";
import { isNationwideDirectExecutiveElection } from "@/lib/elections/nationwideExecutive";
import { bindRussianPresidentialElectorate } from "@/lib/countries/ru/presidentialElectoratePreload";
import {
  bindRussianDumaElectorate,
  usesRussianDumaNationalElectorate,
} from "@/lib/countries/ru/dumaElectoratePreload";

export function nationwideBallotCountries(elections: readonly Election[]): CountryId[] {
  return [
    ...new Set(
      elections
        .filter(
          (election) =>
            isNationwideDirectExecutiveElection(
              election.electionType,
              election.state,
              (election.countryId ?? "US") as CountryId
            ) || usesRussianDumaNationalElectorate(election)
        )
        .map((election) => (election.countryId ?? "US") as CountryId)
    ),
  ];
}

export function bindBallotElectorate(
  election: Election,
  preload: AccumulateVoteTurnPreload
): AccumulateVoteTurnPreload {
  return bindRussianDumaElectorate(election, bindRussianPresidentialElectorate(election, preload));
}
