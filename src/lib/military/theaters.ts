// Proxy-theater combat-power model for the Conflicts board (World Situation
// Board), ported from the design's Conflicts.dc.html. Pure data + logic; shares
// the theater set with Combat Command. The UI persists commitment state to the
// per-country `theaterState` collection via the gated theaters PUT.

import type { Db } from "mongodb";
import type { Posture } from "@/lib/db/types/militaryUnit";
import type { Bloc } from "@/lib/military/bloc";
import { conflictExists } from "@/lib/db/collections/conflicts";
import { US_IDENTITY } from "@/lib/countries/us/identity";
import { UK_IDENTITY } from "@/lib/countries/uk/identity";
import { IE_IDENTITY } from "@/lib/countries/ie/identity";
import { DE_IDENTITY } from "@/lib/countries/de/identity";
import { DD_IDENTITY } from "@/lib/countries/dd/identity";
import { JP_IDENTITY } from "@/lib/countries/jp/identity";
import { NG_IDENTITY } from "@/lib/countries/ng/identity";
import { RU_IDENTITY } from "@/lib/countries/ru/identity";
import { CN_IDENTITY } from "@/lib/countries/cn/identity";
import { PL_IDENTITY } from "@/lib/countries/pl/identity";
import { CS_IDENTITY } from "@/lib/countries/cs/identity";
import { HU_IDENTITY } from "@/lib/countries/hu/identity";
import { RO_IDENTITY } from "@/lib/countries/ro/identity";
import { BG_IDENTITY } from "@/lib/countries/bg/identity";
import { BLR_IDENTITY } from "@/lib/countries/blr/identity";
import { UKR_IDENTITY } from "@/lib/countries/ukr/identity";
import { BAL_IDENTITY } from "@/lib/countries/bal/identity";
import { YU_IDENTITY } from "@/lib/countries/yu/identity";
import { FR_IDENTITY } from "@/lib/countries/fr/identity";
import { IT_IDENTITY } from "@/lib/countries/it/identity";
import { ES_IDENTITY } from "@/lib/countries/es/identity";
import { SE_IDENTITY } from "@/lib/countries/se/identity";
import { TR_IDENTITY } from "@/lib/countries/tr/identity";
import { GR_IDENTITY } from "@/lib/countries/gr/identity";
import { AT_IDENTITY } from "@/lib/countries/at/identity";
import { FI_IDENTITY } from "@/lib/countries/fi/identity";
import { BR_IDENTITY } from "@/lib/countries/br/identity";
import { SCO_IDENTITY } from "@/lib/countries/sco/identity";
import { WAL_IDENTITY } from "@/lib/countries/wal/identity";

/**
 * Situation-board dressing for a nation's command: its classification strip, the name
 * of its high command, and an accent colour.
 *
 * FLAVOUR ONLY — it deliberately carries no bloc. This table used to hold a `bloc`
 * field that the whole military system treated as the authoritative answer to "whose
 * side is this country on", which it was in no position to be: it covered 9 of 27
 * countries, silently read every other nation as western, and could not follow a
 * nation into or out of an alliance. Bloc is read from live organisation membership
 * now (`@/lib/military/bloc`); this is a lookup for how the board should LOOK.
 *
 * `command` is a nation's own name for its high command and does not imply alignment —
 * `blocName` is derived from the live roll and passed in by the server component.
 */
export interface CountryCommandFlavor {
  glyph: string;
  command: string;
  strip: string;
  acc: string;
}

const NEUTRAL_ACC = "#86d978";

/** Fallback dressing for a nation with no entry of its own. */
export const DEFAULT_COMMAND_FLAVOR: CountryCommandFlavor = {
  glyph: "??",
  command: "GENERAL STAFF",
  strip: "◆ RESTRICTED · ACTIVE THEATERS",
  acc: NEUTRAL_ACC,
};

