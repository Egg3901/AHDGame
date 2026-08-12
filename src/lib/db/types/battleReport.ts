import type { ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { WorldEntityId } from "@/lib/world/worldEntityManifest";
import type { PvpBattleResult } from "@/lib/military/battle";

/**
 * The record of a resolved (or fizzled) offensive at a theater. `result` is null
 * when the target had no forces present (`noContact`). Read by both nations'
 * War Rooms.
 */
export interface BattleReportDoc {
  _id: ObjectId;
  theaterId: string;
  /** Principal attacker — the earliest declaration in a merged offensive. */
  declarerCountry: CountryId;
  /**
   * Principal defender — whoever the principal declaration named.
   *
   * A `WorldEntityId`, matching `BattleDeclarationDoc.targetCountry`: in a proxy
   * war the named enemy is a FACTION with no `COUNTRY_CONFIGS` row, and this field
   * is copied straight from the declaration. The insert casts through `as never`,
   * so nothing would have caught the mismatch.
   */
  targetCountry: WorldEntityId;
  /**
   * Every country that fought on the attacking side, principal first. Absent on
   * reports written before coalitions existed; readers must fall back to the scalar.
   */
  attackers?: CountryId[];
  /** Every country that fought on the defending side. Absent on pre-coalition docs. */
  defenders?: CountryId[];
  turn: number;
  result: PvpBattleResult | null;
  noContact?: boolean;
  /** Set on a no-contact report where the front still moved — an unopposed advance. */
  unopposedAdvance?: boolean;
  /**
   * Share of the host held by side B before and after this engagement.
   *
   * The report used to record only casualties, so a player who won had no way to
   * see what winning had achieved. Absent on reports written before this existed;
   * readers must treat that as "unknown", not as "no ground moved".
   */
  controlBefore?: number;
  controlAfter?: number;
}
