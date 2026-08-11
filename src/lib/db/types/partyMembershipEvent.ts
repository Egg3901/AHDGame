import type { ObjectId } from "mongodb";
import type { CountryId } from "../../constants/countries";

export type PartyMembershipEventReason =
  "join" | "leave" | "purge" | "create_party" | "admin" | "cleanup";

export interface PartyMembershipEvent {
  _id: ObjectId;
  /** Party's country at emit time. Pre-existing field; kept as-is for back-compat. */
  countryId: CountryId;
  characterId: ObjectId;
  characterName: string;
  userId?: ObjectId | null;
  actorId?: ObjectId | null;
  actorName?: string | null;
  actorRole?: "self" | "chair" | "admin" | "system";
  oldPartyId: string | null;
  newPartyId: string | null;
  reason: PartyMembershipEventReason;
  turn: number;
  createdAt: Date;
  metadata?: Record<string, unknown>;

  // ── Snapshots (all optional; populated from this commit onward) ──
  /** Country of the prior party. `sequentialId` is per-country — disambiguates. */
  oldPartyCountryId?: CountryId | null;
  /** Country of the new party. `null` when newPartyId === "independent". */
  newPartyCountryId?: CountryId | null;
  /** Display name of the prior party at write time; survives rename/delete. */
  oldPartyName?: string | null;
  /** Display name of the new party at write time; `null` for Independent. */
  newPartyName?: string | null;
  /** Character's country at event time (in case of future cross-country moves). */
  characterCountryId?: CountryId;
}
