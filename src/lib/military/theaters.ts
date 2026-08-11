// Proxy-theater combat-power model for the Conflicts board (World Situation
// Board), ported from the design's Conflicts.dc.html. Pure data + logic; shares
// the theater set with Combat Command. The UI persists commitment state to the
// per-country `theaterState` collection via the gated theaters PUT.

import type { Db } from "mongodb";
import type { Posture } from "@/lib/db/types/militaryUnit";
import type { Bloc } from "@/lib/military/bloc";
import { conflictExists } from "@/lib/db/collections/conflicts";

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

const WEST_ACC = "#9cc0f5";
const EAST_ACC = "#f0a0a0";
const NEUTRAL_ACC = "#86d978";

/** Fallback dressing for a nation with no entry of its own. */
export const DEFAULT_COMMAND_FLAVOR: CountryCommandFlavor = {
  glyph: "??",
  command: "GENERAL STAFF",
  strip: "◆ RESTRICTED · ACTIVE THEATERS",
  acc: NEUTRAL_ACC,
};

export const COUNTRY_COMMAND_FLAVOR: Record<string, CountryCommandFlavor> = {
  US: {
    glyph: "US",
    command: "JOINT CHIEFS OF STAFF",
    strip: "◆ EYES ONLY · ACTIVE THEATERS",
    acc: WEST_ACC,
  },
  UK: {
    glyph: "UK",
    command: "DEFENCE STAFF",
    strip: "◆ UK EYES ONLY · ACTIVE THEATERS",
    acc: WEST_ACC,
  },
  IE: { glyph: "IE", command: "DEFENCE FORCES HQ", strip: "◆ RESTRICTED", acc: NEUTRAL_ACC },
  DE: {
    glyph: "DE",
    command: "BUNDESWEHR COMMAND",
    strip: "◆ NUR FÜR DEN DIENSTGEBRAUCH",
    acc: "#d4af37",
  },
  DD: {
    glyph: "DD",
    command: "NATIONALE VOLKSARMEE",
    strip: "◆ VERTRAULICHE VERSCHLUSSSACHE",
    acc: EAST_ACC,
  },
  JP: { glyph: "日", command: "JOINT STAFF", strip: "◆ 機密 · ACTIVE THEATERS", acc: "#f0a0a0" },
  NG: { glyph: "NG", command: "DEFENCE HEADQUARTERS", strip: "◆ RESTRICTED", acc: NEUTRAL_ACC },
  RU: {
    glyph: "RU",
    command: "GENERAL STAFF",
    strip: "◆ СЕКРЕТНО · ACTIVE THEATERS",
    acc: EAST_ACC,
  },
  CN: { glyph: "中", command: "CENTRAL MILITARY COMMISSION", strip: "◆ 机密", acc: "#e0b352" },
  PL: { glyph: "PL", command: "SZTAB GENERALNY", strip: "◆ TAJNE", acc: EAST_ACC },
  CS: { glyph: "CS", command: "GENERÁLNÍ ŠTÁB", strip: "◆ PŘÍSNĚ TAJNÉ", acc: EAST_ACC },
  HU: { glyph: "HU", command: "VEZÉRKAR", strip: "◆ SZIGORÚAN TITKOS", acc: EAST_ACC },
  RO: { glyph: "RO", command: "MARELE STAT MAJOR", strip: "◆ STRICT SECRET", acc: EAST_ACC },
  BG: { glyph: "BG", command: "ГЕНЕРАЛЕН ЩАБ", strip: "◆ СТРОГО СЕКРЕТНО", acc: EAST_ACC },
  BLR: { glyph: "BY", command: "GENERAL STAFF", strip: "◆ СЕКРЕТНО", acc: EAST_ACC },
  UKR: { glyph: "UA", command: "KYIV MILITARY DISTRICT", strip: "◆ СЕКРЕТНО", acc: EAST_ACC },
  BAL: { glyph: "BA", command: "BALTIC COMMAND", strip: "◆ СЕКРЕТНО", acc: EAST_ACC },
  YU: { glyph: "YU", command: "GENERALŠTAB", strip: "◆ DRŽAVNA TAJNA", acc: NEUTRAL_ACC },
  FR: { glyph: "FR", command: "ÉTAT-MAJOR DES ARMÉES", strip: "◆ SECRET DÉFENSE", acc: WEST_ACC },
  IT: { glyph: "IT", command: "STATO MAGGIORE DIFESA", strip: "◆ SEGRETO", acc: WEST_ACC },
  ES: { glyph: "ES", command: "ESTADO MAYOR DE LA DEFENSA", strip: "◆ SECRETO", acc: NEUTRAL_ACC },
  SE: { glyph: "SE", command: "FÖRSVARSMAKTEN", strip: "◆ HEMLIG", acc: NEUTRAL_ACC },
  TR: { glyph: "TR", command: "GENELKURMAY", strip: "◆ ÇOK GİZLİ", acc: WEST_ACC },
  GR: { glyph: "GR", command: "ΓΕΝΙΚΟ ΕΠΙΤΕΛΕΙΟ", strip: "◆ ΑΠΟΡΡΗΤΟ", acc: WEST_ACC },
  AT: { glyph: "AT", command: "BUNDESHEER", strip: "◆ VERSCHLUSSSACHE", acc: NEUTRAL_ACC },
  FI: { glyph: "FI", command: "PÄÄESIKUNTA", strip: "◆ SALAINEN", acc: NEUTRAL_ACC },
  BR: { glyph: "BR", command: "ESTADO-MAIOR CONJUNTO", strip: "◆ SECRETO", acc: NEUTRAL_ACC },
  SCO: { glyph: "SC", command: "DEFENCE STAFF", strip: "◆ RESTRICTED", acc: NEUTRAL_ACC },
  WAL: { glyph: "WA", command: "DEFENCE STAFF", strip: "◆ RESTRICTED", acc: NEUTRAL_ACC },
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
