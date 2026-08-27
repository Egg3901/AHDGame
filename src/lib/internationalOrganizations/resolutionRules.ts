import type { OrgMemberId } from "@/lib/db/types/internationalOrganization";
import type {
  OrganizationResolutionType,
  ProposalVoteRecord,
} from "@/lib/db/types/internationalOrganization";

/**
 * Every ballot an organisation runs: the resolution types, plus the two
 * instruments that are not resolutions but are decided exactly the same way —
 * admitting a member and electing the chair.
 */
export type OrgBallotKind =
  OrganizationResolutionType | "membership_proposal" | "leadership_election";

/**
 * Ballots that need every eligible voter to vote "yes".
 *
 * A trade agreement and an admission bind a member to an obligation it cannot
 * shed cheaply, and entering a war spends its soldiers. None of those should be
 * imposed on a member by the rest of the bloc, so each carries a member-by-member
 * veto. Everything else is ordinary bloc business and carries on a majority.
 */
const UNANIMOUS_KINDS: ReadonlySet<OrgBallotKind> = new Set<OrgBallotKind>([
  "free_trade_agreement",
  "join_conflict",
  "membership_proposal",
]);

/** Whether `kind` needs the whole roll rather than a majority of it. */
export function requiresUnanimity(kind: OrgBallotKind): boolean {
  return UNANIMOUS_KINDS.has(kind);
}

/**
 * Yes votes needed to carry `kind` across a ballot of `ballotSize` eligible
 * voters.
 *
 * The denominator is the eligible roll, never the votes actually cast. A member
 * who abstains, or who never shows up, withholds approval exactly as a "no"
 * does. The panels read this too, so the number a player is shown is the number
 * the resolver will apply — the two drifted apart once already.
 */
export function votesNeeded(kind: OrgBallotKind, ballotSize: number): number {
  if (ballotSize <= 0) return 0;
  return requiresUnanimity(kind) ? ballotSize : Math.floor(ballotSize / 2) + 1;
}

/**
 * Whether `yes` votes carry `kind`. A ballot with nobody eligible to vote can
 * never carry: an org with no voting members does not pass things by default.
 */
export function ballotPasses(kind: OrgBallotKind, ballotSize: number, yes: number): boolean {
  if (ballotSize <= 0) return false;
  return yes >= votesNeeded(kind, ballotSize);
}

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
 *   only its parties; non-party members have no vote).
 * - `join_conflict`: unanimous "yes" from the whole voting roll. Calling a bloc
 *   into a war is the one resolution that spends a member's soldiers, so any
 *   member can refuse simply by not consenting.
 * - all other types: more than half the voting roll voting "yes".
 *
 * Abstaining and never voting are non-approval in every case; only an active
 * "yes" counts. Votes from non-members are ignored.
 */
export function resolutionPasses(input: ResolutionPassageInput): boolean {
  if (input.type === "free_trade_agreement") {
    // Votes only ever come from voting members, but parties are entity-keyed.
    const yesParties = new Set<string>(
      input.votes.filter((v) => v.vote === "yes").map((v) => v.countryId)
    );
    const parties = new Set<string>(input.parties);
    const yes = [...parties].filter((p) => yesParties.has(p)).length;
    return ballotPasses("free_trade_agreement", parties.size, yes);
  }

  const memberSet = new Set<string>(input.members);
  const vetoSet = new Set<string>(input.permanentMembers ?? []);
  let yes = 0;
  for (const v of input.votes) {
    if (!memberSet.has(v.countryId)) continue;
    // A permanent member's "no" is a veto — blocks regardless of the tally.
    if (v.vote === "no" && vetoSet.has(v.countryId)) return false;
    if (v.vote === "yes") yes++;
  }
  return ballotPasses(input.type, memberSet.size, yes);
}
