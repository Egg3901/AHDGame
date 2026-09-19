import type { MajorDefaultParty } from "@/lib/seeds/defaultPartyTiers";
import type { CountryElections } from "../contract";
import type { CountryElectionPhaseEntry } from "@/lib/turn/countryPhases";
import type { SpawnElectionsResult } from "@/lib/turn/perpetualElections/registry";
import { IE_DAIL_SEATS_PER_REGION } from "@/lib/seeds/ie/ieRegions";
import { IE_LOCAL_COUNCIL_SEATS } from "@/lib/turn/perpetualElections/shared";
import {
  ensureIECathaoirleachElections,
  ensureIEElections,
  ensureIELocalCouncilElections,
  ensureIEUachtaranElections,
} from "./elections/perpetual";

const sum = (table: Readonly<Record<string, number>>): number =>
  Object.values(table).reduce((a, b) => a + b, 0);

/**
 * Ireland's elections.
 *
 * ⚠️ SERVER ONLY. The spawners reach `getDb`.
 *
 * ⚠️ THE TOTALS ARE DERIVED, NOT DECLARED, AND THAT IS THE DIFFERENCE HERE.
 * Germany and China have `TOTAL_*` constants to import, so importing them
 * leaves one source. Ireland has none, so a hand-written `160` would BE a
 * second source -- one that agrees today and silently stops agreeing the first
 * time a constituency moves. Summing the same object cannot drift from it.
 *
 * ⚠️ THE COUNCIL TOTAL IS 295, AND IT IS NOT THE NUMBER OF SEATS IN PLAY. The
 * table is 200 councillors across the eight NUTS-III regions plus NIR's 95,
 * which exist only once Ireland reunifies. Both were checked against the
 * comments on the tables: the Dáil sums to 160 as documented, and the council
 * sums to 200 without NIR. Reporting 295 as the standing chamber size would
 * overstate it by nearly half, so the reunification seats are named separately.
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
  await ensureIEElections(now, currentTurn);
  await ensureIEUachtaranElections(now, currentTurn);
  await ensureIELocalCouncilElections(now, currentTurn);
  await ensureIECathaoirleachElections(now, currentTurn);
  return {
    message: "IE Dáil, Uachtarán, Local Council, and Cathaoirleach continuity check complete.",
  };
};

const { NIR: NIR_COUNCIL_SEATS, ...COUNCIL_SEATS_EXCLUDING_NIR } = IE_LOCAL_COUNCIL_SEATS;

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
  { name: "ieElections", fn: ensureIEElections },
  { name: "ieUachtaranElections", fn: ensureIEUachtaranElections },
  { name: "ieLocalCouncilElections", fn: ensureIELocalCouncilElections },
  { name: "ieCathaoirleachElections", fn: ensureIECathaoirleachElections },
];

/** Default parties that seed as Major; every other default party seeds Minor. */
const majorDefaultParties: MajorDefaultParty[] = [{ abbr: "FF" }, { abbr: "FG" }, { abbr: "SF" }];

export const IE_ELECTIONS: CountryElections = {
  majorDefaultParties: majorDefaultParties,
  electionPhases: phases,
  spawn,
  seats: {
    byChamber: {
      dail: IE_DAIL_SEATS_PER_REGION,
      localCouncil: IE_LOCAL_COUNCIL_SEATS,
    },
    totals: {
      dail: sum(IE_DAIL_SEATS_PER_REGION),
      localCouncil: sum(COUNCIL_SEATS_EXCLUDING_NIR),
      localCouncilAfterReunification: sum(IE_LOCAL_COUNCIL_SEATS),
      northernIrelandCouncil: NIR_COUNCIL_SEATS,
    },
  },
};

export {
  ensureIECathaoirleachElections,
  ensureIEElections,
  ensureIELocalCouncilElections,
  ensureIEUachtaranElections,
};
