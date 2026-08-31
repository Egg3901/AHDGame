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
