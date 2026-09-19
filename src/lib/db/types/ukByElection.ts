import type { ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";

/**
 * UK Commons by-election + recall petition documents (epic #856, ticket #860).
 *
 * A Commons vacancy is a durable record, not just a tombstoned official row:
 * the row says a seat has no holder, this says WHY it is empty, HOW MANY seats
 * are open, and WHICH by-election (if any) will fill them. Recall petitions
 * are the second route to a vacancy: an infamy/sustained-low-approval trigger
 * opens one, a constituency support-check window runs, and a deterministic
 * resolution either retains the MP or vacates the seat.
 */

/** How a Commons seat became vacant. `removal` is the watcher backstop for
 * holder-less rows left by paths that do not record a reason (character
 * death, account deletion, admin removal); hooked paths write a precise
 * reason instead. */
export type CommonsVacancyReason =
  "death" | "retirement" | "defection" | "resignation" | "recall" | "removal";

/** Lifecycle of a vacancy doc. `scheduled` means a live `special_commons`
 * election claims it; `filled` means the by-election seated a winner;
 * `subsumed` means a regular general/snap swept the region first. */
export type CommonsVacancyStatus = "open" | "scheduled" | "filled" | "subsumed";

export interface UkCommonsVacancy {
  _id: ObjectId;
  countryId: CountryId;
  /** Game region holding the seat (e.g. "LON"). */
  state: string;
  /** Elected-official row the seat was vacated from. */
  officialId: ObjectId;
  /** Constituency name/id carried from the vacated seat, when known. */
  constituency?: string;
  constituencyId?: string;
  /** Seats opened by this vacancy (bloc rows can open more than one). */
  seats: number;
  reason: CommonsVacancyReason;
  /** Previous holder, for news/audit. Exactly one of the two is set. */
  priorCharacterId?: ObjectId;
  priorNppId?: ObjectId;
  priorCharacterName?: string;
  priorParty?: string;
  vacatedTurn: number;
  vacatedAt: Date;
  status: CommonsVacancyStatus;
  /** By-election claiming this vacancy, once spawned. */
  electionId?: ObjectId;
  scheduledTurn?: number;
  resolvedTurn?: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Lifecycle of a recall petition. `watch` is a pre-petition tracker holding
 * the sustained-low-approval streak; `open` collects signatures; `check`
 * runs the constituency support window; `retained` / `vacated` are terminal. */
export type RecallPetitionStatus = "watch" | "open" | "check" | "retained" | "vacated" | "expired";

export type RecallTrigger = "infamy" | "lowApproval" | "petition";

export interface RecallSignature {
  characterId: ObjectId;
  characterName: string;
  turn: number;
  createdAt: Date;
}

export interface RecallDeclaration {
  characterId: ObjectId;
  side: "retain" | "remove";
  turn: number;
  createdAt: Date;
}

/** One sampled approval reading inside the support-check window. */
export interface RecallSupportSample {
  turn: number;
  favorability: number;
  createdAt: Date;
}

export interface UkRecallPetition {
  _id: ObjectId;
  countryId: CountryId;
  state: string;
  /** Target MP's official row. */
  officialId: ObjectId;
  targetCharacterId: ObjectId;
  targetCharacterName: string;
  targetParty?: string;
  status: RecallPetitionStatus;
  /** What opened (or is counting toward) this petition. */
  trigger: RecallTrigger;
  /** Consecutive turns under the low-approval line (watch + open). Reset the
   * turn the MP reads at or above the line. */
  lowStreak: number;
  lastEvaluatedTurn?: number;
  openedTurn?: number;
  openedAt?: Date;
  signatures: RecallSignature[];
  /** Support-check window bounds, set when the petition moves to `check`. */
  checkStartTurn?: number;
  checkEndTurn?: number;
  declarations: RecallDeclaration[];
  supportSamples: RecallSupportSample[];
  /** Deterministic outcome once resolved. */
  outcome?: "retained" | "vacated";
  resolvedTurn?: number;
  resolvedAt?: Date;
  /** Vacancy created when the check vacates the seat. */
  vacancyId?: ObjectId;
  /** Why a petition left the pipeline without vacating. */
  expireReason?: string;
  createdAt: Date;
  updatedAt: Date;
}
