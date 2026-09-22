import type { MajorDefaultParty } from "@/lib/seeds/defaultPartyTiers";
import type { CountryElections } from "../contract";
import type { CountryElectionPhaseEntry } from "@/lib/turn/countryPhases";
import type { SpawnElectionsResult } from "@/lib/turn/perpetualElections/registry";
import { NG_SEATS_PER_REGION } from "@/lib/seeds/ng/ngRegions";
import { NG_REGIONAL_COUNCIL_SEATS } from "@/lib/constants/states";
import {
  ensureNGElections,
  ensureNGGovernorElections,
  ensureNGPresidentialElection,
  ensureNGRegionalCouncilElections,
  ensureNGSenateElections,
} from "./elections/perpetual";

const sum = (table: Readonly<Record<string, number>>): number =>
  Object.values(table).reduce((a, b) => a + b, 0);

/**
 * Nigeria's elections.
 *
 * ⚠️ SERVER ONLY. `ensureNGElections` reaches `getDb`.
 *
 * ⚠️ THE TOTALS ARE DERIVED, like Ireland's, because Nigeria declares no
 * `TOTAL_*` constants. Both were checked against the comments on the tables: the
 * House of Representatives sums to 360, "zone-scaled to NASS allocation", and
 * the State Houses of Assembly to 990, "real Nigerian State Assembly size".
 * Writing either number out by hand would create a second source that agrees
 * today and stops agreeing the first time a zone is reapportioned.
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
  await ensureNGElections(now, currentTurn);
  return { message: "NG election continuity check complete." };
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
  { name: "ngElections", fn: ensureNGElections },
  { name: "ngSenateElections", fn: ensureNGSenateElections },
  { name: "ngGovernorElections", fn: ensureNGGovernorElections },
  { name: "ngRegionalCouncilElections", fn: ensureNGRegionalCouncilElections },
  { name: "ngPresidentialElection", fn: ensureNGPresidentialElection },
];

/** Default parties that seed as Major; every other default party seeds Minor. */
const majorDefaultParties: MajorDefaultParty[] = [
  // 2019 majors — era-exclusive so no presets filter needed.
  { abbr: "APC" },
  { abbr: "PDP" },
  // 1953 late-colonial triad (NCNC/AG/NPC) — all three were major regional
  // parties contesting under Macpherson/Lyttelton; NPC demographically largest.
  { abbr: "NCNC" },
  { abbr: "AG" },
  { abbr: "NPC" },
];

export const NG_ELECTIONS: CountryElections = {
  majorDefaultParties: majorDefaultParties,
  electionPhases: phases,
  spawn,
  seats: {
    byChamber: {
      houseOfRepresentatives: NG_SEATS_PER_REGION,
      stateAssembly: NG_REGIONAL_COUNCIL_SEATS,
    },
    totals: {
      houseOfRepresentatives: sum(NG_SEATS_PER_REGION),
      stateAssembly: sum(NG_REGIONAL_COUNCIL_SEATS),
    },
  },
};

export { ensureNGElections };
