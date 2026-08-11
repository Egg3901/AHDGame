import type { ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";

/** Per-country national military doctrine (adopted nodes + remaining doctrine points). */
export interface NationalDoctrine {
  _id: ObjectId;
  countryId: CountryId;
  adopted: Record<string, number>;
  points: number;
}
