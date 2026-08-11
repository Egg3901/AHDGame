import type { OrgMemberId } from "@/lib/db/types/internationalOrganization";
import type {
  OrganizationResolutionType,
  ProposalVoteRecord,
} from "@/lib/db/types/internationalOrganization";

export interface ResolutionPassageInput {
  type: OrganizationResolutionType;
  /** Current members of the host org. */
  /** Entity ids of the members whose votes count. */
  members: OrgMemberId[];
  /** For `free_trade_agreement`: the named parties the FTA binds. */
  /** Entity ids named as parties to an FTA. */
  parties: OrgMemberId[];
  /** Deduped votes (use `dedupeOrganizationVotes` before calling). */
  votes: ProposalVoteRecord[];
  /**
   * Members with a veto (UN's permanent five in this game). A permanent member
   * voting "no" blocks a majority resolution outright. Empty for orgs without
   * permanent members (everything but the UN). Does not apply to FTAs, which
   * already require unanimity among their parties.
   */
  permanentMembers?: OrgMemberId[];
}

/**
 * Decide whether a resolution passes at its close turn.
 *
 * - `free_trade_agreement`: unanimous "yes" from every named party (an FTA binds
 *   only its parties; non-party members have no vote). Matches the legacy rule.
 * - all other types: simple majority of host-org members voting — yes > no and
 *   yes > 0. Abstain / no-vote count as non-approval; non-member votes ignored.
 *
 * Phase 2 extends this with the UN permanent-member veto via an added optional
 * parameter; keep the FTA + majority cores intact when doing so.
 */
export function resolutionPasses(input: ResolutionPassageInput): boolean {
  if (input.type === "free_trade_agreement") {
    // Votes only ever come from voting members, but parties are entity-keyed.
    const yesParties = new Set<string>(
      input.votes.filter((v) => v.vote === "yes").map((v) => v.countryId)
    );
    return input.parties.length > 0 && input.parties.every((p) => yesParties.has(p));
  }

  const memberSet = new Set<string>(input.members);
  const vetoSet = new Set<string>(input.permanentMembers ?? []);
  let yes = 0;
  let no = 0;
  for (const v of input.votes) {
    if (!memberSet.has(v.countryId)) continue;
    // A permanent member's "no" is a veto — blocks regardless of the tally.
    if (v.vote === "no" && vetoSet.has(v.countryId)) return false;
    if (v.vote === "yes") yes++;
    else if (v.vote === "no") no++;
  }
  return yes > no && yes > 0;
}
