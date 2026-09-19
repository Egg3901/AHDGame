import type { CountryElections } from "../contract";
import type { CountryElectionPhaseEntry } from "@/lib/turn/countryPhases";
import { RU_NATIONALITIES_SEATS } from "@/lib/constants/ruSeats";
import {
  ensureRUGovernorElections,
  ensureRUNationalitiesElections,
  ensureRURepublicSovietElections,
  ensureRUSupremeSovietElections,
} from "./elections/perpetual";

/**
 * Russia's elections.
 *
 * ⚠️ SERVER ONLY. The spawners reach `getDb`.
 *
 * ⚠️ NO `spawn`, AND THAT IS NOT AN OVERSIGHT. Russia has no row in
 * `SPAWN_ELECTIONS_REGISTRY` at all; its four spawners run as ELECTION PHASES
 * through `COUNTRY_ELECTION_PHASES` instead. Inventing a `spawn` that called
 * them would give Russia a second execution path for the same work, running
 * them twice a turn.
 *
 * ⚠️ ONE CHAMBER HERE, AND THE MISSING ONE IS MISSING ON PURPOSE. The Soviet of
 * the UNION is apportioned from `region.houseDistricts` in the region bundles,
 * and `ruSeats.ts` says in as many words that a parallel map would drift. So
 * there is deliberately no union-chamber table to carry, and adding one to make
 * the folder look symmetrical would create exactly the second source that file
 * refuses.
 *
 * The Soviet of NATIONALITIES is republic-weighted rather than
 * population-weighted: 25 seats per union republic, 11 per autonomous republic,
 * with a floor of 20 per region. Its total of 515 was checked against the sum of
 * the table, and against the 640 the comment records for before Ukraine,
 * Byelorussia and the Baltics became their own countries.
 */
const phases: CountryElectionPhaseEntry[] = [
  { name: "ruSupremeSovietElections", fn: ensureRUSupremeSovietElections },
  { name: "ruNationalitiesElections", fn: ensureRUNationalitiesElections },
  { name: "ruRepublicSovietElections", fn: ensureRURepublicSovietElections },
  { name: "ruGovernorElections", fn: ensureRUGovernorElections },
];

export const RU_ELECTIONS: CountryElections = {
  electionPhases: phases,
  seats: {
    byChamber: {
      nationalities: RU_NATIONALITIES_SEATS,
    },
    totals: {
      nationalities: Object.values(RU_NATIONALITIES_SEATS).reduce((a, b) => a + b, 0),
    },
  },
};

export {
  ensureRUGovernorElections,
  ensureRUNationalitiesElections,
  ensureRURepublicSovietElections,
  ensureRUSupremeSovietElections,
};
