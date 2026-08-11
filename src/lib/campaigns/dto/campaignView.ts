import { getCampaignCopyForElection } from "@/lib/campaigns/raceFamilyCopy";
import type { CurrencyCode } from "@/lib/constants/currencies";

export interface CampaignUpgrade {
  level: number;
  funds: number;
  actions: number;
  effect: string;
  maintenance?: number;
}

export interface CampaignData {
  id: string;
  electionId: string;
  candidateId: string;
  candidateName: string;
  candidateIsNPP: boolean;
  party: string;
  accessLevel: "owner" | "party" | "public";

  /**
   * True when the campaign is archived (primary loser / withdrawn). It remains
   * viewable as read-only history, but all management actions are rejected
   * server-side; the UI hides the manage controls and shows a concluded banner.
   */
  isArchived: boolean;

  /** Currency the campaign treasury (`funds`, budget, upgrade costs) is denominated in. */
  currencyCode: CurrencyCode;
  /**
   * Anchor→local FX rate for this campaign's currency (local = anchor × fxRate).
   * Lets the client localize anchor-formula previews (e.g. campaign-strength cost).
   */
  fxRate: number;

  funds?: number;
  actions?: number;

  levels: {
    fundraising: number;
    oppositionResearch: number;
    groundGame: number;
    mediaSpending: number;
  };

  managerId: string | null;
  managerName: string | null;

  campaignStrength?: number;

  oppositionTargetId: string | null;
  oppositionTargetName: string | null;

  fogLastUpdated?: string;

  electionInfo: {
    state: string;
    electionType: string;
    cycle: number;
    senateClass: number | null;
    /** Baked LARP year on the linked election doc (null on legacy rows). */
    electionYear: number | null;
    isEnded: boolean;
  } | null;

  partyTreasuryAccess?: {
    partyId: number;
    partyName: string;
    role: "chair" | "viceChair" | "treasurer";
    /** Party treasury in the party's LOCAL home currency (post-Phase-6). */
    treasury: number;
    /** Currency code for `treasury` — format it face-value, no FX conversion. */
    currencyCode: CurrencyCode;
  };

  budget?: {
    income: {
      total: number;
    };
    expenses: {
      groundGameMaintenance: number;
      mediaSpendingMaintenance: number;
      total: number;
    };
    netIncome: number;
    actions: {
      endorsementCount: number;
      /** NET per-turn action gain = gross (base + endorsements) minus rally-tour drain. */
      perTurn: number;
      /** Gross per-turn gain before the rally-tour drain (base + endorsement bonus). */
      grossPerTurn?: number;
      /** Base per-turn actions before endorsements (mirrors the turn engine). */
      baseline?: number;
      /** Actions drained each turn by an active rally tour (0 when none/unaffordable). */
      rallyTourDrain?: number;
    };
    cumulative: {
      totalGenerated: number;
      totalSpent: number;
      actionsGenerated: number;
      actionsSpent: number;
    };
  };
  activityHistory?: Array<{
    type: "upgrade" | "downgrade" | "suspend_endorse";
    category?: string;
    newLevel?: number;
    costFunds?: number;
    costActions?: number;
    targetName?: string;
    reason?: "insolvency" | "migration" | "reset";
    timestamp: string;
    turnNumber: number;
  }>;
  nextUpgradeCosts?: {
    fundraising: CampaignUpgrade | null;
    oppositionResearch: CampaignUpgrade | null;
    groundGame: CampaignUpgrade | null;
    mediaSpending: CampaignUpgrade | null;
  };

  /**
   * Phase B — own candidate's Support snapshot for the rally panel.
   * Fog-of-war: only populated when the viewer has owner access (campaign
   * manager / nominee / admin). Opposing viewers see undefined.
   */
  ownSupport?: {
    /** Current candidate.support value (0..100). */
    support: number;
    /** Total pending Support drips queued from active rallies / tour. */
    pendingDripTotal: number;
    /** Whether the rally tour is currently active for this candidate. */
    rallyTourActive: boolean;
    /** Whether a one-shot rally has been fired this turn (throttle). */
    rallyFiredThisTurn: boolean;
    /** Race-family-scaled R for this race's rally (full value). */
    rallyFullValue: number;
    /** Race-family-scaled action cost of a one-shot rally. */
    rallyOneShotActionCost: number;
    /** Race-family-scaled action cost per tour-tick. */
    rallyTourTickActionCost: number;
  };

