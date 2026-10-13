/**
 * NPP engine 6.7: an NPP government whips its own program (v6).
 *
 * Below v6 an NPP government's own members back its bills only through the
 * default party-line lean, the same pull any co-partisan bill gets. At v6 an
 * NPP-led government (head of government is an NPP) puts a soft whip on its
 * members for the bills it sponsored to serve one of its standing goals.
 *
 * Bounds, so this never overrides a person:
 *   - only where no whip already applies (an explicit whip always wins);
 *   - only when the governing party has no player chair or vice-chair;
 *   - only NPP members of the governing party, only NPP-sponsored bills of that
 *     party, only bills whose policy domain carries a standing goal;
 *   - a soft whip, the weaker of the two modes, scaled by each member's own
 *     loyalty and stubbornness exactly like any other whip.
 */

export interface NppGovernmentWhip {
  governingPartyId: string;
  /** Lower-cased policy domains carrying a standing goal. */
  goalDomains: ReadonlySet<string>;
}

/** The whip context for a formed government, or null when it must not whip. */
export function nppGovernmentWhipFor(params: {
  governingPartyId: string | null | undefined;
  /** True when the head of government is an NPP and no player holds the post. */
  nppLed: boolean;
  /** True when a player chairs or vice-chairs the governing party. */
  partyPlayerLed: boolean;
  goalDomains: Iterable<string> | undefined;
}): NppGovernmentWhip | null {
  if (!params.governingPartyId || !params.nppLed || params.partyPlayerLed) return null;
  const domains = new Set([...(params.goalDomains ?? [])].map((d) => d.toLowerCase()));
  if (domains.size === 0) return null;
  return { governingPartyId: params.governingPartyId, goalDomains: domains };
}

/** Whether the government's soft whip applies to this member on this bill. */
export function governmentWhipApplies(
  whip: NppGovernmentWhip | null | undefined,
  bill: { nppSponsored?: boolean; sponsorParty?: string },
  memberParty: string | undefined,
  policyDomain: string | undefined
): boolean {
  if (!whip || !bill.nppSponsored) return false;
  if (bill.sponsorParty !== whip.governingPartyId || memberParty !== whip.governingPartyId) {
    return false;
  }
  return !!policyDomain && whip.goalDomains.has(policyDomain.toLowerCase());
}
