/**
 * The wire shape of the primary state operations hub.
 *
 * Split from the builder so client components can name these types without
 * importing a module that pulls in the Mongo driver.
 */

import type { PrimaryStateActionKind } from "@/lib/db/types";
import type { PrimaryViewerCampaign } from "@/lib/elections/dto/primaryPartyDetail";

export interface StatePresenceRow {
  stateId: string;
  name: string;
  level: number;
  /** Cost of the next level, from stateOrgLevelCost. */
  nextCost: number;
}

export interface LiveAttackRow {
  kind: PrimaryStateActionKind;
  stateId: string;
  stateName: string;
  /** Present only on rows aimed at the viewer, so a hit can be traced. */
  actorName?: string;
  expiresTurn: number;
}

export interface OpponentRow {
  candidateId: string;
  name: string;
  color: string;
  /** Their delegate standing, so the field can be read by threat. */
  delegates: number;
  liveAgainstThem: LiveAttackRow[];
}

export interface StateOperationsView {
  electionId: string;
  currentTurn: number;
  positives: {
    /**
     * Camping AND the home-state surge: `PrimaryViewerCampaign` already carries
     * `surgeUsed`, `surgeCostFunds` and `surgeBoost`, so the one-shot rides
     * here rather than being rebuilt.
     */
    camp: PrimaryViewerCampaign;
    /**
     * Only the states the viewer already has presence in, strongest first.
     * Building somewhere new goes through the shared picker, which offers all
     * of them.
     */
    presence: StatePresenceRow[];
    /**
     * Whether canvassing is open and where. The canvassing desk itself already
     * renders further down the campaign page, so the hub states the status and
     * the blocked reason rather than embedding a second copy of it.
     */
    canvass: { available: boolean; stateId: string | null; reason: string | null };
  };
  opponents: OpponentRow[];
  /** Attacks live against the viewer, attributed. */
  liveAgainstYou: LiveAttackRow[];
  /** The viewer's Rapid Response shield, 0..1. */
  shieldPct: number;
  /**
   * The campaign war chest, in the campaign's own currency.
   *
   * An attack is charged to the campaign, not to the candidate, so gating the
   * button on `positives.camp.playerFunds` (which is the character's own
   * balance, and is what the home-state surge spends) would compare the wrong
   * pool and offer an action the server refuses.
   */
  campaignFunds: number;
  /**
   * What the local attack costs and does, so no figure is typed into markup.
   * `costFunds` is already converted into the campaign's currency, matching
   * `camp.surgeCostFunds`.
   */
  localAttack: { costFunds: number; costActions: number; perTurn: number; turns: number };
}
