import type { MajorDefaultParty } from "@/lib/seeds/defaultPartyTiers";
import type { CountryElections } from "../contract";
import type { CountryElectionPhaseEntry } from "@/lib/turn/countryPhases";
import type { SpawnElectionsResult } from "@/lib/turn/perpetualElections/registry";
import {
  DE_WAHLKREIS_SEATS,
  DE_LANDTAG_SEATS,
  TOTAL_DE_BUNDESTAG_SEATS,
  TOTAL_DE_WAHLKREIS_SEATS,
} from "@/lib/constants/states";
import { ensureDEElections } from "./elections/perpetual";
/*
 * ⚠️ BOTH FROM THE DEFINING MODULE. Importing
 * `ensureDEMinisterPresidentElections` through `./elections/perpetual` gave a
 * DIFFERENT function object from the one `COUNTRY_ELECTION_PHASES` holds --
 * same name, same behaviour, not the same reference -- and the harness compares
 * phase `fn` by reference for exactly that reason.
 */
import {
  ensureDELandtagElections,
  ensureDEMinisterPresidentElections,
} from "./elections/germanyLandtag";

/**
 * Germany's elections.
 *
 * ⚠️ SERVER ONLY. `ensureDEElections` reaches `getDb`.
 *
 * ⚠️ THE SEAT TABLES ARE IMPORTED, NOT DECLARED. Japan's equivalent wrote its
 * tables out by value while `constants/states.ts` also declared them, and the
 * two sat as a second source through a completed phase. Importing leaves
 * nothing to diverge; the tables stay in `constants/states.ts` because that file
 * is still multi-country.
 *
 * ⚠️ TWO SEPARATE TOTALS, AND THEY ARE NOT THE SAME NUMBER. `TOTAL_DE_WAHLKREIS_SEATS`
 * counts the constituency seats; `TOTAL_DE_BUNDESTAG_SEATS` counts the whole
 * chamber including the list half. Reporting the constituency count as the
 * chamber size is the mixed-mode equivalent of the US federal-versus-state
 * senate confusion, and it would look entirely plausible.
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
  await ensureDEElections(now, currentTurn);
  return { message: "DE Bundestag continuity check complete." };
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
  { name: "deElections", fn: ensureDEElections },
  { name: "deLandtagElections", fn: ensureDELandtagElections },
  { name: "deMinisterPresidentElections", fn: ensureDEMinisterPresidentElections },
];

/** Default parties that seed as Major; every other default party seeds Minor. */
const majorDefaultParties: MajorDefaultParty[] = [
  { abbr: "SPD" },
  { abbr: "CDU" },
  { abbr: "GRN", presets: ["2019-default"] },
];

export const DE_ELECTIONS: CountryElections = {
  majorDefaultParties: majorDefaultParties,
  electionPhases: phases,
  spawn,
  seats: {
    byChamber: {
      wahlkreis: DE_WAHLKREIS_SEATS,
      landtag: DE_LANDTAG_SEATS,
    },
    totals: {
      wahlkreis: TOTAL_DE_WAHLKREIS_SEATS,
      bundestag: TOTAL_DE_BUNDESTAG_SEATS,
    },
  },
};

export { ensureDEElections };
