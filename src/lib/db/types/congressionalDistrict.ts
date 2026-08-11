import type { ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";

/** One district's electorate as 16 voter squares. left + right + grey === 16. */
export interface DistrictSquares {
  left: number; // 0..16
  right: number; // 0..16
  grey: number; // 0..16
}

export type DistrictSource = "cookpvi" | "registration" | "redraw";

export interface CongressionalDistrict {
  /** `${countryId}_${stateId}_${index}` e.g. "US_CA_1" */
  _id: string;
  countryId: CountryId;
  stateId: string;
  index: number; // 1..N (N = state.houseDistricts)
  squares: DistrictSquares;
  /** cached = right - left, range -16..+16 */
  netLean: number;
  /** cached = grey / 16, the swing weight */
  greyShare: number;
  holderCharacterId: ObjectId | null;
  /** Set instead of holderCharacterId when the seat is held by an NPP (id in
   *  the `npps` collection, not `characters`). At most one holder id is set. */
  holderNppId: ObjectId | null;
  holderParty: string | null;
  source: DistrictSource;
  /** census year of the last redraw, or null if never redrawn */
  lastRedrawnCensus: number | null;
  createdAt: Date;
  updatedAt: Date;
}
