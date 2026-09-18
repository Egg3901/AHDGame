import type { CountryElections } from "../contract";
import type { CountryElectionPhaseEntry } from "@/lib/turn/countryPhases";
import {
  ensureDDGovernorElections,
  ensureDDLandAssemblyElections,
  ensureDDVolkskammerElections,
} from "./elections/perpetual";

/**
 * East Germany's elections.
 *
 * ⚠️ SERVER ONLY. The spawners reach `getDb`.
 *
 * ⚠️ NO `spawn` AND NO `seats`, AND BOTH ABSENCES ARE REAL.
 *
 * There is no `SPAWN_ELECTIONS_REGISTRY` row: the three spawners run as
 * ELECTION PHASES through `COUNTRY_ELECTION_PHASES`, and the Land assemblies
 * must spawn before the governors so the First Secretary queue has legislature
 * NPPs to sponsor through. Adding a `spawn` would run them a second time each
 * turn, in the wrong order.
 *
 * There is no seat table either, anywhere. `ensureDDVolkskammerElections` calls
 * `seatsFromRegionField(regions, "houseDistricts")` and the Land assemblies use
 * `stateSenateSeats`, so apportionment is read from the live regions every turn.
 * An empty `byChamber` here would describe a chamber with no seats rather than a
 * chamber whose seats live somewhere else.
 */
const phases: CountryElectionPhaseEntry[] = [
  { name: "ddVolkskammerElections", fn: ensureDDVolkskammerElections },
  { name: "ddLandAssemblyElections", fn: ensureDDLandAssemblyElections },
  { name: "ddGovernorElections", fn: ensureDDGovernorElections },
];

export const DD_ELECTIONS: CountryElections = {
  electionPhases: phases,
};

export { ensureDDGovernorElections, ensureDDLandAssemblyElections, ensureDDVolkskammerElections };