  /** Presidential general-election nominee suspended campaigning and endorsed another ticket. */
  campaignSuspended?: boolean;
  suspendedAt?: string | null;
  endorsedCandidate?: { id: string; name: string } | null;
  /** Endorsed nominee withdrew; electoral transfers have stopped. */
  endorsementTargetWithdrawn?: boolean;
  /** Owner-only: suspend-and-endorse affordance during the presidential general. */
  suspendEndorse?: {
    eligible: boolean;
    targets: Array<{ id: string; name: string; party: string }>;
  };
}

export const CAMPAIGN_CATEGORIES = [
  {
    key: "fundraising",
    label: "Fundraising",
    description: "Increase campaign revenue generation",
    tooltipText:
      "Each level adds +$10,000/turn to campaign income. Revenue comes from political influence, personal funds, and fundraising operations.",
    colorClass: "text-amber-400",
    bgClass: "bg-amber-500/10 border-amber-500/20",
    barClass: "bg-amber-400",
    requiresTarget: false,
  },
  {
    key: "oppositionResearch",
    label: "Opposition Research",
    description: "Weaken opponent favorability",
    tooltipText:
      "Each level reduces a target opponent's favorability by -0.5% per turn. You must select a target to research.",
    colorClass: "text-red-400",
    bgClass: "bg-red-500/10 border-red-500/20",
    barClass: "bg-red-400",
    requiresTarget: true,
  },
  {
    key: "groundGame",
    // Phase 5.5 — copy is presidential-default; non-presidential races see
    // race-family-aware wording via getCampaignCategoriesForElection() below.
    label: "Ground Game",
    description: "Boost swing state performance",
    tooltipText:
      "Each level adds +3% performance in swing states. Has ongoing maintenance costs per turn.",
    colorClass: "text-blue-400",
    bgClass: "bg-blue-500/10 border-blue-500/20",
    barClass: "bg-blue-400",
    requiresTarget: false,
  },
  {
    key: "mediaSpending",
    label: "Media Spending",
    description: "Increase overall favorability",
    tooltipText:
      "Each level adds +0.5% favorability per turn to the candidate. Has ongoing maintenance costs per turn.",
    colorClass: "text-purple-400",
    bgClass: "bg-purple-500/10 border-purple-500/20",
    barClass: "bg-purple-400",
    requiresTarget: false,
  },
] as const;

/**
 * Widened shape for the race-family-aware category list. Same fields as
 * `CAMPAIGN_CATEGORIES` entries but with `description` and `tooltipText`
 * widened to plain `string` so localized copy can be substituted in.
 */
export interface CampaignCategoryDisplay {
  key: string;
  label: string;
  description: string;
  tooltipText: string;
  colorClass: string;
  bgClass: string;
  barClass: string;
  requiresTarget: boolean;
}

/**
 * Phase 5.5 — returns the upgrade-category list with the `groundGame`
 * entry's description / tooltipText localized for the election's race
 * family (president → swing states, senate / gov → swing counties,
 * house / stateSenate → swing precincts).
 *
 * Pure function — UI consumers use this when an election is in scope so
 * the displayed copy matches the campaign's actual constituency. Falls
 * back to presidential copy for unknown / missing election types per the
 * adapter's defensive default.
 *
 * See plan §"Phase 5.5 — Decisions Recorded During Execution" D5.
 */
export function getCampaignCategoriesForElection(election: {
  electionType?: string;
}): CampaignCategoryDisplay[] {
  const copy = getCampaignCopyForElection(
    election as Parameters<typeof getCampaignCopyForElection>[0]
  );
  return CAMPAIGN_CATEGORIES.map((cat) => {
    if (cat.key !== "groundGame") {
      return {
        key: cat.key,
        label: cat.label,
        description: cat.description,
        tooltipText: cat.tooltipText,
        colorClass: cat.colorClass,
        bgClass: cat.bgClass,
        barClass: cat.barClass,
        requiresTarget: cat.requiresTarget,
      };
    }
    return {
      key: cat.key,
      label: cat.label,
      description: `Boost ${copy.swingArea} performance`,
      tooltipText: copy.groundGameDescription,
      colorClass: cat.colorClass,
      bgClass: cat.bgClass,
      barClass: cat.barClass,
      requiresTarget: cat.requiresTarget,
    };
  });
}
