import type { MajorDefaultParty } from "@/lib/seeds/defaultPartyTiers";
import type { CountryElections } from "../contract";
import type { CountryElectionPhaseEntry } from "@/lib/turn/countryPhases";
import type { SpawnElectionsResult } from "@/lib/turn/perpetualElections/registry";
import {
  CN_NPC_SEATS,
  CN_NPC_SEATS_1953,
  CN_PEOPLES_CONGRESS_SEATS,
  CN_PEOPLES_CONGRESS_SEATS_1953,
  TOTAL_CN_NPC_SEATS,
  TOTAL_CN_NPC_SEATS_1953,
  TOTAL_CN_PEOPLES_CONGRESS_SEATS,
  TOTAL_CN_PEOPLES_CONGRESS_SEATS_1953,
} from "@/lib/constants/states";
import {
  ensureCNElections,
  ensureCNGovernorElections,
  ensureCNPeoplesCongressElections,
} from "./elections/perpetual";

/**
 * China's elections.
 *
 * ⚠️ SERVER ONLY. The spawners reach `getDb`.
 *
 * ⚠️ THE SEAT TABLES ARE IMPORTED, NOT DECLARED. Japan's equivalent wrote its
 * tables out by value while `constants/states.ts` also declared them, and the
 * two sat as a second source through a completed phase. Importing leaves
 * nothing to diverge; the tables stay in `constants/states.ts` because that file
 * is still multi-country.
 *
 * ⚠️ BOTH ERAS ARE LISTED, BECAUSE CHINA'S CHAMBERS CHANGE SIZE AND NEITHER
 * TABLE IS "THE" TABLE. The NPC is 2,980 seats in the modern world and 1,226 in
 * 1953; the Provincial People's Congresses are 4,000 and 3,781. `getCnNpcSeats`
 * picks between them by preset, and no other converted country has needed that.
 * `byChamber` has one slot per chamber, so the honest encoding is one entry per
 * chamber-era rather than picking the modern table and quietly describing the
 * 1953 world with 1,754 seats it does not have.
 *
 * ⚠️ NO GOVERNOR SEAT TABLE, AND THAT IS NOT AN OMISSION. Governors are one
 * office per region rather than a chamber, so there is no per-region seat count
 * to carry -- `ensureCNGovernorElections` works off the region roster.
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
  await ensureCNElections(now, currentTurn);
  await ensureCNPeoplesCongressElections(now, currentTurn);
  await ensureCNGovernorElections(now, currentTurn);
  return { message: "CN NPC / Provincial Congress / Governor continuity check complete." };
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
  { name: "cnElections", fn: ensureCNElections },
  { name: "cnPeoplesCongressElections", fn: ensureCNPeoplesCongressElections },
  { name: "cnGovernorElections", fn: ensureCNGovernorElections },
];

/** Default parties that seed as Major; every other default party seeds Minor. */
const majorDefaultParties: MajorDefaultParty[] = [{ abbr: "CCP" }];

export const CN_ELECTIONS: CountryElections = {
  majorDefaultParties: majorDefaultParties,
  electionPhases: phases,
  spawn,
  seats: {
    byChamber: {
      npc: CN_NPC_SEATS,
      npc1953: CN_NPC_SEATS_1953,
      peoplesCongress: CN_PEOPLES_CONGRESS_SEATS,
      peoplesCongress1953: CN_PEOPLES_CONGRESS_SEATS_1953,
    },
    totals: {
      npc: TOTAL_CN_NPC_SEATS,
      npc1953: TOTAL_CN_NPC_SEATS_1953,
      peoplesCongress: TOTAL_CN_PEOPLES_CONGRESS_SEATS,
      peoplesCongress1953: TOTAL_CN_PEOPLES_CONGRESS_SEATS_1953,
    },
  },
};

export { ensureCNElections, ensureCNGovernorElections, ensureCNPeoplesCongressElections };
