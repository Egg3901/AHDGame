import type { InternationalOrganizationId } from "@/lib/constants/internationalOrganizations";
import type { OrgMemberId } from "@/lib/db/types/internationalOrganization";
import type { CountryId } from "@/lib/constants/countries";
import type { OrgIdentity } from "@/lib/constants/orgIdentity";
import type { OrganizationCategory } from "@/lib/constants/orgCategory";
import type { AlertPosture } from "@/lib/constants/orgPosture";
import type { OrgDerived } from "@/lib/internationalOrganizations/orgDerivedMetrics";
import type { BlocWarEntryOperation } from "@/lib/internationalOrganizations/warEntryStatus";
import type {
  OrganizationLegislation,
  OrganizationLeadership,
  OrganizationLeadershipElection,
  OrganizationMembershipProposal,
  PendingOrganizationWithdrawalMeasure,
  ProposalVote,
} from "@/lib/db/types/internationalOrganization";

/** Public summary returned by GET /api/world/international-organizations. */
export interface OrgSummary {
  id: InternationalOrganizationId;
  def: {
    id: InternationalOrganizationId;
    name: string;
    shortName: string;
    description: string;
    logoPath: string | null;
    foundingMembers: CountryId[];
    /** Founding/dissolution window (built-ins only; custom orgs always live). */
    foundedYear?: number;
    dissolvedYear?: number;
    /** Office held ex officio by this country's head of government — no elections. */
    permanentLeadership?: { countryId: CountryId };
    leadership: { title: string; termTurns: number };
    charter: string;
    category: OrganizationCategory;
    isCustom?: boolean;
  };
  members: Array<{
    /** Any entity in the game may be a member, not only a playable country. */
    countryId: OrgMemberId;
    countryName: string;
    flagEmoji: string;
    status: "founding" | "active";
    joinedTurn: number;
    /**
     * Whether this member casts a ballot on an ADMISSION or a BLOC WAR ENTRY —
     * the two where a member consents to someone else's business and its silence
     * blocks. Vote rosters must filter on it.
     */
    hasVote: boolean;
    /**
     * Whether this member casts a ballot on EVERY OTHER instrument — a leadership
     * election, sanctions, aid, dues, a directive, a posture, an agency fund, and
     * a free-trade agreement, which is voted only by its own named parties.
     * Wider than `hasVote` (see the field's doc on the server summary): render
     * the one that matches the ballot, or the tally will disagree with the
     * resolver, which is ticket #1257.
     */
    hasPolicyVote: boolean;
    /** Whether the game models it as a country with a treasury to pay into. */
    isCountry: boolean;
  }>;
  pendingMembershipProposals: OrganizationMembershipProposal[];
  pendingLegislation: OrganizationLegislation[];
  activeLegislation: OrganizationLegislation[];
  pendingWithdrawalMeasures: PendingOrganizationWithdrawalMeasure[];
  leadership: OrganizationLeadership | null;
  pendingLeadershipElections: OrganizationLeadershipElection[];
  /** Per-org accent palette + seal identity (built-in fixed; custom derived). */
  identity: OrgIdentity;
  /** GDP-share derived metrics (contribution %, influence index, standing). */
  derived: OrgDerived;
  /** Pooled treasury: balance in the founding country's currency + dues rate. */
  fund: {
    balanceLocal: number;
    duesRateAnnual: number;
    /**
     * Annual dues the bloc collects at the current rate, in the fund's currency.
     * VOTING members only — the ones who set the rate are the ones who pay it.
     */
    annualDuesLocal: number;
    /** Fixed annual tribute rate; 0 for any org that does not levy it. */
    tributeRateAnnual?: number;
    /**
     * Annual tribute the bloc collects, in the fund's currency. The complement
     * of the dues line: members without a vote, at a rate they do not set.
     */
    annualTributeLocal?: number;
    /** ISO currency code of the founding country (e.g. EUR for the EU). */
    currencyCode: string;
    /** Founding country whose currency the fund uses. */
    currencyCountryId: CountryId;
    /**
     * ₳ (≈ era USD) per one unit of the fund's currency, resolved SERVER-SIDE
     * for the active era (refs #3778). The client must not re-derive this from
     * `COUNTRY_CONFIGS`: those values are modern/1979 and would misprice USD
     * agency-catalog costs in a 1953 world. Optional so older cached payloads
     * and test fixtures degrade to the 1.0 anchor passthrough.
     */
    usdToFundRate?: number;
  };
  /** Security-alliance alert posture (default `standard`); drives the flagship + metric effect. */
  posture: AlertPosture;
  /** Real defense outlay as a % of GDP per member (security flagship 2% pledge). */
  defensePctByCountry: Record<string, number>;
  /** Active military-entry calls, including Warsaw Pact status shown on COMECON. */
  warEntryOperations?: BlocWarEntryOperation[];
}

export interface OrgWorldResponse {
  organizations: OrgSummary[];
  currentTurn: number;
  proposalVotingWindowTurns: number;
  /** Whether bloc alignment is switched on; gates the per-org Influence tab. */
  intOrgAlignmentEnabled?: boolean;
}

export interface OrgViewerInfo {
  characterId: string | null;
  characterName?: string;
  foreignMinisterOf: CountryId | null;
  foreignMinisterCountryName: string | null;
  headOfGovernmentOf: CountryId | null;
  headOfGovernmentCountryName: string | null;
  /** Diplomatic actions the viewer's acting country has left this turn. */
  diplomaticActionsRemaining: number;
  /** Per-turn diplomatic-action cap (cosmetic denominator for the UI chip). */
  diplomaticActionsPerTurn: number;
  /** The country the budget applies to (FM/HoG country), or null if none. */
  diplomaticActionsCountryId: CountryId | null;
}

export const VOTE_LABELS: Record<ProposalVote, string> = {
  yes: "Yes",
  no: "No",
  abstain: "Abstain",
};