export const COUNTRY_COMMAND_FLAVOR: Record<string, CountryCommandFlavor> = {
  US: US_IDENTITY.commandFlavor,
  UK: UK_IDENTITY.commandFlavor,
  IE: IE_IDENTITY.commandFlavor,
  DE: DE_IDENTITY.commandFlavor,
  DD: DD_IDENTITY.commandFlavor,
  JP: JP_IDENTITY.commandFlavor,
  NG: NG_IDENTITY.commandFlavor,
  RU: RU_IDENTITY.commandFlavor,
  CN: CN_IDENTITY.commandFlavor,
  PL: PL_IDENTITY.commandFlavor,
  CS: CS_IDENTITY.commandFlavor,
  HU: HU_IDENTITY.commandFlavor,
  RO: RO_IDENTITY.commandFlavor,
  BG: BG_IDENTITY.commandFlavor,
  BLR: BLR_IDENTITY.commandFlavor,
  UKR: UKR_IDENTITY.commandFlavor,
  BAL: BAL_IDENTITY.commandFlavor,
  YU: YU_IDENTITY.commandFlavor,
  FR: FR_IDENTITY.commandFlavor,
  IT: IT_IDENTITY.commandFlavor,
  ES: ES_IDENTITY.commandFlavor,
  SE: SE_IDENTITY.commandFlavor,
  TR: TR_IDENTITY.commandFlavor,
  GR: GR_IDENTITY.commandFlavor,
  AT: AT_IDENTITY.commandFlavor,
  FI: FI_IDENTITY.commandFlavor,
  BR: BR_IDENTITY.commandFlavor,
  SCO: SCO_IDENTITY.commandFlavor,
  WAL: WAL_IDENTITY.commandFlavor,
};

/** How the board names the viewer's alignment, from the live bloc roll. */
export const BLOC_BOARD_NAME: Record<Bloc, string> = {
  west: "WESTERN BLOC",
  east: "EASTERN BLOC",
  nonAligned: "NON-ALIGNED",
};

/**
 * Homeland / reserve — the always-valid location a unit sits at when not committed
 * to a conflict. The one location constant that survives the dynamic-conflict move;
 * every other location is a live conflict id (see `conflicts` collection).
 */
export const RESERVE_THEATER_ID = "reserve";

/** A unit deployed to a Conflict (any non-reserve theater) is engaged, not garrisoned. */
export function isAtConflict(theaterId: string): boolean {
  return theaterId !== RESERVE_THEATER_ID;
}

/**
 * A valid location for a unit or a general posting: homeland reserve (always) or a
 * live conflict. The dynamic replacement for `isValidTheaterId`'s static-set check —
 * conflicts are created during play, so validity is a DB question, not a constant.
 */
export async function isValidUnitLocation(db: Db, id: string): Promise<boolean> {
  return id === RESERVE_THEATER_ID || (await conflictExists(db, id));
}

/**
 * The posture a unit must hold given where it sits: a unit deployed to a Conflict
 * cannot be Garrison — it floors up to Standard. Forces UP only; a unit returning to
 * reserve keeps whatever posture it had. `garrison` is the only sub-Standard posture,
 * so this is the whole floor.
 */
export function postureFloorFor(theaterId: string, posture: Posture): Posture {
  return isAtConflict(theaterId) && posture === "garrison" ? "standard" : posture;
}

/** Cohesion → supply multiplier applied to every committed force (design supplyMult). */
export function supplyMult(cohesion: number): number {
  return Math.round((0.5 + 0.5 * (cohesion / 100)) * 100) / 100;
}

export interface Defcon {
  level: number;
  color: string;
  note: string;
}
export function defconFor(cohesion: number): Defcon {
  if (cohesion >= 85)
    return { level: 2, color: "#ef8a8a", note: "full commitment · escalation risk" };
  if (cohesion >= 65) return { level: 3, color: "#d4af37", note: "heightened" };
  return { level: 4, color: "#86d978", note: "forces withheld" };
}
