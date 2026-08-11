/**
 * Shared types for decision-event handlers.
 *
 * Each stage has its own handler module (e.g. `stage1AddressDiscontent.ts`)
 * exporting a `DecisionHandler` that's registered with the central
 * registry. Handlers compose three concerns:
 *   - scalar adjustments (intra-party confidence, popular legitimacy)
 *   - side-effect writes (purges, party regimeStatus, escalation flags)
 *   - timing markers (decay modifiers, escalation blocks)
 *
 * Pure types — the registry + dispatch live in `registry.ts`.
 */
import type { Db, ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { DecisionKind, LeaderDecision } from "@/lib/db/types/regimeEscalation";

export interface DecisionContext {
  db: Db;
  countryId: CountryId;
  currentTurn: number;
  decision: LeaderDecision;
  leaderCharacterId: ObjectId;
}

export interface DecisionOption {
  /** Stable id used by the resolve API and registered handlers. */
  id: string;
  /** Player-facing button label. */
  label: string;
  /** Player-facing explanation rendered in the decision card. */
  description: string;
  /** Apply this option's effects to the game state. */
  apply(ctx: DecisionContext): Promise<void>;
}

export interface DecisionHandler {
  kind: DecisionKind;
  options: DecisionOption[];
  /** Option id to fire when the decision times out (48 turns). */
  defaultOptionId: string;
}
