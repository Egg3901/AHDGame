import type { CountryElections } from "../contract";
import type { CountryElectionPhaseEntry } from "@/lib/turn/countryPhases";
import { ensurePLElections } from "@/lib/turn/perpetualElections";

/**
 * Poland's elections.
 *
 * ⚠️ SERVER ONLY. The spawners reach `getDb`.
 *
 * ⚠️ NO `spawn`, AND NOTHING RELOCATED. Poland has no row in
 * `SPAWN_ELECTIONS_REGISTRY`; these phases run through
 * `COUNTRY_ELECTION_PHASES`, in this order. Adding a `spawn` would run them a
 * second time each turn. The spawner functions stay where they are because their
 * files are shared between countries -- moving one into this folder would take
 * the others' elections with it.
 *
 * ⚠️ NO `seats`. There is no seat table for Poland anywhere;
 * apportionment is read from the live regions, the way East Germany's
 * Volkskammer and Brazil's Senate are. An empty `byChamber` would describe a
 * chamber with no seats rather than one whose seats live elsewhere.
 */
const phases: CountryElectionPhaseEntry[] = [{ name: "plSejmElections", fn: ensurePLElections }];

export const PL_ELECTIONS: CountryElections = {
  electionPhases: phases,
};
