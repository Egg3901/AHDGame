import type { ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";

export interface MinisterialOrder {
  _id: ObjectId;
  countryId: CountryId;
  positionId: string;
  /** Issuing minister's character, or `null` when issued by an NPP minister. */
  characterId: ObjectId | null;
  /** True when the issuing minister is an NPP. */
  isNPP?: boolean;
  /** Issuing NPP minister's id, when `isNPP` is true. */
  nppId?: ObjectId;
  orderId: string;
  orderName: string;
  effects: Array<{
    metric: string;
    modifier: number;
    scope: "national" | "regional";
    regionId?: string;
  }>;
  issuedAt: Date;
  issuedTurn: number;
  /** Turn count the order was issued for; used to recompute expiry on legacy rows. */
  duration?: number;
  expiresTurn: number;
  active: boolean;
  createdAt: Date;
}
