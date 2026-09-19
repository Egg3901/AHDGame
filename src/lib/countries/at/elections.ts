import type { CountryElections } from "../contract";
import type { CountryElectionPhaseEntry } from "@/lib/turn/countryPhases";
import { ensureATElections } from "@/lib/turn/perpetualElections";

/**
 * Austria's elections.
 *
 * ⚠️ SERVER ONLY. The spawners reach `getDb`.
 *
 * ⚠️ NO `spawn`, AND NOTHING RELOCATED. Austria has no row in
 * `SPAWN_ELECTIONS_REGISTRY`; these phases run through
 * `COUNTRY_ELECTION_PHASES`, in this order. Adding a `spawn` would run them a
 * second time each turn. The spawner functions stay where they are because their
 * files are shared between countries -- moving one into this folder would take
 * the others' elections with it.
 *
 * ⚠️ NO `seats`. There is no seat table for Austria anywhere;
 * apportionment is read from the live regions, the way East Germany's
 * Volkskammer and Brazil's Senate are. An empty `byChamber` would describe a
 * chamber with no seats rather than one whose seats live elsewhere.
 */
const phases: CountryElectionPhaseEntry[] = [{ name: "atElections", fn: ensureATElections }];

export const AT_ELECTIONS: CountryElections = {
  electionPhases: phases,
};
