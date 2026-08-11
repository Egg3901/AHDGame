import type { Character } from "@/lib/db/types/character";

/**
 * The two fields this module actually reads. Accepting the narrow shape
 * (instead of a full `Character`) lets callers pass a `RetiredCharacterSnapshot`
 * — which has the same `careerHistory`/`currentOffice` shape — without a cast,
 * so the Hall of Fame leaderboard can re-derive a life's highest office live
 * from raw history instead of trusting a value frozen at retirement time.
 */
export type OfficeHolderLike = Pick<Character, "careerHistory" | "currentOffice">;

/**
 * Career-event types that mean the office was actually HELD (vs merely
 * contested). `lost_election` is excluded: it records the office a losing
 * candidate ran for (e.g. a losing presidential candidate gets an event with
 * `office.type: "president"`), not one they held — counting it credited losers
 * with offices they never held (ticket #991).
 */
const HELD_OFFICE_EVENT_TYPES: ReadonlySet<string> = new Set([
  "elected",
  "appointed",
  "resigned",
  "removed",
]);

/**
 * Office-holding tier ladder, shared by the label lookup below and the
 * Hall of Fame leaderboard's office-tier score bonus — both need to agree on
 * what outranks what.
 */
export const OFFICE_RANK: Readonly<Record<string, number>> = {
  regionalCouncil: 1,
  stateSenate: 2,
  house: 3,
  commons: 3,
  senate: 4,
  governor: 5,
  primeMinister: 6,
  vicePresident: 7,
  president: 8,
};

function findHighestOffice(
  character: OfficeHolderLike
): { label: string; rank: number } | undefined {
  let highest: { label: string; rank: number } | undefined;

  if (character.careerHistory?.length) {
    for (const event of character.careerHistory) {
      if (!event.office) continue;
      if (!HELD_OFFICE_EVENT_TYPES.has(event.type)) continue; // skip lost_election etc.
      const rank = OFFICE_RANK[event.office.type] ?? 0;
      if (!highest || rank > highest.rank) {
        highest = { label: event.officeLabel, rank };
      }
    }
  }

  if (character.currentOffice) {
    const rank = OFFICE_RANK[character.currentOffice.type] ?? 0;
    if (!highest || rank > highest.rank) {
      const type = character.currentOffice.type;
      const state = "state" in character.currentOffice ? character.currentOffice.state : undefined;
      highest = { label: state ? `${type} (${state})` : type, rank };
    }
  }

  return highest;
}

/**
 * Derive a human-readable label for the highest office from career history
 * or the character's current office. Falls back to undefined if no office found.
 *
 * Extracted from retireCharacter.ts (cf. season-recap) so both the retirement
 * snapshot and the Season Recap builder share one office-ranking ladder.
 */
export function deriveHighestOffice(character: OfficeHolderLike): string | undefined {
  return findHighestOffice(character)?.label;
}

/** Numeric tier (0 = never held office) for the highest office ever held — see `OFFICE_RANK`. */
export function deriveHighestOfficeRank(character: OfficeHolderLike): number {
  return findHighestOffice(character)?.rank ?? 0;
}
