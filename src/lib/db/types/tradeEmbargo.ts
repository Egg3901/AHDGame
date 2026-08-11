import type { ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { CommodityType } from "@/lib/constants/commodities";

/**
 * An active or historical trade embargo. Temporary embargoes (origin
 * "minister") carry an `expiresTurn`; durable embargoes (origin "legislation")
 * persist until repealed. Consumed by the clearing engine in Phase 6 via
 * `TradeEmbargoEffect`; this interface locks the storage contract.
 */
export interface TradeEmbargo {
  _id: ObjectId;
  /** Country imposing the embargo. */
  sourceCountry: CountryId;
  /** Country whose trade is restricted. */
  targetCountry: CountryId;
  /** Restricted commodity, or "all". */
  commodity: CommodityType | "all";
  /** Which direction (from sourceCountry's perspective). Default "export". */
  direction: "export" | "import" | "both";
  /** "block" removes the flow; "cap" limits it to `cap` units. */
  mode: "block" | "cap";
  /** Cap in commodity units when mode === "cap". */
  cap?: number;
  origin: "minister" | "legislation" | "organization";
  /** Turn the embargo lifts; undefined = durable (until repealed). */
  expiresTurn?: number;
  createdTurn: number;
  createdBy: ObjectId;
  /** For origin "legislation": the bill that enacted it (provenance + rebuild key). */
  sourceBillId?: ObjectId;
  /** For origin "organization": the org resolution that enacted it (lift key). */
  sourceResolutionId?: ObjectId;
}
