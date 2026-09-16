import type { CountryElectionPhaseEntry } from "@/lib/turn/countryPhases";
import type { SpawnElectionsResult } from "@/lib/turn/perpetualElections/registry";
import type { CountryElections } from "../contract";
import {
  ensureJPCouncillorElections,
  ensureJPElections,
  ensureJPGovernorElections,
  ensureJPRegionalCouncilElections,
} from "./elections/perpetual";

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

/** Per-region Shugiin seats. Sums to 465. */
const shugiinSeats: Readonly<Record<string, number>> = {
  HOK: 12,
  TOH: 37,
  KAN: 150,
  CHU: 81,
  KNS: 82,
  CGK: 28,
  SHI: 14,
  KYU: 61,
};

/** Per-region Sangiin seats. Sums to 248. */
const sangiinSeats: Readonly<Record<string, number>> = {
  HOK: 7,
  TOH: 20,
  KAN: 80,
  CHU: 44,
  KNS: 44,
  CGK: 14,
  SHI: 8,
  KYU: 31,
};

/** One governor per region. */
const governorSeats: Readonly<Record<string, number>> = {
  HOK: 1,
  TOH: 1,
  KAN: 1,
  CHU: 1,
  KNS: 1,
  CGK: 1,
  SHI: 1,
  KYU: 1,
};

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
