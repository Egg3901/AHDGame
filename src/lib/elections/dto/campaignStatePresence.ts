/**
 * The wire shape of a candidate's state presence.
 *
 * Split from the builder so client components can name these types without
 * importing a module that pulls in the Mongo driver.
 */

import type { PrimaryViewerCampaign } from "@/lib/elections/dto/primaryPartyDetail";

export interface StateTravelOption {
  id: string;
  name: string;
  /** Actions the move costs, scaled by the state's electoral votes. */
  actionCost: number;
}

export interface CampaignStatePresence {
  electionId: string;
  /** Which control applies right now. */
  phase: "primary" | "general";
  /** Where the candidate is focused, or null when they have not moved yet. */
  currentStateId: string | null;
  currentStateName: string | null;
  playerActions: number;
  states: StateTravelOption[];
  /**
   * The camp and surge controls' data, in the primary phase only. Null in the
   * general phase, where travel is the mechanic instead.
   */
  primary: PrimaryViewerCampaign | null;
}
