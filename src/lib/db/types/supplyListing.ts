import type { ObjectId } from "mongodb";
import type { CommodityType } from "@/lib/constants/commodities";
/**
 * Standing offer. Posting is the publisher's consent: a taker who passes the
 * contract guards forms an active agreement for any volume up to what is left.
 */
export interface SupplyListing {
  /** Publisher id and slot make the ten-listing limit atomic. */
  _id: string;
  corporationId: ObjectId;
  /** Absent on AI-posted listings (`aiListed`). */
  publishedByUserId?: string;
  /** Standing offer posted by an AI-run corporation from spare capacity or unmet input demand. */
  aiListed?: true;
  slot: number;
  side: "buy" | "sell";
  commodity: CommodityType;
  stateId?: string;
  volumeCap: number;
  pricePremium: number;
  durationTurns?: number;
  expiresAtTurn: number;
  updatedAt: Date;
}
export interface SupplyListingView {
  id: string;
  corporationId: string;
  corporationName: string;
  /** Publisher's home country, the seller's for a sell offer. */
  corporationCountryId?: string;
  /** Publisher's credit rating, when one has been assigned. */
  creditRating?: string;
  slot: number;
  own: boolean;
  /** Posted by an AI-run corporation rather than a player. */
  ai?: boolean;
  side: "buy" | "sell";
  commodity: CommodityType;
  stateId?: string;
  volumeCap: number;
  pricePremium: number;
  durationTurns?: number;
  expiresAtTurn: number;
}
