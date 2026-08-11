import type { ObjectId } from "mongodb";
import type { CountryId } from "../../constants/countries";
import type { SlateAssignerRole } from "@/lib/slateAuthority";

/**
 * A `RecruitmentSlate` is a party's planning surface for a single upcoming
 * primary. The chair (national / state / regional, depending on the race
 * scope) populates the slate with invited NPPs and player candidacies; the
 * turn loop's `processElectionEntry` pass converts `accepted` slate
 * candidates into `ElectionCandidate` rows on the primary.
 *
 * Slate ↔ election is 1:1 per (party, election). One slate per party per
 * upcoming primary.
 *
 * Slates are kept after the election resolves (status `archived`) so the
 * chair has a historical view of who they tried to recruit and how it went.
 */
export type RecruitmentSlatePriority = "high" | "defend" | "primary_threat" | "none";

export interface RecruitmentSlate {
  _id: ObjectId;
  countryId: CountryId;
  /** PoliticalParty.sequentialId as a string — same encoding used by caucuses + standing orders. */
  partyId: string;

  electionId: ObjectId;

  /** Denormalized for the country-map view (state aggregates without joining to elections). */
  state: string;
  /** Denormalized snapshot of `Election.electionType` so archived slates remain readable. */
  electionType: string;

  /** Chair-set strategic tag. Drives auto-fill ordering and UI tinting. */
  priority: RecruitmentSlatePriority;

  /** Free-form chair note shown on the slate header. */
  notes?: string;

  /**
   * `archived` once the parent election resolves; we no longer auto-respond
   * or accept invites against an archived slate.
   */
  archivedAt: Date | null;

  /** Character _id of the chair who created the slate, or null if turn-loop-seeded. */
  createdBy: ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Refusal reason emitted by `decideNPPSlateResponse` when an NPP declines an
 * invitation. Stored on `SlateCandidate.refusalReason` so the chair can see
 * why the recruit fell through. Kept as a small enum (not free text) so the
 * UI can render localized labels.
 */
export type SlateRefusalReason =
  | "low_relationship"
  | "low_ambition"
  | "low_compliance"
  | "race_priority_mismatch"
  | "in_other_race"
  | "cooldown"
  | "retired";

export type SlateCandidateStatus =
  "invited" | "considering" | "accepted" | "declined" | "withdrawn" | "filed";

export type SlateCandidateType = "npp" | "character";

export interface SlateCandidate {
  _id: ObjectId;
  slateId: ObjectId;

  /** Denormalized for fast queries (e.g. "all slate rows for this election"). */
  electionId: ObjectId;
  partyId: string;
  countryId: CountryId;

  candidateType: SlateCandidateType;
  /** NPP._id when candidateType="npp"; Character._id when candidateType="character". */
  candidateId: ObjectId;
  /** Snapshot of the candidate's display name at invite time. Stable when names change. */
  candidateName: string;
  /** Snapshot of the candidate's home state at invite time. */
  homeState: string;
  /** Character who manually assigned the row, if any. */
  assignedByCharacterId?: ObjectId | null;
  /** Snapshot of the assigner's display name for audit/UI readability. */
  assignedByCharacterName?: string | null;
  /** Snapshot of the assigning office so state-chair buffs persist even if roles later change. */
  assignedByRole?: SlateAssignerRole | null;

  status: SlateCandidateStatus;

  /**
   * Deterministic 0–100 fit score computed at invite time from
   * relationship + ambition + race priority. Surfaced on the slate row so
   * the chair sees why the resolver leans the way it does.
   */
  fitScore: number;

  /** Optional invitation note from the chair. */
  invitationNote?: string;

  /** Set when the resolver writes a decline; null otherwise. */
  refusalReason: SlateRefusalReason | null;

  /**
   * `true` when the row was inserted by the turn loop (incumbent auto-slate
   * or unfilled-slot fallback). Chair-issued invites have `autoFilled: false`.
   */
  autoFilled: boolean;

  /** Set when the candidate (or the resolver, on their behalf) responds. */
  invitedAt: Date;
  respondedAt: Date | null;

  /** Stamped when the candidate gets converted into an `ElectionCandidate` row. */
  filedAt: Date | null;

  createdAt: Date;
  updatedAt: Date;
}
