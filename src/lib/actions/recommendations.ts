// src/lib/actions/recommendations.ts
import type { Character, PartyBudget, PoliticalParty, StatePartyOrg } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import { getPartyRoleLabel } from "@/lib/parties/partyRoleLabels";
import { getTotalPersonalLiquidWealth } from "@/lib/currency/characterFunds";
import {
  getCampaignActionCost,
  getAdvertiseActionCost,
  getDonorActionCost,
  calculateFundraisingAmount,
} from "../actions";
import {
  ACTION_HOARDING_THRESHOLD,
  ACTION_HOARDING_PENALTY,
  FAVORABILITY_LOW_THRESHOLD,
  INFLUENCE_LOW_THRESHOLD,
  FUNDS_LOW_THRESHOLD,
  FUNDS_CRITICAL_THRESHOLD,
  ACTIONS_LOW_THRESHOLD,
} from "./recommendationsConstants";
import type { CorporationType } from "@/lib/constants/corporations";
import { buildOnboardingStepContent } from "@/lib/onboarding/checklist";
import { chapterIdsForPlan, resolveTutorialPlan } from "@/lib/onboarding/tutorialPlan";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type RecommendationPriority = "critical" | "high" | "medium" | "low";
export type RecommendationCategory =
  | "getting-started"
  | "stat-recovery"
  | "resource-opt"
  | "market-opportunity"
  | "competitive"
  | "party";

export interface ActionRecommendation {
  id: string;
  priority: RecommendationPriority;
  category: RecommendationCategory;
  title: string;
  why: string; // Clear explanation of WHY this is recommended
  action: {
    type: string; // ActionType | 'split' | 'gotv' | 'suppression'
    targetState?: string;
    targetStateName?: string; // Human-readable state name
    targetSectorType?: CorporationType;
    targetDemographic?: { category: string; group: string };
    estimatedCost: { ap: number; funds: number };
    estimatedBenefit: string;
    targetUnownedRevenue?: number; // For unowned sector opportunities
    targetPartyName?: string; // Human-readable party name
  };
  link: string; // Deep link to relevant page
  expiresAt?: number; // Turn number when recommendation expires
}

interface StateEconomySector {
  type: string;
  label: string;
  totalMarket: number;
  ownedRevenue: number;
  unownedRevenue: number;
  unownedPercent: number;
  splitCost: number;
  estimatedCapture: number;
  estimatedCapturePercent: number;
}

