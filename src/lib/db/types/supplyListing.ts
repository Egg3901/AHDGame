import type { ObjectId } from "mongodb";
import type { CommodityType } from "@/lib/constants/commodities";
/** Non-binding advertisement. Only a separately accepted supply agreement settles. */
export interface SupplyListing {
  /** Publisher id and slot make the ten-listing limit atomic. */
  _id: string;
  corporationId: ObjectId;
  publishedByUserId: string;
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
  slot: number;
  own: boolean;
  side: "buy" | "sell";
  commodity: CommodityType;
  stateId?: string;
  volumeCap: number;
  pricePremium: number;
  durationTurns?: number;
  expiresAtTurn: number;
}
