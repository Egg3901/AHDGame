import type { ObjectId } from "mongodb";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { CountryId } from "@/lib/constants/countries";

/** Why a corporation left the game. */
export type CorporationExitReason =
  | "voluntary_closure"
  | "npp_insolvency"
  | "bond_default"
  | "shareholder_vote"
  | "owner_deleted"
  | "forced_liquidation"
  | "acquired"
  | "hostile_takeover"
  | "nationalized"
  | "privatization_reabsorbed"
  | "national_corporation_merged"
  | "federation_custody";

/** Who controlled the corporation when it left. */
export type CorporationExitOwnerKind = "player" | "npp" | "state";

/**
 * One row per corporation that has left the game, stored in `corporationExits`.
 * Append-only: `_id` is the corporation's own id, so a second write for the same
 * corporation is a no-op. The corporation document itself is deleted on exit, so
 * this is the only durable record of why it went. Money fields are in
 * `currencyCode` (the corporation's own currency), as of the moment of exit.
 */
export interface CorporationExit {
  _id: ObjectId;
  corporationId: ObjectId;
  name: string;
  sequentialId?: number;
  countryId: CountryId;
  /** Sector type of the corporation (e.g. "manufacturing"). */
  corporationType: string;
  ownerKind: CorporationExitOwnerKind;
  turn: number;
  reason: CorporationExitReason;
  currencyCode?: CurrencyCode;
  finalCash: number;
  finalMarketCap: number;
  /** Revenue on the last stored history row; 0 when there is none. */
  finalRevenue: number;
  /** The surviving corporation, set when the exit was a merger or acquisition. */
  successorId?: ObjectId;
  createdAt: Date;
}
