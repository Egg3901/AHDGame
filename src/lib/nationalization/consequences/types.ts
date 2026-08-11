import type { ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { CorporationType } from "@/lib/constants/corporations";
import type { CompensationTier } from "../constants";
// Reuse the canonical trigger union from eligibility (npc | unowned | distress |
// strategic | monopoly | supermajority) so the route can pass `elig.triggers`
// straight through with no remapping. Imported for local use + re-exported.
import type { NationalizationTrigger } from "../eligibility";

/** Authority path that fired the taking (politics differ by path). */
export type NationalizationMethod = "executive" | "legislative" | "supermajority";

export type { NationalizationTrigger };

/** Everything the consequences layer needs to compute + apply politics. */
export interface ConsequenceContext {
  countryId: CountryId;
  method: NationalizationMethod;
  tier: CompensationTier;
  triggers: NationalizationTrigger[];
  /** Sector types involved (drives sector-flavored approval framing). */
  sectorTypes: CorporationType[];
  /** ₳ value seized (valuation × 1.0, pre-tier) — sizes the confidence hit. */
  valuationAnchor: number;
  /** ₳ compensation actually paid — high payout softens the confidence hit. */
  compensationAnchor: number;
  /** Home country of the former owner if foreign-owned (diplomacy record only). */
  foreignOwnerCountryId?: CountryId | null;
  /** Governing party sequential id, for the ideology multiplier (optional). */
  governingPartyId?: string | null;
  /** Turn the taking resolved (confidence stamp + history). */
  turn: number;
  /** Acting official (notifications / audit). */
  actorCharacterId?: ObjectId;
}

/** Inputs for the privatization consequences (the inverse of a taking, spec §12.1). */
export interface PrivatizationConsequenceContext {
  countryId: CountryId;
  /** Turn the privatization completed (confidence stamp + legitimacy history). */
  turn: number;
}

export interface ConsequenceResult {
  confidenceBefore: number;
  confidenceAfter: number;
  legitimacyDelta: number;
  approvalMetricNudges: { stateId: string; metricPath: string; delta: number }[];
  foreignOwnerRecorded: CountryId | null;
}
