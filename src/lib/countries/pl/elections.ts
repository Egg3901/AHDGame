import type { CountryElections } from "../contract";
import type { CountryElectionPhaseEntry } from "@/lib/turn/countryPhases";
import {
  easternBlocElectionsLive,
  ensureEasternBlocAssemblyElections,
  ensureRegionalDelegateElections,
  seatsFromRegionField,
} from "@/lib/turn/perpetualElections/shared";

/** Poland Sejm, using the regional delegate pattern in both eras. */
export async function ensurePLElections(now: Date, inFlightTurn?: number): Promise<void> {
  await ensureEasternBlocAssemblyElections("PL", "sejm", "Sejm", now, inFlightTurn);
}

/** Poland's restored Senate, elected with the Sejm using region seat totals. */
export async function ensurePLSenateElections(now: Date, inFlightTurn?: number): Promise<void> {
  await ensureRegionalDelegateElections(
    {
      countryId: "PL",
      electionType: "senat",
      seatsForRegions: (regions) => seatsFromRegionField(regions, "stateSenateSeats"),
      openPrimaryImmediately: true,
      statusGated: true,
      electionsLiveGate: easternBlocElectionsLive,
      label: "Senate",
    },
    now,
    inFlightTurn
  );
}

/**
 * Poland's elections.
 *
 * ⚠️ SERVER ONLY. The spawners reach `getDb`.
 *
 * ⚠️ NO `spawn`. Poland has no row in
 * `SPAWN_ELECTIONS_REGISTRY`; these phases run through
 * `COUNTRY_ELECTION_PHASES`, in this order. Adding a `spawn` would run them a
 * second time each turn. The Polish spawners live here and use shared election
 * helpers without moving the other countries' phases.
 *
 * ⚠️ NO `seats`. There is no seat table for Poland anywhere;
 * apportionment is read from the live regions, the way East Germany's
 * Volkskammer and Brazil's Senate are. An empty `byChamber` would describe a
 * chamber with no seats rather than one whose seats live elsewhere.
 */
const phases: CountryElectionPhaseEntry[] = [
  { name: "plSejmElections", fn: ensurePLElections },
  { name: "plSenateElections", fn: ensurePLSenateElections },
];

export const PL_ELECTIONS: CountryElections = {
  electionPhases: phases,
};
