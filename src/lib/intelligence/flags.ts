import type { Db } from "mongodb";
import type { GameState } from "@/lib/db/types/gameState";

/**
 * The admin switch deciding whether NPP countries run intelligence OPERATIONS.
 *
 * Fails closed, for the same reason the NPP offensive switches do: a world that
 * has never been configured must not start running espionage against its
 * players. A non-boolean legacy value (a stored `"true"`, say) is off.
 *
 * This gates INITIATIVE only. NPP counter-intelligence posture is derived every
 * turn regardless of this switch, because defence needs no order: a country
 * whose government is not played still resists being spied on.
 */
export function nppIntelligenceFlagFrom(value: unknown): boolean {
  return value === true;
}

export async function readNppIntelligenceEnabled(db: Db): Promise<boolean> {
  const state = await db
    .collection<GameState>("gameState")
    .findOne({ _id: "current" }, { projection: { nppIntelligenceOperationsEnabled: 1 } });
  return nppIntelligenceFlagFrom(state?.nppIntelligenceOperationsEnabled);
}

/**
 * Whether a successful military covert action has real effects.
 *
 * Fails closed, and for a different reason than the NPP switch: the magnitudes
 * are a balance change whose simulation report could not be produced against a
 * live world with no engaged front. Shipping the effects on unverified numbers
 * is exactly what the balance gate exists to prevent.
 */
export function militarySabotageFlagFrom(value: unknown): boolean {
  return value === true;
}

export async function readMilitarySabotageEnabled(db: Db): Promise<boolean> {
  const state = await db
    .collection<GameState>("gameState")
    .findOne({ _id: "current" }, { projection: { intelligenceMilitarySabotageEnabled: 1 } });
  return militarySabotageFlagFrom(state?.intelligenceMilitarySabotageEnabled);
}
