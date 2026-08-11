import { FAVORABILITY_NATURAL_DECAY_THRESHOLD } from "@shared/constants/formulas";

// src/lib/actions/recommendationsConstants.ts
/**
 * Thresholds and constants for action recommendations.
 */

// Action Points
export const ACTION_CAP = 200;
export const ACTION_HOARDING_THRESHOLD = 100;
export const ACTION_HOARDING_PENALTY = 4;
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
