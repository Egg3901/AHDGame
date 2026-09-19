import type { MajorDefaultParty } from "@/lib/seeds/defaultPartyTiers";
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
/*
 * ⚠️ `currentTurn` IS THE IN-FLIGHT TURN AND MUST BE THREADED. The turn
 * processor spawns elections before the turn counter is persisted, so a
 * spawner that reads the stored turn instead lands a cycle one turn late.
 * Upstream added this parameter to every `ensure*` spawner and to
 * `SpawnElectionsHandler`; the registry now forwards to this function, so
 * dropping it here would silently undo that for this country.
 */
const spawn = async (now: Date, currentTurn?: number): Promise<SpawnElectionsResult> => {
  await ensureBRElections(now, currentTurn);
  await ensureBRSenateElections(now, currentTurn);
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

/** Default parties that seed as Major; every other default party seeds Minor. */
const majorDefaultParties: MajorDefaultParty[] = [
  { abbr: "PMDB" },
  { abbr: "PFL" },
  { abbr: "PT", presets: ["2019-default"] },
  { abbr: "PL" },
];

export const BR_ELECTIONS: CountryElections = {
  majorDefaultParties: majorDefaultParties,
  electionPhases: phases,
  spawn,
  seats: {
    byChamber: { camara: BR_SEATS_PER_REGION },
    totals: { camara: Object.values(BR_SEATS_PER_REGION).reduce((a, b) => a + b, 0) },
  },
};

export { ensureBRElections, ensureBRSenateElections };
