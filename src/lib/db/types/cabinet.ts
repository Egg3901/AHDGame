import type { ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { WhippedFromVoteMap } from "./legislation";
import type { IterationStampFields } from "./gameState";

export type CabinetNominationStatus =
  "proposed" | "active" | "confirmed" | "rejected" | "withdrawn";

export interface CabinetMember extends IterationStampFields {
  _id: ObjectId;
  countryId: CountryId;
  positionId: string;
  characterId: ObjectId;
  characterName: string;
  party?: string;
  /**
   * @deprecated Legacy name, written only by the US confirmation path. The
   * collection's canonical field is `appointedByCharacterId` on
   * {@link UnifiedCabinetMember}, which the UK, NPP and acting paths all write
   * and which `caretakerMinister` queries. Write both until the two types are
   * unified.
   */
  appointedByPresidentId: ObjectId;
  /** Canonical appointer field, mirroring {@link UnifiedCabinetMember}. */
  appointedByCharacterId?: ObjectId | null;
  /** When the seat was filled, mirroring {@link UnifiedCabinetMember}. */
  appointedAt?: Date;
  /** True when appointed directly by the executive without legislative confirmation. */
  acting?: boolean;
  /** Turn the acting appointment was seated. Absent on confirmed holders. */
  actingSinceTurn?: number;
  /** Turn the acting appointment lapses: `actingSinceTurn + ACTING_TENURE_TURNS`. */
  actingExpiresOnTurn?: number;
  confirmedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface CabinetNomination extends IterationStampFields {
  _id: ObjectId;
  countryId: CountryId;
  positionId: string;
  nomineeCharacterId: ObjectId;
  nomineeCharacterName: string;
  nomineeParty?: string;
  proposedByPresidentId: ObjectId;
  proposedByPresidentName: string;
  status: CabinetNominationStatus;
  /** Senate votes (cabinet nominations + VP nominations). */
  votesFor: number;
  votesAgainst: number;
  votesAbstain: number;
  votes: Record<string, "for" | "against" | "abstain">;
  /** House votes (VP nominations only — 25th Amendment requires both chambers). */
  houseVotesFor?: number;
  houseVotesAgainst?: number;
  houseVotesAbstain?: number;
  houseVotes?: Record<string, "for" | "against" | "abstain">;
  whippedFromVote?: WhippedFromVoteMap;
  votingStartedAt?: Date;
  votingEndsAt?: Date;
  /** Game-clock turn on which voting closes. Server resolution uses this. */
  votingEndsOnTurn?: number;
  confirmedAt?: Date;
  rejectedAt?: Date;
  proposedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}
