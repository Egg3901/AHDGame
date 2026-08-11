import type { ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { DistrictSquares } from "./congressionalDistrict";

export interface RedistrictCapsSnapshot {
  canDraw: boolean;
  maxDistrictDeviation: number;
  maxPackedDistricts: number;
  efficiencyGapCeiling: number;
}

export interface RedistrictLedgerEntry {
  _id: ObjectId;
  countryId: CountryId;
  stateId: string;
  censusYear: number;
  actorCharacterId: ObjectId;
  actorParty: string;
  before: DistrictSquares[]; // indexed 0..N-1, district index = i+1
  after: DistrictSquares[];
  lawSnapshot: RedistrictCapsSnapshot;
  createdAt: Date;
}
