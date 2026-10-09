/**
 * The wire shape of one party's primary detail.
 *
 * Split from the builder so client components can name these types without
 * importing a module that pulls in the Mongo driver. The builder in
 * `../primaryPartyDetail.ts` produces them; the Blend primary screen consumes
 * them straight off the endpoint.
 */

import type { PrimaryCandidateInfo } from "@/lib/elections/primaryViewModel";

/**
 * The two personal actions a candidate takes during a primary, plus everything
 * needed to price and gate them.
 *
 * Funds and the surge price are both in LOCAL units, matching the field the
 * surge route actually debits. Quoting the anchor price against a local balance
 * would let the button enable on money the route then refuses.
 */
/** One state on primary night, without its revealed votes (those are in `byState`). */
export interface PrimaryNightStateView {
  status: "polls_open" | "counting" | "too_early" | "leaning" | "called" | "final";
  reportingPct: number;
  called: boolean;
  calledFor: string | null;
  closesAt: string;
}

export interface PrimaryViewerCampaign {
  currentCampaignState: string | null;
  currentTicks: number;
  tickCap: number;
  homeState: string | null;
  surgeUsed: boolean;
  playerActions: number;
  playerFunds: number;
  surgeCostFunds: number;
  surgeCostActions: number;
  /** Percentage points of extra vote in the home state, for the whole primary. */
  surgeBoost: number;
  states: { id: string; name: string; actionCost: number }[];
}

export interface PrimaryPartyDetail {
  /** Always the party's sequential id, whatever form the caller addressed it by. */
  partyId: string;
  partyName: string;
  partyColor: string;
  /** Live roster, with the display colour each candidate is drawn in. */
  candidates: PrimaryCandidateInfo[];
  /**
   * stateId -> candidateId -> votes. Counted results for a state that has
   * voted, projected votes everywhere else. Empty before any projection exists.
   */
  byState: Record<string, Record<string, number>>;
  stateNameById: Record<string, string>;
  /**
   * States whose result is in and may be shown, so a board can separate locked
   * from projected. A state still being counted on primary night is not listed
   * until it is called.
   */
  votedStateIds: string[];
  /**
   * Primary night: every state whose wave is still being counted, with how far
   * the count has got. Its `byState` entry holds only the votes reported so
   * far (or the projection while nothing is reported). Absent outside a night.
   */
  night?: Record<string, PrimaryNightStateView>;
  /** Null for a viewer with no candidate in this party's primary. */
  viewerCampaign: PrimaryViewerCampaign | null;
}
