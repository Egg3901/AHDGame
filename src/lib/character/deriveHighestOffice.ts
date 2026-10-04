import { COUNTRY_CONFIGS, COUNTRY_ORDER } from "@/lib/constants/countries";
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
  primeMinister: 8,
  vicePresident: 7,
  president: 8,
};

/** Cabinet office types: a seat in the national government below its head. */
const CABINET_OFFICE_RANK = 6;
const CABINET_OFFICE_TYPES = ["usCabinet", "ukCabinet", "parliamentaryCabinet", "deCabinet"];
/** National upper-house keys; every other national legislative seat ranks as a lower house. */
const UPPER_HOUSE_KEYS: ReadonlySet<string> = new Set([
  "senate",
  "senator",
  "sangiin",
  "nationalitiesDeputy",
]);

/**
 * Ranks for every office key in every country's config, so a 1953 General
 * Secretary or a Taoiseach outranks a backbench deputy instead of falling to 0.
 * `OFFICE_RANK` stays authoritative for the keys it names; everything else is
 * classified from its `OfficeTypeConfig`: the country's first national executive
 * (head of government) 8, other national executives 7, cabinet and central bank
 * 6, regional executives 5, upper houses 4, lower houses 3, regional
 * legislatures 2, local councils 1. A key shared across countries takes its
 * highest classification.
 */
const DERIVED_OFFICE_RANK: Readonly<Record<string, number>> = (() => {
  const ranks: Record<string, number> = {};
  const raise = (key: string, rank: number) => {
    if ((ranks[key] ?? 0) < rank) ranks[key] = rank;
  };
  for (const type of CABINET_OFFICE_TYPES) raise(type, CABINET_OFFICE_RANK);
  for (const id of COUNTRY_ORDER) {
    const offices = COUNTRY_CONFIGS[id].officeTypes;
    const headKey = offices.find((o) => o.isExecutive && !o.isSubNational)?.key;
    for (const office of offices) {
      let rank: number;
      if (office.key === "centralBankChair") rank = CABINET_OFFICE_RANK;
      else if (office.isExecutive && !office.isSubNational) rank = office.key === headKey ? 8 : 7;
      else if (office.isExecutive) rank = 5;
      else if (!office.isSubNational) rank = UPPER_HOUSE_KEYS.has(office.key) ? 4 : 3;
      else rank = /council/i.test(office.key) ? 1 : 2;
      raise(office.key, rank);
    }
  }
  return ranks;
})();

/** Tier for one office key: the explicit ladder first, then the config-derived one. */
export function officeRank(type: string): number {
  return OFFICE_RANK[type] ?? DERIVED_OFFICE_RANK[type] ?? 0;
}

function findHighestOffice(
  character: OfficeHolderLike
): { label: string; rank: number } | undefined {
  let highest: { label: string; rank: number } | undefined;

  if (character.careerHistory?.length) {
    for (const event of character.careerHistory) {
      if (!event.office) continue;
      if (!HELD_OFFICE_EVENT_TYPES.has(event.type)) continue; // skip lost_election etc.
      const rank = officeRank(event.office.type);
      if (!highest || rank > highest.rank) {
        highest = { label: event.officeLabel, rank };
      }
    }
  }

  if (character.currentOffice) {
    const rank = officeRank(character.currentOffice.type);
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
