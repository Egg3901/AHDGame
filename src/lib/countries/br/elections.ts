import type { CountryElections } from "../contract";
import type { CountryElectionPhaseEntry } from "@/lib/turn/countryPhases";
import type { SpawnElectionsResult } from "@/lib/turn/perpetualElections/registry";
import { BR_SEATS_PER_REGION } from "@/lib/seeds/br/brRegions";
import { ensureBRElections, ensureBRSenateElections } from "./elections/perpetual";

/**
 * Brazil's elections.
 *
 * ⚠️ SERVER ONLY. The spawners reach `getDb`.
 *
 * ⚠️ ONE CHAMBER TABLE, AND THE SENATE'S ABSENCE IS DELIBERATE. The
 * Chamber of Deputies has a denormalised table that must agree with
 * `brRegions[*].houseDistricts`; its 513 seats are the fixed constitutional
 * allocation and were checked against the sum. The Senate has no table at all --
 * its 81 seats are `brRegions[*].stateSenateSeats`, read from the live regions,
 * the same way East Germany's Volkskammer and Russia's Soviet of the Union work.
 * A denormalised copy here would be a second source for a number the regions
 * already carry.
 */
const spawn = async (now: Date): Promise<SpawnElectionsResult> => {
  await ensureBRElections(now);
  await ensureBRSenateElections(now);
  return { message: "BR Câmara / Senate continuity check complete." };
};

/**
 * The election phases, in the order `countryPhases.ts` declares them.
 *
 * ⚠️ `spawn` AND `electionPhases` ARE DIFFERENT LISTS AND THIS COUNTRY HAS
 * BOTH. `spawn` is the continuity check the perpetual-election registry runs;
 * these are the turn phases. They overlap but are not the same set -- the
 * folder previously carried only `spawn`, so anything reading the folder for a
 * country's phases got nothing. The harness compares this list against
 * `COUNTRY_ELECTION_PHASES` entry by entry, `fn` by reference.
 */
const phases: CountryElectionPhaseEntry[] = [
  { name: "brElections", fn: ensureBRElections },
  { name: "brSenateElections", fn: ensureBRSenateElections },
];

export const BR_ELECTIONS: CountryElections = {
  electionPhases: phases,
  spawn,
  seats: {
    byChamber: { camara: BR_SEATS_PER_REGION },
    totals: { camara: Object.values(BR_SEATS_PER_REGION).reduce((a, b) => a + b, 0) },
  },
};

export { ensureBRElections, ensureBRSenateElections };
