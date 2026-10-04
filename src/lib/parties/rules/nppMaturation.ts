/** Autonomous election entry matures in game time; human control cooldowns remain separate. */
export const CUSTOM_PARTY_MATURATION_TURNS = 48;
export function customPartyMature(
  createdTurn: number | undefined,
  currentTurn: number | undefined,
  matureAtTurn?: number
): boolean | null {
  if (currentTurn != null && matureAtTurn != null) return currentTurn >= matureAtTurn;
  if (createdTurn == null || currentTurn == null) return null;
  return currentTurn - createdTurn >= CUSTOM_PARTY_MATURATION_TURNS;
}
