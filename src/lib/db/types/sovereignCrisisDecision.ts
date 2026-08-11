/**
 * Sovereign default crisis decision record.
 *
 * One document per crisis. Tracks the decision lifecycle from crisis fire
 * through executive proposal, legislative ratification, and resolution.
 *
 * Created in `src/lib/sovereignDefault/crisisState.ts` when state transitions
 * to `crisisPending`. Updated as the lifecycle advances.
 *
 * Phase 1 only declares the type. Phase 4 wires up creation; Phase 5+ wire up
 * lifecycle updates.
 */

import type { ObjectId } from "mongodb";
import type { SovereignResolutionChoice } from "./budget";
import type { LegislativePhase } from "@/lib/sovereignDefault/legislative/types";

export type SovereignCrisisDecisionState =
  "open" | "executiveProposed" | "ratified" | "rejected" | "autoActioned" | "expired";

export interface SovereignCrisisDecision {
  _id: ObjectId;
  countryCode: string;
  state: SovereignCrisisDecisionState;
  /** Turn the crisis fired */
  firedAtTurn: number;
  /** Real-time the crisis fired (for 12h auto-action deadline) */
  firedAtRealtimeMs: number;
  /** Executive's choice — null until they propose */
  executiveChoice: SovereignResolutionChoice | null;
  /** Real-time the executive proposed — null until proposed */
  executiveProposedAtRealtimeMs: number | null;
  /** Whether legislative ratification is required (democracies) */
  requiresLegislativeRatification: boolean;
  /** Bill ID in the legislation system once proposed (Phase 9 wires up) */
  legislativeBillId: ObjectId | null;
  /** Final resolution timestamp once decision lifecycle complete */
  resolvedAt: Date | null;
  /** Why the decision ended in its terminal state (audit) */
  resolvedReason: string | null;
  /**
   * Per-chamber voting phases for legislative ratification (phase 9b).
   * Built by the POST sovereign-resolution route when the executive proposes;
   * mutated by the vote endpoint and the per-turn processor.
   */
  legislativePhases?: LegislativePhase[];
  /**
   * Index into `legislativePhases` of the chamber currently voting.
   * Advances when the lower chamber passes; cleared on terminal outcome.
   */
  currentChamberIndex?: number | null;
  /**
   * Phase 11b: the Character who PROPOSED the resolution path. Stamped by the
   * /sovereign-resolution route at proposal time. Null when proposed by an
   * NPP (NPC) executive — political impact for NPPs runs through their own
   * favorability system, not Character favorability.
   */
  proposingCharacterId?: ObjectId | null;
  createdAt: Date;
}
