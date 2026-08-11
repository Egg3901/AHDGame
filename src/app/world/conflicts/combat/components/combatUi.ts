import { generalMods, type ProfileGeneral } from "@/lib/military/generalsTree";
import { combatValue, effPower, effUpkeep, type CombatUnit } from "@/lib/military/combat";
import type { NatMods } from "@/lib/military/doctrineTree";
import { countryScale } from "@/lib/military/force";
import { generalLeadingUnit } from "@/lib/military/assignments";
import type { CombatState } from "../useCombatState";

/**
 * The general commanding a unit, if any. Mirrors the server rule: a unit is led by
 * its assigned general, at the front that general is posted to.
 */
export function genOf(state: CombatState, u: CombatUnit): ProfileGeneral | null {
  const gid = generalLeadingUnit(state.conflictAssignments, u.assignedGeneralId, u.theaterId);
  return gid ? (state.generalsById[gid] ?? null) : null;
}
export function unitCV(state: CombatState, u: CombatUnit, nm: NatMods): number {
  return combatValue(u, nm, generalMods(genOf(state, u)));
}
export function unitUpkeep(state: CombatState, u: CombatUnit, nm: NatMods): number {
  return effUpkeep(u, nm, generalMods(genOf(state, u)), countryScale(state.country));
}
export function unitPower(u: CombatUnit): number {
  return effPower(u);
}
export function readyColor(r: number): string {
  return r >= 70 ? "#86d978" : r >= 50 ? "#d4af37" : "#ef8a8a";
}
export function fmtM(m: number): string {
  const v = m * 1e6;
  const a = Math.abs(v);
  if (a >= 1e9) return "$" + (v / 1e9).toFixed(1) + "B";
  if (a >= 1e6) return "$" + (v / 1e6).toFixed(0) + "M";
  return "$" + Math.round(v).toLocaleString("en-US");
}
