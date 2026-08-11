import type { ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { IterationStampFields } from "./gameState";

/**
 * Unified cabinet member document — works for all countries.
 * Collection: "cabinetMembers"
 * One document per active cabinet appointment.
 */
export interface UnifiedCabinetMember extends IterationStampFields {
  _id: ObjectId;
  countryId: CountryId;
  positionId: string;
  /**
   * Character holder. `null` when the seat is held by an NPP (see `isNPP` /
   * `nppId`) — e.g. a fully-autonomous NPP government's directly-filled cabinet.
   * Mirrors the `ElectedOfficial` nullable-character + NPP-id pattern.
   */
  characterId: ObjectId | null;
  characterName: string;
  party?: string;
  /** True when this seat is held by an NPP rather than a character. */
  isNPP?: boolean;
  /** The seated NPP's id when `isNPP` is true. */
  nppId?: ObjectId;

  /**
   * Who appointed this member (head-of-gov character id). `null` when the
   * appointing head of government is itself an NPP (see `appointedByNppId`).
   */
  appointedByCharacterId: ObjectId | null;
  /** The appointing head-of-gov's NPP id, when appointed by an NPP government. */
  appointedByNppId?: ObjectId;
  appointedAt: Date;
  /** When the appointment was confirmed (US: senate vote; UK: immediate) */
  confirmedAt?: Date;

  /** Ministerial action pool (0-2, refills daily at midnight Eastern Time) */
  ministerialActions: number;
  /** YYYY-MM-DD (`America/New_York`) for the last daily action refill */
  lastMinisterialActionResetDay?: string;
  /** @deprecated Legacy turn-based regen marker — no longer consulted */
  lastActionGrantedTurn?: number;
  /** Custom banner image for office page */
  bannerImageUrl?: string;

  createdAt: Date;
  updatedAt: Date;
}
