import { getCampaignCopyForElection } from "@/lib/campaigns/raceFamilyCopy";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { Campaign } from "@/lib/db/types";
import type { CampaignStatePresence } from "@/lib/elections/dto/campaignStatePresence";
import type { OppositionTarget } from "@/lib/campaigns/oppositionTargets";
import {
  getEffectiveBranchCost,
  OPS_MAX_BRANCH_LEVEL,
  OPS_TREES,
  type OpsBranchKey,
  type UpgradeCategory,
} from "@/lib/campaigns/upgradeCosts";

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

  /**
   * True when the viewer owns the ticket's running mate. A running mate gets an
   * owner-level VIEW of the ticket campaign, but a narrower set of ACTIONS than
   * a manager/nominee: rally, the fundraising ops lane, and the surrogate panel
   * (canvass-for-ticket + campaign-in-a-state) only. Every other manage control
   * stays manager/nominee-only, client-side and server-side.
   */
  isRunningMate: boolean;
  /**
   * Running-mate surrogate pool snapshot, present only for a running-mate viewer
   * of a presidential ticket. Drives the surrogate panel's shared-cap display.
   */
  runningMateSurrogate?: {
    /** Surrogate actions left today (canvass + state-visit combined). */
    actionsRemaining: number;
    /** Daily cap from the race's frozen presidential ruleset. */
    cap: number;
    /** Human-readable reset cadence hint. */
    resetHint: string;
  };

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
  /**
   * Every appointed campaign manager (up to MAX_CAMPAIGN_MANAGERS), resolved to
   * character id + name. Empty when none are set. The legacy single manager is
   * folded in, so this is the canonical list to render.
   */
  managers: Array<{ characterId: string; name: string }>;
  /** The viewer may appoint/remove managers (nominee or admin, non-archived). */
  canAppointManagers: boolean;

  campaignStrength?: number;

  /**
   * Presidential tickets: the named running mate, resolved from the candidate's
   * `runningMateId`. Carried here so the campaign board can show and change the
   * ticket without pulling the whole election payload. Null when none is named.
   */
  runningMateName?: string | null;
  runningMateCharacterId?: string | null;

  oppositionTargetId: string | null;
  oppositionTargetName: string | null;
  /**
   * Who this campaign may research, already scoped to the race and its phase.
   *
   * Sent rather than searched: the picker used to query every character in the
   * game, so it offered targets the server would refuse and hid the rule that
   * decides them. Only the manager or nominee can retarget, so only they get
   * the list.
   */
  oppositionTargets?: OppositionTarget[];

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

  /**
   * Where the candidate is campaigning and what it costs to move.
   *
   * Present only for the candidate's own view of a live US presidential race:
   * travelling and camping spend that character's actions, so nobody else has
   * anything to press. Null everywhere else.
   */
  statePresence?: CampaignStatePresence | null;

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
   * Strategic Operations v2 — per-lever branch-tree view for the owner UI.
   * Owner-only (undefined for non-owner viewers). Each lever carries its
   * current tree state plus localized next-tier costs, so the ops modal can
   * render the starter node + three branch sub-tracks without recomputing
   * costs client-side. Costs share the server's family-scalar + general-phase
   * surcharge (via `getEffectiveBranchCost`).
   */
  opsTrees?: Record<UpgradeCategory, OpsTreeView>;

  /**
   * Campaign-room briefing — an owner-only, READ-ONLY strategic digest that
   * composes data the election engine / vote tally already produced. It never
   * recomputes vote math. Present only for owner-access viewers (nominee /
   * managers / running mate) on a non-archived campaign; `undefined` for every
   * non-owner, so the coalition-weakness intel a rival must not see stays behind
   * the same fog-of-war wall as the exact levels.
   */
  briefing?: CampaignBriefing;

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

/**
 * Presidential-primary path to victory: pledged-delegate math the primary
 * stagger phase already awarded (`tally.primaryDelegates`), plus the majority
 * threshold from the delegate helpers. Nothing here is recomputed — it reads
 * the stored counts.
 */
export interface BriefingDelegatePath {
  kind: "delegate";
  /** Delegates the owner candidate has already been awarded. */
  won: number;
  /** Majority threshold to clinch the nomination. */
  needed: number;
  /** Delegates still required (clamped at 0 once clinched). */
  remaining: number;
  /** Delegate leaders in the owner's party, strongest first. */
  leaders: { candidateId: string; name: string; delegates: number }[];
}

/**
 * Presidential-general path to victory: electoral-vote standing plus the
 * closest states, derived from the tally's per-unit vote totals via the
 * existing general-election view model. Descriptive only.
 */
export interface BriefingTippingPath {
  kind: "tipping";
  /** Electoral votes the owner candidate currently leads. */
  evHave: number;
  /** Electoral-college majority for the live apportionment. */
  evNeeded: number;
  /** Closest states by popular-vote margin, closest first. */
  tippingStates: { stateId: string; name: string; marginPp: number }[];
}

/**
 * A census bucket where the owner candidate is weakest, read straight from the
 * factor ledger's per-bucket appeal share. Buckets, never archetypes.
 */
export interface BriefingCoalitionBucket {
  /** Census bucket key ("dimension:bucket", e.g. "race:white"). */
  bucket: string;
  /** Share of the candidate's appeal contributed by this bucket. */
  appealShare: number;
  /**
   * Share of this bucket's appeal, across the whole field, that the candidate
   * holds. This is what "weak" is ranked on: a bucket where you hold little of
   * the group is one you are losing, whereas `appealShare` alone ranks small
   * groups last however well you are doing in them.
   */
  bucketShare: number;
  /** Contribution-weighted mean economic lean of the bucket. */
  demoEP: number;
  /** Contribution-weighted mean social lean of the bucket. */
  demoSP: number;
}

