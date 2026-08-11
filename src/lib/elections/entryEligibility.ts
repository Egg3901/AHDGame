/**
 * Whether a viewer may enter or leave a given race.
 *
 * Extracted from `ElectionCard` so the grouped list and the card cannot drift
 * apart. Duplicating these rules is how a surface ends up offering an "Enter
 * race" button the API then refuses.
 *
 * The API is still the authority: this only decides what to show.
 */

import type { CharacterBasic, ElectionDisplay } from "@/lib/db/types";
import {
  isElectionTypeEntryBlocked,
  isNationwideDirectExecutiveElection,
} from "@/lib/elections/nationwideExecutive";

export type EntryAction =
  /** Viewer stands in this race and may pull out. */
  | "withdraw"
  /** Viewer may file for this race. */
  | "enter"
  /** Race type has a spawner but no resolver yet, so it resolves vacant. */
  | "blocked"
  /** Nothing to offer: wrong region, already standing elsewhere, or filing shut. */
  | "none";

export interface EntryEligibilityInput {
  election: ElectionDisplay;
  character: CharacterBasic | null;
  /** Region the race sits in, as displayed. */
  stateId: string;
  /** Viewer already stands in THIS race. */
  inThisRace: boolean;
  /** Viewer already stands in some race. */
  inAnyRace: boolean;
  /** Primary countdown has run out, taken from the game clock. */
  primaryEnded: boolean;
}

export function resolveEntryAction({
  election,
  character,
  stateId,
  inThisRace,
  inAnyRace,
  primaryEnded,
}: EntryEligibilityInput): EntryAction {
  if (!character) return "none";
  if (inThisRace) return "withdraw";
  if (isElectionTypeEntryBlocked(election.electionType)) return "blocked";

  const isHomeState = character.homeState === stateId;
  // Nationwide executive races (president, uachtaran) live under state=countryId
  // and aren't tied to any single home region, so any character from the
  // matching country may enter.
  const isEligibleNationwideExecutive =
    !!character.countryId &&
    isNationwideDirectExecutiveElection(election.electionType, election.state, character.countryId);

  if (!isHomeState && !isEligibleNationwideExecutive) return "none";
  if (inAnyRace) return "none";
  if (primaryEnded) return "none";

  return "enter";
}
