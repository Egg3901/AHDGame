/**
 * Personal action hints use Energy 1 defaults: ACTION_CAP is 250 and
 * ACTION_HOARDING_THRESHOLD is 125. ACTION_HOARDING_PENALTY is five actions.
 */
import { ENERGY_BASE_ACTION_CAP, ENERGY_BASE_HOARD_THRESHOLD } from "@/lib/stats/statsConstants";
import { PLAYER_ACTION_HOARD_PENALTY } from "./rules/allowances";
import { FAVORABILITY_NATURAL_DECAY_THRESHOLD } from "@shared/constants/formulas";

// src/lib/actions/recommendationsConstants.ts
/**
 * Thresholds and constants for action recommendations.
 */

// Action Points
export const ACTION_CAP = ENERGY_BASE_ACTION_CAP;
export const ACTION_HOARDING_THRESHOLD = ENERGY_BASE_HOARD_THRESHOLD;
export const ACTION_HOARDING_PENALTY = PLAYER_ACTION_HOARD_PENALTY;
export const ACTIONS_LOW_THRESHOLD = 10;
export const ACTIONS_CRITICAL_THRESHOLD = 5;

// Favorability
export const FAVORABILITY_LOW_THRESHOLD = 40;
export const FAVORABILITY_DECAY_THRESHOLD = FAVORABILITY_NATURAL_DECAY_THRESHOLD;

// Influence
export const INFLUENCE_LOW_THRESHOLD = 20;

// Funds
export const FUNDS_LOW_THRESHOLD = 100_000;
export const FUNDS_CRITICAL_THRESHOLD = 20_000;

// Unowned Sectors
export const UNOWNED_LARGE_PERCENT_THRESHOLD = 30;
export const UNOWNED_HUGE_PERCENT_THRESHOLD = 50;
export const UNOWNED_LARGE_REVENUE_THRESHOLD = 500_000_000;

// Market Share
export const MARKET_SHARE_LOW_THRESHOLD = 10;
export const MARKET_SHARE_UNDERPERFORMING_RATIO = 0.5; // <50% of average

// Party Treasury
export const PARTY_TREASURY_HEALTHY_THRESHOLD = 100_000;