export interface CampaignBriefing {
  /**
   * Path to victory. Delegate math in the primary phase, tipping-point EV math
   * in the general phase. Absent for races / phases where neither applies
   * (e.g. a down-ballot campaign, or a presidential race with no tally yet).
   */
  path?: BriefingDelegatePath | BriefingTippingPath;
  /**
   * Treasury runway: how many turns the current balance lasts at the current
   * net burn. `turnsOfRunway` is null when net income is non-negative (no burn,
   * so the runway is effectively unbounded).
   */
  cashRunway: { funds: number; netPerTurn: number; turnsOfRunway: number | null };
  /**
   * The owner candidate's weakest census buckets, weakest first. Empty for
   * non-presidential races or before the ledger is first teed.
   */
  coalitionWeakness: BriefingCoalitionBucket[];
}

export interface OpsBranchCostView {
  funds: number;
  actions: number;
  effect: string;
  maintenance?: number;
  lumpSum?: number;
}

export interface OpsBranchView {
  key: OpsBranchKey;
  label: string;
  description: string;
  effectType: string;
  level: number;
  maxLevel: number;
  /** Localized next-tier cost, or null when the branch is maxed. */
  next: OpsBranchCostView | null;
}

export interface OpsTreeView {
  /** Whether the tier-1 starter is unlocked. */
  unlocked: boolean;
  /** Localized starter cost — present only while locked. */
  starterCost: OpsBranchCostView | null;
  starterEffect: string;
  requiresTarget: boolean;
  branches: OpsBranchView[];
}

/**
 * Build the owner-only ops-tree view for one lever, localizing anchor costs
 * into the campaign's currency via `toLocal`. Mirrors the server purchase gate:
 * a locked lever exposes only its `starterCost`; an unlocked lever exposes each
 * branch's next-tier cost (null when maxed).
 */
export function buildOpsTreeView(
  category: UpgradeCategory,
  tree: { starter: boolean; a: number; b: number; c: number } | undefined,
  requiresTarget: boolean,
  electionType: string | undefined,
  isGeneralPhase: boolean,
  toLocal: (anchor: number) => number
): OpsTreeView {
  const def = OPS_TREES[category];
  const unlocked = !!tree?.starter;
  const localizeCost = (
    c: {
      funds: number;
      actions: number;
      effect: string;
      maintenance?: number;
      lumpSum?: number;
    } | null
  ): OpsBranchCostView | null =>
    c == null
      ? null
      : {
          funds: Math.round(toLocal(c.funds)),
          actions: c.actions,
          effect: c.effect,
          ...(c.maintenance != null ? { maintenance: Math.round(toLocal(c.maintenance)) } : {}),
          // lumpSum is currency for income branches, a raw % for oppo — the
          // effect string already conveys the % so only localize the currency
          // (income) case; oppo lumpSum is left off the view (shown via effect).
          ...(c.lumpSum != null && category === "fundraising"
            ? { lumpSum: Math.round(toLocal(c.lumpSum)) }
            : {}),
        };

  return {
    unlocked,
    starterEffect: def.starter.effect,
    requiresTarget,
    starterCost: unlocked
      ? null
      : localizeCost(getEffectiveBranchCost(category, null, 0, electionType, isGeneralPhase)),
    branches: def.branches.map((b) => {
      const level = tree ? tree[b.key] : 0;
      const next =
        unlocked && level < OPS_MAX_BRANCH_LEVEL
          ? getEffectiveBranchCost(category, b.key, level + 1, electionType, isGeneralPhase)
          : null;
      return {
        key: b.key,
        label: b.label,
        description: b.description,
        effectType: b.effectType,
        level,
        maxLevel: OPS_MAX_BRANCH_LEVEL,
        next: localizeCost(next),
      };
    }),
  };
}

/**
 * Build every lever's ops-tree view for a campaign (owner surface).
 */
export function buildOpsTrees(
  campaign: Pick<
    Campaign,
    "fundraisingTree" | "oppositionResearchTree" | "groundGameTree" | "mediaSpendingTree"
  >,
  electionType: string | undefined,
  isGeneralPhase: boolean,
  toLocal: (anchor: number) => number
): Record<UpgradeCategory, OpsTreeView> {
  return {
    fundraising: buildOpsTreeView(
      "fundraising",
      campaign.fundraisingTree,
      false,
      electionType,
      isGeneralPhase,
      toLocal
    ),
    oppositionResearch: buildOpsTreeView(
      "oppositionResearch",
      campaign.oppositionResearchTree,
      true,
      electionType,
      isGeneralPhase,
      toLocal
    ),
    groundGame: buildOpsTreeView(
      "groundGame",
      campaign.groundGameTree,
      false,
      electionType,
      isGeneralPhase,
      toLocal
    ),
    mediaSpending: buildOpsTreeView(
      "mediaSpending",
      campaign.mediaSpendingTree,
      false,
      electionType,
      isGeneralPhase,
      toLocal
    ),
  };
}

export const CAMPAIGN_CATEGORIES = [
  {
    key: "fundraising",
    label: "Fundraising",
    description: "Increase campaign revenue generation",
    tooltipText:
      "Unlock a fundraising operation, then invest in three branches: Grassroots (steady per-turn income), Bundlers (one-time cash infusions), and Direct Mail (a multiplier on all campaign income).",
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
