import type { ObjectId } from "mongodb";
import type { CountryId } from "../../constants/countries";

export type WhipTargetType =
  | "bill"
  | "speakerElection"
  | "leadershipElection"
  | "pmAppointmentVote"
  | "noConfidenceVote"
  | "cabinetNomination"
  | "speakerVacateMotion"
  | "impeachmentVote";
export type WhipDirection = "for" | "against";
export type WhipIssuer = "stateParty" | "nationalParty" | "caucus";
export type WhipAudience = "npp" | "character";
export type WhipIssuerRole =
  | "chair"
  | "viceChair"
  | "admin"
  | "speaker"
  | "majorityLeader"
  | "minorityLeader"
  | "majorityWhip"
  | "minorityWhip";
export type PlayerWhipMode = "soft" | "hard";

export interface BillWhip {
  _id: ObjectId;

  // What's being whipped
  targetType: WhipTargetType;
  targetId: ObjectId | string;
  chamber:
    | "house"
    | "senate"
    | "commons"
    | "lords"
    | "stateSenate"
    | "regionalCouncil"
    | "shugiin"
    | "sangiin"
    | "bundestag"
    | "landtag"
    | (string & {});

  // Direction
  direction: WhipDirection;
  candidacyId?: ObjectId; // For leadership elections - which candidate to support

  // Who issued it
  issuedBy: WhipIssuer;
  countryId: CountryId;
  stateId?: string; // For state party whips
  partyId: string;
  caucusId?: ObjectId;
  issuedByCharacterId?: ObjectId;
  issuedByRole?: WhipIssuerRole;

  /**
   * Who the whip targets. NPP whips (default for legacy docs) drive autonomous
   * NPP voting behavior. Character whips force-overwrite player votes immediately
   * and let players revert. Treat a missing value as "npp" on read.
   */
  audience: WhipAudience;

  /**
   * Character whips can be either a soft recommendation (notification only)
   * or a hard override (immediately writes the player's vote). Legacy rows
   * without this field should be treated as "hard".
   */
  mode?: PlayerWhipMode;

  attemptNumber: 1 | 2;
  createdAt: Date;
  updatedAt: Date;
}
