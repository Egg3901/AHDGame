import type { ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { CompensationTier, NationalizationPath } from "@/lib/nationalization/constants";
import type { NationalizationTrigger } from "@/lib/nationalization/eligibility";

/**
 * A nationalization that has been authorized (a bill enacted) but is held in a
 * notice window before completion, so the target player can react (spec §14).
 * Resolved by `processPendingNationalizations` at `noticeDeadlineTurn`: the cited
 * conditions are re-checked and the taking either completes or cancels.
 */
export interface PendingNationalization {
  _id: ObjectId;
  countryId: CountryId;
  /** Whole-corp target (XOR `targetSectorId`). */
  targetCorporationId?: ObjectId;
  /** Single-sector target (XOR `targetCorporationId`). */
  targetSectorId?: ObjectId;
  tier: CompensationTier;
  method: NationalizationPath;
  /** Conditions cited at authorization — drive cure-cancel + completion framing. */
  triggers: NationalizationTrigger[];
  governingPartyId: string | null;
  postedAtTurn: number;
  noticeDeadlineTurn: number;
  status: "pending" | "completed" | "cancelled";
  resolvedAtTurn?: number;
  createdAt: Date;
}
