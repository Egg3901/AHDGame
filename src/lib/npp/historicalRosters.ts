/**
 * Real historical officeholders for the 1991/2019 seated presets.
 *
 * `seedFromSeats` creates one NPP per seat row with a random fictional name.
 * For the 1991-default and 2019-default presets that erases the era: every
 * seated NPP instead gets the real person who held (or sat in) that seat —
 * name, birth year, gender, and portrait where one is findable.
 *
 * KEY SCHEME
 * ----------
 * A roster key identifies one seated NPP the same way at author time and at
 * seed time: `country|officeType|state|party|ordinal`, where `ordinal` is the
 * zero-based occurrence of that exact (country, officeType, state, party)
 * tuple in `getPresetSeats(preset)` order. The CN CCP split rows expand to 7
 * identical tuples, so they take ordinals 0–6 in split order.
 *
 * Non-preset seats (backfills, admin spawns, other eras) never match a key
 * and keep generated names — the lookup is a pure overlay, not a requirement.
 */

import type { NPPGender, NPPEthnicity } from "@/lib/db/types/npp";

export interface HistoricalRosterEntry {
  name: string;
  birthYear: number;
  gender: NPPGender;
  ethnicity: NPPEthnicity;
  /**
   * Portrait pool id (`src/data/npp-politician-images.json`). Either an
   * existing pool entry or a `hist-*` entry added with the roster. Null =
   * no findable portrait, fall back to the demographic pick.
   */
  portraitId?: string | null;
}

/** Presets with authored real-person rosters. */
export const ROSTERED_PRESETS = ["1991-default", "2019-default"] as const;
export type RosteredPreset = (typeof ROSTERED_PRESETS)[number];

export function isRosteredPreset(presetId: string): presetId is RosteredPreset {
  return (ROSTERED_PRESETS as readonly string[]).includes(presetId);
}

/** Canonical roster key for one seated NPP. */
export function rosterKey(
  countryId: string,
  officeType: string,
  state: string,
  party: string,
  ordinal: number
): string {
  return `${countryId}|${officeType}|${state}|${party}|${ordinal}`;
}

// Per-preset maps, populated from `./rosters/*` below.
import { ROSTER_1991_US as R91_US } from "./rosters/p1991-us";
import { ROSTER_1991_UK as R91_UK } from "./rosters/p1991-uk";
import { ROSTER_1991_JP as R91_JP } from "./rosters/p1991-jp";
import { ROSTER_1991_DE as R91_DE } from "./rosters/p1991-de";
import { ROSTER_1991_CN as R91_CN } from "./rosters/p1991-cn";
import { ROSTER_1991_BR as R91_BR } from "./rosters/p1991-br";
import { ROSTER_1991_IE as R91_IE } from "./rosters/p1991-ie";
import { ROSTER_2019_US as R19_US } from "./rosters/p2019-us";
import { ROSTER_2019_UK as R19_UK } from "./rosters/p2019-uk";
import { ROSTER_2019_JP as R19_JP } from "./rosters/p2019-jp";
import { ROSTER_2019_DE as R19_DE } from "./rosters/p2019-de";
import { ROSTER_2019_CN as R19_CN } from "./rosters/p2019-cn";
import { ROSTER_2019_IE as R19_IE } from "./rosters/p2019-ie";

export type RosterMap = Record<string, HistoricalRosterEntry>;

const ROSTERS: Record<RosteredPreset, RosterMap> = {
  "1991-default": Object.assign({}, R91_US, R91_UK, R91_JP, R91_DE, R91_CN, R91_BR, R91_IE),
  "2019-default": Object.assign({}, R19_US, R19_UK, R19_JP, R19_DE, R19_CN, R19_IE),
};

/**
 * Look up the real officeholder for one seated NPP. Returns undefined when
 * the preset is not rostered or the seat has no authored entry (generated
 * fictional name applies).
 */
export function getHistoricalRosterEntry(
  presetId: string,
  countryId: string,
  officeType: string,
  state: string,
  party: string,
  ordinal: number
): HistoricalRosterEntry | undefined {
  if (!isRosteredPreset(presetId)) return undefined;
  return ROSTERS[presetId][rosterKey(countryId, officeType, state, party, ordinal)];
}

/** Avatar route path for a roster portrait id. */
export function rosterPortraitUrl(portraitId: string): string {
  return `/api/images/npp-politicians/${portraitId}`;
}
