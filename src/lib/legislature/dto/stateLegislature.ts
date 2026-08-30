import type { ProvisionDisplay } from "@/lib/legislature/provisionEnrichment";
import type { VoteShiftPreview } from "@/lib/legislature/voteShiftPreview";

export interface LegislatureData {
  state: {
    id: string;
    name: string;
    totalSeats: number;
    filledSeats: number;
  };
  composition: Record<
    string,
    { seats: number; color: string; name: string; economicPosition: number; countryId?: string }
  >;
  officials: Array<{
    id: string;
    characterId?: string;
    characterName?: string;
    party?: string;
    partyName?: string;
    partyColor?: string;
    countryId: string;
    seatsHeld: number;
    isNPP: boolean;
    nppId?: string;
    sequentialId?: number;
    avatarUrl?: string | null;
  }>;
  governor: {
    characterId?: string;
    characterName?: string;
    sequentialId?: number;
    party?: string;
  } | null;
}

/**
 * One resolved provision on a regional bill page.
 *
 * An alias of the shared {@link ProvisionDisplay}: the regional and national
 * pages emit the same shape so they cannot drift apart again. Kept as a named
 * type so existing importers do not have to change.
 */
export type BillProvisionDisplay = ProvisionDisplay;

export interface StateBillDisplay {
  id: string;
  title: string;
  summary: string;
  adminProposed?: boolean;
  sponsorId?: string | null;
  sponsorSequentialId?: number;
  sponsorName: string;
  sponsorParty?: string;
  sponsorPartyColor?: string;
  status: string;
  votesFor: number;
  votesAgainst: number;
  votesAbstain: number;
  legislationTypeName?: string | null;
  proposedAt: string;
  votingEndsAt?: string;
  votingEndsOnTurn?: number;
  governorActionDeadline?: string;
  governorActionDeadlineOnTurn?: number;
  overrideVotingEndsAt?: string;
  overrideVotingEndsOnTurn?: number;
  myVote?: "for" | "against" | "abstain" | null;
  /** What the viewer's Aye and Nay would each do to their positions; null for spectators. */
  voteShiftPreview?: VoteShiftPreview | null;
  provisions?: BillProvisionDisplay[];
  /** Truthy when the bill carries a public veto message; UI renders 💬 indicator. */
  hasVetoMessage?: boolean;
}

export interface LegislationPolicyOption {
  id: string;
  name: string;
  explanation?: string;
  stance: "left" | "center" | "right";
  effectDirection: -1 | 0 | 1;
  economic: number;
  social: number;
  /** @deprecated Use archetypeApprovals instead */
  groupApprovals?: Record<string, number>;
  archetypeApprovals?: Record<string, number>;
}

export interface EffectTargetWeighted {
  metricCategoryId: string;
  metricId: string;
  weight: number;
}

export interface LegislationTypeOption {
  _id: string;
  name: string;
  description: string;
  explanation?: string;
  policyDomain: string;
  subCategory: string;
  policyOptions?: LegislationPolicyOption[];
  effectTargetsWeighted?: EffectTargetWeighted[];
  /** New-gen political-legislation targets (US/UK/RU/DD). Drives LawProvisionComparison. */
  politicalMetricTargets?: { metricId: string; weight: number }[];
  /** Per-level fiscal estimates attached by the legislation-types API for new-gen laws. */
  estimates?: Array<{ level: number; cost: number; revenue: number; net: number }>;
  /** Tax-slider laws: live current rate + bounds from the legislation-types API. */
  taxSliderEstimate?: {
    minRate: number;
    maxRate: number;
    step: number;
    baselineRate: number;
    currentRate: number;
    waypoints: Array<{ rate: number; label: string }>;
    revenueDeltaPerPoint: number;
  };
  /** GDP at the priced scope (national or regional), for %GDP annotations. */
  estimatesGdp?: number;
  /** Set by the era-gated legislation-types API for types unlocked this era. */
  eraNew?: boolean;
}

/** Default strings; for `passed`, prefer `getStateBillStatusDisplayLabel` for country-aware copy. */
export const STATUS_LABELS: Record<string, string> = {
  active: "Voting",
  passed: "Awaiting Governor",
  signed: "Signed",
  enacted: "Enacted",
  vetoed: "Vetoed",
  veto_override: "Override Vote",
  override_failed: "Override Failed",
  failed: "Failed",
};

export const METRIC_NAMES: Record<string, string> = {
  unemploymentRate: "Unemployment",
  medianIncome: "Income",
  gdpGrowth: "GDP Growth",
  povertyRate: "Poverty",
  costOfLiving: "Cost of Living",
  uninsuredRate: "Uninsured",
  affordabilityIndex: "Healthcare Costs",
  physicianRate: "Physicians",
  lifeExpectancy: "Life Expectancy",
  preventableMortality: "Prev. Mortality",
  highSchoolGradRate: "HS Graduation",
  universityEnrollment: "University Enrollment",
  crimeRate: "Crime",
  violentCrimeRate: "Violent Crime",
  carbonEmissions: "Emissions",
  renewableEnergy: "Renewables",
  homelessnessRate: "Homelessness",
  foodInsecurity: "Food Insecurity",
  incomeInequality: "Inequality",
  socialMobility: "Social Mobility",
  roadCondition: "Roads",
  broadbandAccess: "Broadband",
  publicTransit: "Transit",
  budgetBalance: "Budget",
};

// Re-export shared MAX_PROVISIONS so state legislature components use the single source of truth.
export { MAX_PROVISIONS } from "@shared/constants/legislation";

export function getEconomicLabel(value: number): string {
  if (value <= -3) return "Far Left";
  if (value <= -1) return "Left";
  if (value === 0) return "Center";
  if (value <= 2) return "Right";
  return "Far Right";
}

export function getSocialLabel(value: number): string {
  if (value <= -3) return "Progressive";
  if (value <= -1) return "Liberal";
  if (value === 0) return "Moderate";
  if (value <= 2) return "Conservative";
  return "Traditionalist";
}
