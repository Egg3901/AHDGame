import type { ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { CharacterStats } from "@/lib/stats/statsConstants";
import type { DebateStrategy, DebateRecord, DebateOutcome } from "@/lib/debate/debateScoring";

export type DebateSessionStatus = "awaitingStrategies" | "resolved" | "expired";

/** pvp = an online human picks strategies; ai = strategies pre-filled at creation. */
export type DebateParticipantMode = "pvp" | "ai";

/**
 * One side of an election debate. A side is either a player character or an NPP.
 * `strategies` is null until a pvp human submits; ai sides are pre-filled when
 * the session is created.
 */
export interface DebateParticipant {
  kind: "character" | "npp";
  /** Set when kind === "character". */
  characterId?: ObjectId;
  /** Set when kind === "npp". */
  nppId?: ObjectId;
  name: string;
  /** Stat snapshot taken at session creation (so drift mid-debate can't change the math). */
  stats: CharacterStats;
  /** Record snapshot driving the Tout archetype. */
  record: DebateRecord;
  mode: DebateParticipantMode;
  strategies: DebateStrategy[] | null;
}

/**
 * A two-sided election debate triggered via PREE while a candidate holds an
 * active candidacy. Each side commits to a single strategy archetype; the
 * session resolves when both have submitted or at the real-time deadline
 * (non-responders auto-resolve from their stats). Outcome shifts favorability
 * scaled by margin.
 */
export interface DebateSession {
  _id: ObjectId;
  electionId: ObjectId;
  countryId: CountryId;
  status: DebateSessionStatus;
  challenger: DebateParticipant;
  opponent: DebateParticipant;
  createdTurn: number;
  createdAt: Date;
  /** Real-time strategy-pick deadline (ms epoch); auto-resolves past this. */
  deadlineRealtimeMs: number;
  resolvedAt?: Date;
  resolveReason?: "both_submitted" | "deadline" | "election_ended";
  outcome?: DebateOutcome;
  updatedAt: Date;
}
