/**
 * Challenger supply fills empty races from existing NPPs. Only non-player
 * countries may generate free replacements; player presidential races stay
 * reserved for players. See getChallengerSupplyPolicy.
 */
export function getChallengerSupplyPolicy(
  access: { registered: boolean; enabledForPlayers: boolean } | undefined,
  electionType: string
): { canReuse: boolean; canGenerate: boolean } {
  if (!access?.registered) return { canReuse: false, canGenerate: false };
  if (access.enabledForPlayers) {
    return { canReuse: electionType !== "president", canGenerate: false };
  }
  return { canReuse: true, canGenerate: true };
}
