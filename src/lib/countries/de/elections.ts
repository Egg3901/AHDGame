import type { CountryElections } from "../contract";
import type { SpawnElectionsResult } from "@/lib/turn/perpetualElections/registry";
import {
  DE_WAHLKREIS_SEATS,
  DE_LANDTAG_SEATS,
  TOTAL_DE_BUNDESTAG_SEATS,
  TOTAL_DE_WAHLKREIS_SEATS,
} from "@/lib/constants/states";
import { ensureDEElections } from "./elections/perpetual";

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
const spawn = async (now: Date): Promise<SpawnElectionsResult> => {
  await ensureDEElections(now);
  return { message: "DE Bundestag continuity check complete." };
};

export const DE_ELECTIONS: CountryElections = {
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
