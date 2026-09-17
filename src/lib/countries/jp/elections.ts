import type { CountryElectionPhaseEntry } from "@/lib/turn/countryPhases";
import type { SpawnElectionsResult } from "@/lib/turn/perpetualElections/registry";
import type { CountryElections } from "../contract";
import {
  ensureJPCouncillorElections,
  ensureJPElections,
  ensureJPGovernorElections,
  ensureJPRegionalCouncilElections,
} from "./elections/perpetual";
import {
  JP_GOVERNOR_SEATS as governorSeats,
  JP_SANGIIN_SEATS as sangiinSeats,
  JP_SHUGIIN_SEATS as shugiinSeats,
} from "./data/jpSeats";

/**
 * Japan's elections. Phase D3.
 *
 * ⚠️ SERVER ONLY. `./elections/perpetual` reaches `getDb`, so importing this
 * module from a client component pulls the database driver into the browser
 * bundle. It is deliberately NOT re-exported from `../jp/index.ts`.
 *
 * ⚠️ The seat tables are the values four coverage rules missed. They live in
 * `constants/states.ts`, which is not Japan-named and carries no `JP:` key, so
 * neither the object-key scan nor the filename scan found them. They are
 * reproduced here from the pre-move snapshot; `constants/states.ts` keeps the
 * declarations and D7 decides whether it forwards.
 *
 * ⚠️ Functions are composed by IMPORT, never by literal. `toEqual` compares
 * functions by REFERENCE, so the ordinary harness is blind to them: a re-export
 * passes tautologically and a re-declaration fails despite identical behaviour.
 * MOVED_THUNK_REGISTRIES pins them by resolved behaviour instead.
 */

/**
 * Japan's chamber seat tables.
 *
 * ⚠️ IMPORTED, NOT DECLARED, AND THAT IS THE WHOLE POINT. These were written
 * out here by value AND in `constants/states.ts`, with nothing keeping the two
 * in step. Measured, `===` said different objects and `JSON.stringify` said
 * equal values: correct on the day it was written, silently divergent after the
 * first edit to either side.
 *
 * The comment that used to sit here said they were "reproduced from the pre-move
 * snapshot" and that a later phase would "decide whether it forwards". The
 * decision is made: `jp/data/jpSeats.ts` holds them, `constants/states.ts`
 * forwards, and this reads the same objects.
 */

/**
 * The continuity spawner. Shugiin (lower), Sangiin (upper, natural class), and
 * prefectural Governor seats.
 *
 * ⚠️ Regional Council is NOT spawned here. It runs as its own election phase
 * (COUNTRY_ELECTION_PHASES) and mirrors live Shugiin timing; the phases execute
 * concurrently via Promise.all, so ordering is best-effort.
 */
const spawn = async (now: Date): Promise<SpawnElectionsResult> => {
  await ensureJPElections(now);
  await ensureJPCouncillorElections(now);
  await ensureJPGovernorElections(now);
  return { message: "JP Shugiin / Sangiin / Governor continuity check complete." };
};

/** The four election phases, in the order countryPhases.ts declares them. */
const phases: CountryElectionPhaseEntry[] = [
  { name: "jpElections", fn: ensureJPElections },
  { name: "jpRegionalCouncilElections", fn: ensureJPRegionalCouncilElections },
  { name: "jpCouncillorElections", fn: ensureJPCouncillorElections },
  { name: "jpGovernorElections", fn: ensureJPGovernorElections },
];

export const JP_ELECTIONS: CountryElections = {
  spawn,
  electionPhases: phases,
  seats: {
    byChamber: {
      shugiin: shugiinSeats,
      sangiin: sangiinSeats,
      governor: governorSeats,
    },
    totals: {
      shugiin: 465,
      sangiin: 248,
      governor: 8,
    },
  },
};

export {
  ensureJPCouncillorElections,
  ensureJPElections,
  ensureJPGovernorElections,
  ensureJPRegionalCouncilElections,
};
