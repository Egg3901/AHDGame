import type { CountryElections } from "../contract";
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
const spawn = async (now: Date): Promise<SpawnElectionsResult> => {
  await ensureUKElections(now);
  await ensureUKRegionalCouncilElections(now);
  await ensureUKGovernorElections(now);
  return { message: "UK Commons / Regional Council / Governor continuity check complete." };
};

export const UK_ELECTIONS: CountryElections = {
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
