/** Constitutional consent is distinct from economic/social policy alignment.
 * A public Yes mandate supplies a modest default; a party's declared stance
 * dominates it. Normal whips still enter through the shared force composer.
 */
export function constitutionalConsentForce(
  snapshot:
    | { yesShare: number; partyPositions: Array<{ partyId: string; side: "yes" | "no" }> }
    | undefined,
  partyId: string
): number {
  if (!snapshot) return 0;
  const stance = snapshot.partyPositions.find((p) => p.partyId === partyId)?.side;
  return (snapshot.yesShare > 50 ? 10 : -10) + (stance === "yes" ? 30 : stance === "no" ? -30 : 0);
}
