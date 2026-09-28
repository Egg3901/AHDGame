/**
 * Priority order for race types (index 0 = highest priority).
 * Snap variants are normalized to their regular counterpart before lookup so
 * calling an early election changes only its timetable, not NPP filing order.
 */
export const RACE_PRIORITY = [
  "stateSenate",
  "regionalCouncil",
  "peoplesCongress",
  "republicSupremeSoviet",
  "landAssembly",
  "sangiin",
  "house",
  "milletMeclisi",
  "commons",
  "special_commons",
  "senate",
  "senato",
  "shugiin",
  "npcDelegate",
  "supremeSovietDeputy",
  "nationalitiesDeputy",
  "governor",
] as const;

export type RaceType = (typeof RACE_PRIORITY)[number];

const SNAP_TO_REGULAR_RACE: Readonly<Record<string, string>> = {
  snap_commons: "commons",
  snap_bundestag: "bundestag",
  snap_shugiin: "shugiin",
};

export function getRacePriority(raceType: string): number {
  const normalized = SNAP_TO_REGULAR_RACE[raceType] ?? raceType;
  const index = RACE_PRIORITY.indexOf(normalized as RaceType);
  return index === -1 ? 999 : index;
}