export interface StateEconomyData {
  stateId: string;
  stateName: string;
  countryId: CountryId;
  sectors: StateEconomySector[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Getting Started (new player onboarding suggestions)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate suggestions for players who haven't completed core onboarding steps.
 * Each item disappears automatically once the condition is met.
 *
 * Titles, copy, and links come from the canonical onboarding checklist
 * definitions (src/lib/onboarding/checklist.ts) so these suggestions and the
 * profile checklist card can never disagree.
 *
 * Every item here is a politics step, so the whole block is skipped for a
 * player whose tutorial plan asked for neither office nor the top job. An
 * investor who was never shown the political game should not be nagged to join
 * a party. Characters with no stored plan resolve to the full tour, so this
 * changes nothing for anyone who predates the plan.
 */
export function checkGettingStarted(
  character: Character,
  hasVoted: boolean,
  hasActiveCandidacy: boolean
): ActionRecommendation[] {
  const recommendations: ActionRecommendation[] = [];
  const chapters = chapterIdsForPlan(resolveTutorialPlan(character));
  if (!chapters.includes("office") && !chapters.includes("nation")) return recommendations;

  const stepContent = new Map(buildOnboardingStepContent(character).map((s) => [s.id, s]));

  // Join a party
  if (!character.party || character.party === "independent") {
    const step = stepContent.get("join-party")!;
    recommendations.push({
      id: `gs-no-party-${character._id.toString()}`,
      priority: "high",
      category: "getting-started",
      title: step.title,
      why: step.body,
      action: {
        type: "joinParty",
        estimatedCost: { ap: 0, funds: 0 },
        estimatedBenefit: "Shared action pool, better primaries",
      },
      link: step.link,
    });
  }

  // Enter an election — no office and not already a candidate
  if (!character.currentOffice && !hasActiveCandidacy) {
    const step = stepContent.get("file-for-race")!;
    recommendations.push({
      id: `gs-no-election-${character._id.toString()}`,
      priority: "medium",
      category: "getting-started",
      title: step.title,
      why: step.body,
      action: {
        type: "runForOffice",
        estimatedCost: { ap: 0, funds: 0 },
        estimatedBenefit: "A seat in government",
      },
      link: step.link,
    });
  }

  // Vote on a bill
  if (!hasVoted) {
    const step = stepContent.get("first-vote")!;
    recommendations.push({
      id: `gs-no-vote-${character._id.toString()}`,
      priority: "low",
      category: "getting-started",
      title: step.title,
      why: step.body,
      action: {
        type: "voteOnBill",
        estimatedCost: { ap: 0, funds: 0 },
        estimatedBenefit: "A say in the law",
      },
      link: step.link,
    });
  }

  return recommendations;
}

// ─────────────────────────────────────────────────────────────────────────────
// Stat Threshold Checks
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate recommendations based on character stat thresholds.
 */
export function checkStatThresholds(
  character: Character,
  homeStateId?: string,
  forexEnabled = false
): ActionRecommendation[] {
  const recommendations: ActionRecommendation[] = [];

  // ── Actions: Hoarding ──────────────────────────────────────────────────────
  if ((character.actions ?? 0) > ACTION_HOARDING_THRESHOLD) {
    const excess = (character.actions ?? 0) - ACTION_HOARDING_THRESHOLD;
    recommendations.push({
      id: `actions-hoarding-${character._id.toString()}`,
      priority: "high",
      category: "resource-opt",
      title: "Action Point Hoarding Penalty Active",
      why: `You have ${character.actions} AP (threshold: ${ACTION_HOARDING_THRESHOLD}). You're losing ${ACTION_HOARDING_PENALTY} AP/turn to hoarding penalty. Spend ${excess}+ AP to maximize efficiency.`,
      action: {
        type: "campaign",
        targetState: homeStateId,
        estimatedCost: {
          ap: getCampaignActionCost(character.politicalInfluence ?? 0),
          funds: 0,
        },
        estimatedBenefit: "+1% political influence",
      },
      link: "/actions",
    });
  }

  // ── Actions: Critically Low ────────────────────────────────────────────────
  if ((character.actions ?? 0) < ACTIONS_LOW_THRESHOLD) {
    recommendations.push({
      id: `actions-low-${character._id.toString()}`,
      priority: "critical",
      category: "stat-recovery",
      title: "Action Points Critically Low",
      why: `You have only ${character.actions} AP. Focus on free or low-cost actions and save your AP for next turn.`,
      action: {
        type: "rest",
        estimatedCost: { ap: 0, funds: 0 },
        estimatedBenefit: "Save AP for next turn",
      },
      link: "/actions",
    });
  }

  // ── Favorability: Low ──────────────────────────────────────────────────────
  const favorability = Math.round((character.favorability ?? 0) * 100) / 100;
  if (favorability < FAVORABILITY_LOW_THRESHOLD) {
    const cost = getAdvertiseActionCost(favorability);
    recommendations.push({
      id: `favorability-low-${character._id.toString()}`,
      priority: favorability < 30 ? "critical" : "high",
      category: "stat-recovery",
      title: `Favorability Below ${FAVORABILITY_LOW_THRESHOLD}%`,
      why: `Your favorability is ${favorability}%. Below ${FAVORABILITY_LOW_THRESHOLD}%, you're in the danger zone for electoral performance. Run advertisements to recover.`,
      action: {
        type: "advertise",
        estimatedCost: { ap: cost, funds: 0 },
        estimatedBenefit: "+3% favorability",
      },
      link: "/actions",
    });
  }

  // ── Influence: Low ─────────────────────────────────────────────────────────
  const influence = Math.round((character.politicalInfluence ?? 0) * 100) / 100;
  if (influence < INFLUENCE_LOW_THRESHOLD && influence < 100) {
    const cost = getCampaignActionCost(influence);
    recommendations.push({
      id: `influence-low-${character._id.toString()}`,
      priority: "high",
      category: "stat-recovery",
      title: `Political Influence Below ${INFLUENCE_LOW_THRESHOLD}%`,
      why: `Your influence is ${influence}%. Build a foothold with Campaign actions to unlock candidate options and improve election odds.`,
      action: {
        type: "campaign",
        targetState: homeStateId,
        estimatedCost: { ap: cost, funds: 0 },
        estimatedBenefit: "+1% political influence",
      },
      link: "/actions",
    });
  }

  // ── Funds: Critical ────────────────────────────────────────────────────────
  // LOCAL home-currency balance (canonical source of truth).
  const funds = character.currencyBalances?.campaign ?? character.funds ?? 0;
  if (funds < FUNDS_CRITICAL_THRESHOLD) {
    const donorLevel = character.donorBaseLevel ?? 0;
    if (donorLevel > 0) {
      const raiseAmount = calculateFundraisingAmount(donorLevel, character.politicalInfluence ?? 0);
      const cost = getDonorActionCost(donorLevel, "fundraise");
      recommendations.push({
        id: `funds-critical-${character._id.toString()}`,
        priority: "critical",
        category: "stat-recovery",
        title: "Campaign Funds Critically Low",
        why: `You have $${funds.toLocaleString()}. Fundraise immediately to afford basic actions.`,
        action: {
          type: "fundraise",
          estimatedCost: { ap: cost, funds: 0 },
          estimatedBenefit: `+$${raiseAmount.toLocaleString()}`,
        },
        link: "/actions",
      });
    } else {
      recommendations.push({
        id: `funds-critical-no-donor-${character._id.toString()}`,
        priority: "critical",
        category: "stat-recovery",
        title: "Campaign Funds Critically Low",
        why: `You have $${funds.toLocaleString()} and no donor base. Build Donor Network first, then Fundraise.`,
        action: {
          type: "buildDonorBase",
          estimatedCost: { ap: getDonorActionCost(0, "buildDonorBase"), funds: 0 },
          estimatedBenefit: "+1 donor level, unlocks fundraising",
        },
        link: "/actions",
      });
    }
  } else if (funds < FUNDS_LOW_THRESHOLD && funds >= FUNDS_CRITICAL_THRESHOLD) {
    const donorLevel = character.donorBaseLevel ?? 0;
    if (donorLevel > 0) {
      const raiseAmount = calculateFundraisingAmount(donorLevel, character.politicalInfluence ?? 0);
      const cost = getDonorActionCost(donorLevel, "fundraise");
      recommendations.push({
        id: `funds-low-${character._id.toString()}`,
        priority: "medium",
        category: "stat-recovery",
        title: "Campaign Funds Running Low",
        why: `You have $${funds.toLocaleString()}. Consider fundraising before you hit critical levels.`,
        action: {
          type: "fundraise",
          estimatedCost: { ap: cost, funds: 0 },
          estimatedBenefit: `+$${raiseAmount.toLocaleString()}`,
        },
        link: "/actions",
      });
    }
  }

  // ── Cash on Hand: High (Convert Cash opportunity) ─────────────────────────
  const cashOnHand = getTotalPersonalLiquidWealth(character, forexEnabled);
  if (cashOnHand > 100_000 && funds < 200_000) {
    const converted = Math.floor(cashOnHand * 0.5);
    const infamy = Math.round(15 * Math.pow(cashOnHand / 1_000_000, 0.564));
    recommendations.push({
      id: `convert-cash-${character._id.toString()}`,
      priority: "medium",
      category: "resource-opt",
      title: "Consider Personal Donation",
      why: `You have $${cashOnHand.toLocaleString()} personal cash. Convert to campaign funds at 50% rate (+$${converted.toLocaleString()}, +${infamy} infamy).`,
      action: {
        type: "convertCash",
        estimatedCost: { ap: 2, funds: 0 },
        estimatedBenefit: `+$${converted.toLocaleString()} campaign funds`,
      },
      link: "/actions",
    });
  }

  // ── Profile Customization: Missing Profile Picture ────────────────────────
  if (!character.avatarUrl || character.avatarUrl === "") {
    recommendations.push({
      id: `missing-pfp-${character._id.toString()}`,
      priority: "low",
      category: "stat-recovery",
      title: "Set Profile Picture",
      why: "Your politician profile has no picture. A profile picture makes your profile look more professional (cosmetic only).",
      action: {
        type: "setProfilePicture",
        estimatedCost: { ap: 0, funds: 0 },
        estimatedBenefit: "Professional appearance",
      },
      link: "/profile",
    });
  }

  // ── Profile Customization: Missing Header Image ───────────────────────────
  if (!character.profileHeaderImageUrl || character.profileHeaderImageUrl === "") {
    recommendations.push({
      id: `missing-header-${character._id.toString()}`,
      priority: "low",
      category: "stat-recovery",
      title: "Set Profile Header Image",
      why: "Your politician profile has no header image. A header image makes your profile look more professional (cosmetic only).",
      action: {
        type: "setHeaderImage",
        estimatedCost: { ap: 0, funds: 0 },
        estimatedBenefit: "Professional appearance",
      },
      link: "/profile",
    });
  }

  return recommendations;
}

// ─────────────────────────────────────────────────────────────────────────────
// Unowned Sector Opportunities
// ─────────────────────────────────────────────────────────────────────────────

interface UnownedSectorOpportunity {
  sectorType: string;
  sectorLabel: string;
  stateId: string;
  stateName: string;
  countryId: CountryId;
  unownedRevenue: number;
  unownedPercent: number;
  splitCost: number;
  estimatedCapturePercent: number;
}

/**
 * Find and consolidate large unowned sector opportunities.
 * Returns top 5 largest unowned sectors globally, filtered by user's corp types.
 */
export function findUnownedOpportunities(
  economyData: StateEconomyData[],
  character: Character,
  userCorpSectorTypes: string[] = [] // Primary + secondary types from user's corporations
): ActionRecommendation[] {
  const allOpportunities: UnownedSectorOpportunity[] = [];

  // Collect all unowned sectors from all states
  for (const economy of economyData) {
    for (const sector of economy.sectors) {
      // Only include sectors matching user's corp types
      if (userCorpSectorTypes.length > 0 && !userCorpSectorTypes.includes(sector.type)) {
        continue;
      }

      // Only include significant opportunities (>30% unowned or >$100M)
      const isSignificant = sector.unownedPercent > 30 || sector.unownedRevenue > 100_000_000;

      if (isSignificant && sector.unownedRevenue > 0) {
        allOpportunities.push({
          sectorType: sector.type,
          sectorLabel: sector.label,
          stateId: economy.stateId,
          stateName: economy.stateName,
          countryId: economy.countryId,
          unownedRevenue: sector.unownedRevenue,
          unownedPercent: Math.round(sector.unownedPercent * 100) / 100,
          splitCost: Math.round(sector.splitCost / 1_000_000) * 1_000_000, // Round to nearest $1M
          estimatedCapturePercent: Math.round(sector.estimatedCapturePercent * 100) / 100,
        });
      }
    }
  }

  // Sort by unowned revenue (largest first)
  allOpportunities.sort((a, b) => b.unownedRevenue - a.unownedRevenue);

  // Take top 5
  const top5 = allOpportunities.slice(0, 5);

  // Group by sector type for consolidated recommendations
  const byType = new Map<string, UnownedSectorOpportunity[]>();
  for (const opp of top5) {
    const existing = byType.get(opp.sectorType) ?? [];
    existing.push(opp);
    byType.set(opp.sectorType, existing);
  }

  const recommendations: ActionRecommendation[] = [];

  // Create one consolidated recommendation per sector type
  for (const [sectorType, opportunities] of byType.entries()) {
    const totalUnowned = opportunities.reduce((sum, o) => sum + o.unownedRevenue, 0);
    const states = opportunities.map((o) => o.stateName).join(", ");

    // Format large numbers appropriately (B for billions, M for millions)
    const formatMoney = (value: number): string => {
      if (value >= 1_000_000_000) {
        return `$${(value / 1_000_000_000).toFixed(2)}B`;
      } else if (value >= 1_000_000) {
        return `$${(value / 1_000_000).toFixed(2)}M`;
      } else {
        return `$${value.toLocaleString()}`;
      }
    };

    const topOpp = opportunities[0];
    const countryPath = topOpp.countryId.toLowerCase();
    recommendations.push({
      id: `unowned-consolidated-${sectorType}-${character._id.toString()}`,
      priority: opportunities.length >= 3 ? "high" : "medium",
      category: "market-opportunity",
      title: `Split Unowned ${topOpp.sectorLabel} Sectors`,
      why: `${opportunities.length} state${opportunities.length > 1 ? "s" : ""} with ${formatMoney(totalUnowned)} unowned ${topOpp.sectorLabel.toLowerCase()} (${states}). Top opportunity: ${topOpp.stateName} (${formatMoney(topOpp.unownedRevenue)}, ${topOpp.unownedPercent}% unowned).`,
      action: {
        type: "split",
        targetState: topOpp.stateId,
        targetStateName: topOpp.stateName,
        targetSectorType: sectorType as CorporationType,
        estimatedCost: {
          ap: 0,
          funds: topOpp.splitCost,
        },
        estimatedBenefit: `${topOpp.estimatedCapturePercent}% market share per split`,
        targetUnownedRevenue: topOpp.unownedRevenue,
      },
      link: `/country/${countryPath}/region/${topOpp.stateId.toUpperCase()}?tab=economy&sector=${sectorType}`,
    });
  }

  return recommendations;
}

// ─────────────────────────────────────────────────────────────────────────────
// Competitive Market Position
// ─────────────────────────────────────────────────────────────────────────────

export interface CorpMarketPosition {
  corporationId: string;
  corporationName: string;
  sectorId?: string;
  revenue: number;
  marketSharePercent: number;
  sectorType: string;
  stateId: string;
  avgMarketShare: number; // Average MS for this sector type in this state
}

/**
 * Identify sectors where the user's corporation is underperforming vs competitors.
 * Only flags when there are actual competitors (avgMarketShare < 50% means 2+ corps).
 */
export function compareMarketPosition(
  positions: CorpMarketPosition[],
  character: Character
): ActionRecommendation[] {
  const recommendations: ActionRecommendation[] = [];

  for (const pos of positions) {
    // Skip if user is the only corporation in this sector (avgMarketShare = 100%)
    if (pos.avgMarketShare >= 50) {
      continue;
    }

    // Underperforming = <50% of average market share
    const isUnderperforming = pos.marketSharePercent < pos.avgMarketShare * 0.5;

    if (isUnderperforming && pos.marketSharePercent < 15) {
      recommendations.push({
        id: `low-ms-${pos.sectorType}-${pos.stateId}-${character._id.toString()}`,
        priority: "medium",
        category: "competitive",
        title: `Low Market Share in ${pos.sectorType}`,
        why: `Your ${pos.sectorType} sector has ${pos.marketSharePercent.toFixed(1)}% market share vs ${pos.avgMarketShare.toFixed(1)}% average. Aggressive split campaigns can close the gap.`,
        action: {
          type: "split",
          targetState: pos.stateId,
          targetSectorType: pos.sectorType as CorporationType,
          estimatedCost: { ap: 0, funds: 0 }, // Will be calculated by UI
          estimatedBenefit: "+2-5% market share per split",
        },
        link: pos.sectorId
          ? `/corporation/${pos.corporationId}/sector/${pos.sectorId}`
          : `/corporation/${pos.corporationId}?tab=sectors`,
      });
    }
  }

  return recommendations;
}

// ─────────────────────────────────────────────────────────────────────────────
// Party Actions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate party-level action recommendations (GOTV, suppression, org building).
 */
export function checkPartyActions(
  party: PoliticalParty | null,
  partyBudget: PartyBudget | null,
  statePartyOrg: StatePartyOrg | null,
  character: Character,
  partyName?: string
): ActionRecommendation[] {
  const recommendations: ActionRecommendation[] = [];

  if (!party && !partyBudget && !statePartyOrg) return recommendations;

  const countryPath = character.countryId.toLowerCase();
  // Source of truth for treasury: statePartyOrg.treasury (state scope) or
  // party.treasury (national scope). partyBudget no longer carries money.
  const treasury = statePartyOrg?.treasury ?? party?.treasury ?? 0;
  const partyLabel = partyName ?? "Your party";
  const partyId =
    partyBudget?.partyId ??
    statePartyOrg?.partyId ??
    (party ? String(party.sequentialId) : undefined);

  // GOTV recommendation if treasury is healthy
  if (treasury > 100_000) {
    const gotvPercent = partyBudget?.gotvBudgetPercent ?? 0;
    if (gotvPercent < 10) {
      recommendations.push({
        id: `gotv-opportunity-${partyId}`,
        priority: "medium",
        category: "party",
        title: `${partyLabel} Treasury Available for GOTV`,
        why: `${partyLabel} has $${treasury.toLocaleString()} in treasury. GOTV spending boosts turnout among aligned demographics.`,
        action: {
          type: "gotv",
          estimatedCost: { ap: 0, funds: 0 },
          estimatedBenefit: "+2-5% turnout in target demographics",
          targetPartyName: partyName,
        },
        link: `/country/${countryPath}/parties/${partyId}?tab=treasury`,
      });
    }
  }

  // Build Org recommendation if player has PS to spend on this state party.
  // The server gates on pool headroom OR poachable rivals — we don't gate the
  // recommendation on a per-party cap.
  if (statePartyOrg && (statePartyOrg.politicalStrength ?? 0) > 0) {
    const orgValue = (statePartyOrg.organization ?? 0).toFixed(1);
    recommendations.push({
      id: `build-org-${statePartyOrg._id}`,
      priority: "high",
      category: "party",
      title: "Grow Party Organization",
      why: `${partyLabel} has ${orgValue}% org in this state. Spend Political Strength on Build Org to grow it from the unaffiliated pool and by poaching rivals.`,
      action: {
        type: "build-org",
        estimatedCost: { ap: 0, funds: 0 },
        estimatedBenefit: "+0.1–1 Org% per click (varies with state context)",
        targetPartyName: partyName,
      },
      link: `/country/${countryPath}/region/${statePartyOrg.stateId}/party/${statePartyOrg.partyId}`,
    });
  }

  return recommendations;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Recommendation Generator
// ─────────────────────────────────────────────────────────────────────────────

interface GenerateRecommendationsInput {
  character: Character;
  homeStateEconomy?: StateEconomyData;
  allStateEconomies?: StateEconomyData[];
  party?: PoliticalParty | null;
  partyBudget?: PartyBudget | null;
  statePartyOrg?: StatePartyOrg | null;
  marketPositions?: CorpMarketPosition[];
  currentTurn?: number;
  userCorpSectorTypes?: string[]; // Primary + secondary types from user's corporations
  corporations?: Array<{ _id: string; name: string; logoUrl?: string; headerImageUrl?: string }>;
  vacantPositions?: Array<{
    type: string;
    stateId?: string;
    partyId: string;
    level: "state" | "national";
  }>;
  partyName?: string; // Human-readable party display name
  hasVoted?: boolean; // Whether the player has voted on any bill
  hasActiveCandidacy?: boolean; // Whether the player has an active election candidacy
  forexEnabled?: boolean;
  /**
   * Plants tier: market splitting is retired, so every "split the unowned
   * pool" recommendation is advice for a control the player no longer has.
   * Capacity is the growth lever there instead.
   */
  plantsEnabled?: boolean;
}

/**
 * Generate all recommendations for a character, sorted by priority.
 */
export function generateRecommendations(
  input: GenerateRecommendationsInput
): ActionRecommendation[] {
  const {
    character,
    allStateEconomies,
    party,
    partyBudget,
    statePartyOrg,
    marketPositions,
    userCorpSectorTypes = [],
    corporations = [],
    vacantPositions = [],
    partyName,
    hasVoted = false,
    hasActiveCandidacy = false,
    forexEnabled = false,
    plantsEnabled = false,
  } = input;

  const countryPath = character.countryId.toLowerCase();

  const recommendations: ActionRecommendation[] = [];

  // 1. Getting started (new player onboarding — disappear once conditions are met)
  recommendations.push(...checkGettingStarted(character, hasVoted, hasActiveCandidacy));

  // 2. Stat-based recommendations (always included)
  recommendations.push(...checkStatThresholds(character, character.homeState, forexEnabled));

  // 3. Unowned sector opportunities (consolidated, filtered by user's corp types).
  // Skipped entirely under plants: splitting is retired there, so these would
  // point at a button that no longer exists and a route that returns 403.
  if (!plantsEnabled && allStateEconomies && allStateEconomies.length > 0) {
    recommendations.push(
      ...findUnownedOpportunities(allStateEconomies, character, userCorpSectorTypes)
    );

    // National opportunities (states with >50% unowned in any sector) - only for matching types
    for (const economy of allStateEconomies) {
      if (economy.stateId !== character.homeState && userCorpSectorTypes.length > 0) {
        for (const sector of economy.sectors) {
          if (sector.unownedPercent > 50 && sector.unownedRevenue > 1_000_000_000) {
            recommendations.push({
              id: `unowned-national-${economy.stateId}-${sector.type}-${character._id.toString()}`,
              priority: "low",
              category: "market-opportunity",
              title: `National Opportunity: ${sector.label} in ${economy.stateName}`,
              why: `${sector.label} in ${economy.stateName} has ${sector.unownedPercent.toFixed(1)}% unowned ($${(sector.unownedRevenue / 1_000_000_000).toFixed(1)}B). Consider expanding operations.`,
              action: {
                type: "split",
                targetState: economy.stateId,
                targetStateName: economy.stateName,
                targetSectorType: sector.type as CorporationType,
                estimatedCost: { ap: 0, funds: sector.splitCost },
                estimatedBenefit: `${sector.estimatedCapturePercent.toFixed(1)}% market share`,
                targetUnownedRevenue: sector.unownedRevenue,
              },
              link: `/country/${economy.countryId.toLowerCase()}/region/${economy.stateId.toUpperCase()}?tab=economy`,
            });
          }
        }
      }
    }
  }

  // 4. Competitive market position
  if (marketPositions && marketPositions.length > 0) {
    recommendations.push(...compareMarketPosition(marketPositions, character));
  }

  // 5. Party actions
  if (party || partyBudget || statePartyOrg) {
    recommendations.push(
      ...checkPartyActions(
        party ?? null,
        partyBudget ?? null,
        statePartyOrg ?? null,
        character,
        partyName
      )
    );
  }

  // 6. Corporation image customization
  for (const corp of corporations) {
    if (!corp.logoUrl || corp.logoUrl === "") {
      recommendations.push({
        id: `corp-missing-logo-${corp._id}`,
        priority: "low",
        category: "stat-recovery",
        title: `Set Logo for ${corp.name}`,
        why: `Your corporation "${corp.name}" has no logo. A logo makes your corporation page look more professional (cosmetic only).`,
        action: {
          type: "setCorpLogo",
          estimatedCost: { ap: 0, funds: 0 },
          estimatedBenefit: "Professional appearance",
        },
        link: `/corporation/${corp._id}?tab=settings`,
      });
    }
    if (!corp.headerImageUrl || corp.headerImageUrl === "") {
      recommendations.push({
        id: `corp-missing-header-${corp._id}`,
        priority: "low",
        category: "stat-recovery",
        title: `Set Header Image for ${corp.name}`,
        why: `Your corporation "${corp.name}" has no header image. A header image makes your corporation page look more professional (cosmetic only).`,
        action: {
          type: "setCorpHeaderImage",
          estimatedCost: { ap: 0, funds: 0 },
          estimatedBenefit: "Professional appearance",
        },
        link: `/corporation/${corp._id}?tab=settings`,
      });
    }
  }

  // 6b. Found a corporation (if user has none)
  if (corporations.length === 0) {
    recommendations.push({
      id: `no-corporation-${character._id.toString()}`,
      priority: "medium",
      category: "market-opportunity",
      title: "Found Your First Corporation",
      why: "You don't own any corporations yet. Founding a corporation lets you capture unowned market sectors and earn passive income.",
      action: {
        type: "foundCorporation",
        estimatedCost: { ap: 0, funds: 1_000_000 }, // Approximate founding cost
        estimatedBenefit: "Passive income, market influence",
      },
      link: "/corporation/new",
    });
  }

  // 7. Vacant party positions
  for (const vacant of vacantPositions) {
    const levelLabel = vacant.level === "national" ? "National" : vacant.stateId?.toUpperCase();
    const positionLabel =
      vacant.type === "chair"
        ? "Chair"
        : vacant.type === "vice chair"
          ? "Vice Chair"
          : vacant.type === "national chair"
            ? getPartyRoleLabel(character.countryId, "chair")
            : vacant.type === "national vice chair"
              ? getPartyRoleLabel(character.countryId, "viceChair")
              : "Treasurer";
    recommendations.push({
      id: `vacant-${vacant.type}-${vacant.stateId ?? "national"}-${character._id.toString()}`,
      priority: "medium",
      category: "party",
      title: `Vacant ${positionLabel} Position`,
      why: `The ${levelLabel} ${positionLabel} position for your party is vacant. Consider running for this leadership role.`,
      action: {
        type: "runForPartyPosition",
        estimatedCost: { ap: 0, funds: 0 },
        estimatedBenefit: "+Party influence, leadership role",
      },
      link:
        vacant.level === "national"
          ? `/country/${countryPath}/parties/${vacant.partyId}/leadership`
          : `/country/${countryPath}/region/${vacant.stateId}/party/${vacant.partyId}`,
    });
  }

  // Sort by priority
  const priorityOrder: Record<RecommendationPriority, number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
  };

  recommendations.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  return recommendations;
}
