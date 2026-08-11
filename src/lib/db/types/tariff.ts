import type { ObjectId } from "mongodb";
import type { CorporationType } from "../../constants/corporations";
import type { CountryId } from "../../constants/countries";

export type TariffScopeType = "economy_wide" | "sector" | "origin_country" | "corporation";

export interface Tariff {
  _id: ObjectId;
  /** Country this tariff applies IN (where the bill passed — not the country being targeted) */
  countryId: CountryId;
  scopeType: TariffScopeType;
  /** scopeType = "sector" */
  targetSectorType?: CorporationType;
  /** scopeType = "origin_country" — corps HQ'd in this country are penalised */
  targetOriginCountryId?: CountryId;
  /** scopeType = "corporation" */
  targetCorporationId?: ObjectId;
  /** 0–100. 0 = nullified but retained for audit trail */
  rate: number;
  sourceBillId: ObjectId;
  createdAt: Date;
  updatedAt: Date;
}
