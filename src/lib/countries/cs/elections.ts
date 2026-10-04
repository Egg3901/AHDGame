import type { CountryElections } from "../contract";
import type { CountryElectionPhaseEntry } from "@/lib/turn/countryPhases";
import {
  easternBlocElectionsLive,
  ensureEasternBlocAssemblyElections,
  ensureRegionalDelegateElections,
  seatsFromRegionField,
} from "@/lib/turn/perpetualElections/shared";

/** Czechoslovakia Chamber of the People. */
export async function ensureCSElections(now: Date, inFlightTurn?: number): Promise<void> {
  await ensureEasternBlocAssemblyElections(
    "CS",
    "chamberOfThePeople",
    "Chamber of the People",
    now,
    inFlightTurn
  );
}

/** The 1991 federal Chamber of Nations, apportioned 75/75 by republic. */
export async function ensureCSNationsElections(now: Date, inFlightTurn?: number): Promise<void> {
  await ensureRegionalDelegateElections(
    {
      countryId: "CS",
      electionType: "chamberOfNations",
      seatsForRegions: (regions) => seatsFromRegionField(regions, "stateSenateSeats"),
      openPrimaryImmediately: true,
      statusGated: true,
      electionsLiveGate: easternBlocElectionsLive,
      label: "Chamber of Nations",
    },
    now,
    inFlightTurn
  );
}

/**
 * Czechoslovakia's elections.
 *
 * ⚠️ SERVER ONLY. The spawners reach `getDb`.
 *
 * ⚠️ NO `spawn`. Czechoslovakia has no row in
 * `SPAWN_ELECTIONS_REGISTRY`; these phases run through
 * `COUNTRY_ELECTION_PHASES`, in this order. Adding a `spawn` would run them a
 * second time each turn. The CS spawners live here and use the shared election
 * helpers without moving the other countries' phases.
 *
 * ⚠️ NO `seats`. There is no seat table for Czechoslovakia anywhere;
 * apportionment is read from the live regions, the way East Germany's
 * Volkskammer and Brazil's Senate are. An empty `byChamber` would describe a
 * chamber with no seats rather than one whose seats live elsewhere.
 */
const phases: CountryElectionPhaseEntry[] = [
  { name: "csChamberOfThePeopleElections", fn: ensureCSElections },
  { name: "csChamberOfNationsElections", fn: ensureCSNationsElections },
];

export const CS_ELECTIONS: CountryElections = {
  electionPhases: phases,
};
