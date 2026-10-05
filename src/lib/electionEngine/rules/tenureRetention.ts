/** Select office-specific personal-stat tenure retention using vote-tally identity rules.
 * Missing or unmatched tenure context leaves the candidate unchanged.
 */
import { legislativeTenureTermsHeld, personalStatTenureRetention } from "../electionFormulaFactors";

export interface PersonalStatTenureContext {
  executivePartyId?: string;
  executiveConsecutiveTerms?: number;
  legislativePartyId?: string;
  /** Senate's stored count includes the term being sought. */
  legislativeTenureTermsSought?: number;
  houseTenureTermsByCandidateId?: ReadonlyMap<string, number>;
}

export interface TenureCandidateIdentity {
  candidateId: string;
  partyId?: string;
}

export function personalStatTenureRetentionForCandidate(
  candidate: TenureCandidateIdentity,
  context: PersonalStatTenureContext | undefined
): number {
  if (!context) return 1;
  if (context.executivePartyId != null && candidate.partyId === context.executivePartyId) {
    return personalStatTenureRetention(context.executiveConsecutiveTerms);
  }
  if (context.legislativePartyId != null && candidate.partyId === context.legislativePartyId) {
    return personalStatTenureRetention(
      legislativeTenureTermsHeld(context.legislativeTenureTermsSought)
    );
  }
  const houseTerms = context.houseTenureTermsByCandidateId?.get(candidate.candidateId);
  return houseTerms == null ? 1 : personalStatTenureRetention(houseTerms);
}
