import type { ObjectId } from "mongodb";
import type { CountryId } from "../../constants/countries";
import type { CorporationType } from "../../constants/corporations";

/**
 * Audit row for one state-ownership action — a nationalization (a taking that
 * builds the National Corporation) OR a privatization (a spin-out divested back
 * to private hands). Written at action time so the public State Ownership
 * Register can show the country-wide history + per-action political cost without
 * recomputing it. Privatization rows carry no compensation `tier` and (since the
 * engine does not thread the authority path) no `method`; the `kind` distinguishes
 * `privatize_ipo` vs `privatize_auction`.
 */
export interface NationalizationLedgerEntry {
  _id: ObjectId;
  countryId: CountryId;
  /** Nationalization: the NatCorp the assets landed in. Privatization: the NatCorp they were carved out of. */
  nationalCorporationId: ObjectId;
  kind: "nationalize_sector" | "nationalize_whole" | "privatize_ipo" | "privatize_auction";
  /** Authority path. Absent on privatization rows (not threaded through the spin-out engine). */
  method?: "executive" | "legislative" | "supermajority";
  triggers: string[];
  /** Compensation tier. Absent on privatization rows (no compensation paid). */
  tier?: "fair" | "discounted" | "seizure";
  /** ₳ valuation of the asset taken / divested (pre-tier). 0 where not recorded. */
  valuationAnchor: number;
  /** ₳ compensation actually paid (shareholders / donor credit). 0 for privatization. */
  compensationAnchor: number;
  /** ₳ debt the state assumed (whole-corp takings — sum of the seized corp's bonds). */
  debtAnchor?: number;
  /** Number of shareholders settled pro-rata (whole-corp takings only). */
  shareholdersSettled?: number;
  sectorTypes: CorporationType[];
  /** Former owner's corp name (nationalization display). */
  formerCorpName?: string;
  /** Spun-out corp name (privatization display). */
  newCorpName?: string;
  /** Home country of the former owner if foreign-owned. */
  foreignOwnerCountryId?: CountryId | null;
  /** Political cost recorded at the time (from the consequences result). */
  confidenceBefore?: number;
  confidenceAfter?: number;
  legitimacyDelta?: number;
  turn: number;
  createdAt: Date;
}
