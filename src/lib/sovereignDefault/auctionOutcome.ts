/**
 * Pure auction outcome classifier.
 *
 * Maps a market-demand ratio (from `computeMarketDemand`) to one of three
 * discriminated outcomes plus the delta the consecutive-failed counter should
 * receive. The delta is encoded here so the orchestrator does not re-derive
 * the rules.
 *
 * Thresholds are sourced from `constants.ts` — never hardcode them here.
 */

import { DEMAND_FULL_THRESHOLD, DEMAND_UNDERSUBSCRIBED_THRESHOLD } from "./constants";

export type AuctionOutcome = "fullySubscribed" | "undersubscribed" | "failed";

export interface AuctionOutcomeResult {
  outcome: AuctionOutcome;
  /** 0 means reset the counter to 0; 1 means increment the existing counter by 1. */
  counterDelta: 0 | 1;
}

export function classifyAuctionOutcome(demandRatio: number): AuctionOutcomeResult {
  // NaN comparisons are always false, so a NaN demand falls through to the
  // 'failed' branch — we treat broken inputs as failing the auction rather
  // than silently resetting the consecutive-failed counter.
  if (demandRatio >= DEMAND_FULL_THRESHOLD) {
    return { outcome: "fullySubscribed", counterDelta: 0 };
  }
  if (demandRatio >= DEMAND_UNDERSUBSCRIBED_THRESHOLD) {
    return { outcome: "undersubscribed", counterDelta: 0 };
  }
  return { outcome: "failed", counterDelta: 1 };
}
