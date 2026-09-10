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
  /** States whose wave has fired, so a board can separate locked from projected. */
  votedStateIds: string[];
  /** Null for a viewer with no candidate in this party's primary. */
  viewerCampaign: PrimaryViewerCampaign | null;
}
