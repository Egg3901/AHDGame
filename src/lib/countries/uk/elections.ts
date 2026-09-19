import type { MajorDefaultParty } from "@/lib/seeds/defaultPartyTiers";
import type { CountryElections } from "../contract";
import type { CountryElectionPhaseEntry } from "@/lib/turn/countryPhases";
import type { SpawnElectionsResult } from "@/lib/turn/perpetualElections/registry";
import {
  TOTAL_UK_COMMONS_SEATS,
  UK_COMMONS_SEATS,
  UK_REGIONAL_COUNCIL_SEATS,
} from "@/lib/constants/states";
import {
  ensureUKElections,
  ensureUKGovernorElections,
  ensureUKRegionalCouncilElections,
} from "./elections/perpetual";

/**
 * The United Kingdom's elections.
 *
 * ⚠️ SERVER ONLY. The continuity spawners reach `getDb`.
 *
 * ⚠️ THE SEAT TABLES ARE IMPORTED, NOT DECLARED. Japan's equivalent module wrote
 * its tables out by value while `constants/states.ts` also declared them, and the
 * two sat as a second source -- `===` different, `JSON.stringify` equal -- through
 * a completed phase, because a comment promising a later decision is not a guard.
 * Importing leaves nothing to diverge.
 *
 * ⚠️ THE TABLES STAY IN `constants/states.ts` for the same reason the US ones do:
 * that file is still multi-country, holding CN, DE, NG and RU seat tables beside
 * these. It is not the UK's file to take.
 */

/**
 * ⚠️ THREE SPAWNERS, NOT ONE. The registry entry runs Westminster, the devolved
 * Regional Councils and the Governor seats in sequence. A folder that forwarded
 * only `ensureUKElections` would silently stop spawning two of the three, and
 * nothing would fail -- the elections would simply never appear.
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
  await ensureUKElections(now, currentTurn);
  await ensureUKRegionalCouncilElections(now, currentTurn);
  await ensureUKGovernorElections(now, currentTurn);
  return { message: "UK Commons / Regional Council / Governor continuity check complete." };
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
  { name: "ukElections", fn: ensureUKElections },
  { name: "ukRegionalCouncilElections", fn: ensureUKRegionalCouncilElections },
  { name: "ukGovernorElections", fn: ensureUKGovernorElections },
];

/** Default parties that seed as Major; every other default party seeds Minor. */
const majorDefaultParties: MajorDefaultParty[] = [
  { abbr: "LAB" },
  { abbr: "CON" },
  // Lib Dems founded 1988; in 1953 the majors are Conservative + Labour and
  // the historic Liberal Party (LIB, 1953-only seed) is a Minor third party.
  {
    abbr: "LD",
    presets: [
      "1979-default",
      "1991-default",
      "1999-default",
      "2007-default",
      "2019-default",
      "2023-default",
    ],
  },
];

export const UK_ELECTIONS: CountryElections = {
  majorDefaultParties: majorDefaultParties,
  electionPhases: phases,
  spawn,
  seats: {
    byChamber: {
      commons: UK_COMMONS_SEATS,
      regionalCouncil: UK_REGIONAL_COUNCIL_SEATS,
    },
    totals: {
      commons: TOTAL_UK_COMMONS_SEATS,
    },
  },
};

export { ensureUKElections, ensureUKGovernorElections, ensureUKRegionalCouncilElections };
