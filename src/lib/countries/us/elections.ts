import type { MajorDefaultParty } from "@/lib/seeds/defaultPartyTiers";
import type { CountryElections } from "../contract";
import {
  ELECTORAL_VOTES,
  HOUSE_SEATS,
  SENATE_CLASSES_BY_STATE,
  STATE_SENATE_SEATS,
  TOTAL_ELECTORAL_VOTES,
  TOTAL_HOUSE_SEATS,
  TOTAL_SENATE_SEATS,
} from "@/lib/constants/states";
import { ensurePresidentialElection } from "@/lib/turn/perpetualElections/shared";

/**
 * The United States' elections.
 *
 * ⚠️ SERVER ONLY. `ensurePresidentialElection` reaches `getDb`, so importing this
 * module from a client component pulls the database driver into the browser
 * bundle. It is not re-exported from the folder barrel for browser use.
 *
 * ⚠️ THE SEAT TABLES ARE IMPORTED, NOT DECLARED, AND THAT IS THE ENTIRE POINT.
 * Japan's equivalent module wrote its tables out by value while
 * `constants/states.ts` also declared them, and the two sat there as a second
 * source -- `===` different, `JSON.stringify` equal -- through a completed
 * phase, because a comment saying "a later phase decides whether it forwards"
 * is not a guard. Importing means there is nothing to diverge.
 *
 * ⚠️ THE TABLES THEMSELVES STAY IN `constants/states.ts`, unlike Japan's, and
 * the reason is specific rather than laziness:
 *
 *   - that file is still multi-country -- it declares UK_COMMONS_SEATS,
 *     CN_NPC_SEATS, DE_WAHLKREIS_SEATS, NG_REGIONAL_COUNCIL_SEATS and
 *     RU_REGION_NAMES -- so it is not the United States' file to take; and
 *   - the US block is entangled with values DERIVED from it in place.
 *     `STATE_IDS` is `Object.keys(HOUSE_SEATS)`, `STATE_ID_SET` is built from
 *     that, and `ELECTORAL_VOTES_1953` and `ELECTORAL_VOTE_UNITS_1953` are
 *     computed from the modern tables. Relocating the literals without the
 *     derivations would split one computation across two files for no reader's
 *     benefit, and relocating the derivations would move code, not data.
 *
 * Japan's tables moved because Japan had DUPLICATED them. The US has not, so the
 * fix Japan needed does not apply here. If `constants/states.ts` is ever split
 * per country, these follow; until then, one definition is the property that
 * matters and it already holds.
 */

/**
 * Federal Senate seats per state, derived from the class assignments.
 *
 * ⚠️ `STATE_SENATE_SEATS` IS NOT THIS, AND THE NAMES INVITE THE MISTAKE. That
 * table is each state's OWN upper chamber -- "for state senate elections", as
 * its comment says -- and sums to 1,972 nationally. The federal Senate is two
 * per state and sums to 100. A first draft of this module used it and produced
 * a `senate` chamber of 1,972 seats against a stated total of 100; the totals
 * check caught it, and nothing else would have, because both values are real
 * numbers about real senates.
 *
 * The count is derived from the tuple LENGTH rather than written as `2`. Each
 * entry in `SENATE_CLASSES_BY_STATE` lists that state's seats by election class,
 * so its length IS the seat count -- which keeps this honest if a state ever
 * carries a different number, and stops the `2` becoming a second source.
 */
const federalSenateSeats: Readonly<Record<string, number>> = Object.fromEntries(
  Object.entries(SENATE_CLASSES_BY_STATE).map(([state, classes]) => [state, classes.length])
);

/**
 * ⚠️ `byChamber` IS KEYED BY STATE, NOT BY REGION-WITH-ONE-SEAT. The House table
 * gives each state its delegation size (California 52, Wyoming 1). A country
 * whose chambers are regional -- Japan's eight -- has the same shape and means
 * something different.
 */
/** Default parties that seed as Major; every other default party seeds Minor. */
const majorDefaultParties: MajorDefaultParty[] = [{ abbr: "DEM" }, { abbr: "REP" }];

export const US_ELECTIONS: CountryElections = {
  majorDefaultParties: majorDefaultParties,
  spawn: ensurePresidentialElection,
  seats: {
    byChamber: {
      house: HOUSE_SEATS,
      senate: federalSenateSeats,
      stateSenate: STATE_SENATE_SEATS,
      electoralCollege: ELECTORAL_VOTES,
    },
    totals: {
      house: TOTAL_HOUSE_SEATS,
      senate: TOTAL_SENATE_SEATS,
      electoralCollege: TOTAL_ELECTORAL_VOTES,
    },
  },
};

/**
 * ⚠️ NO `electionPhases` AND NO `billPhases`, AND BOTH ABSENCES ARE REAL.
 * `COUNTRY_ELECTION_PHASES` and `COUNTRY_BILL_PHASES` are
 * `Partial<Record<CountryId, ...>>` with no US key; the US runs off the global
 * game state rather than a per-country phase table, and
 * `countryReadinessContract` reads both through `?.`. Authoring either here
 * would turn a deliberate fallback into an authored value.
 */
