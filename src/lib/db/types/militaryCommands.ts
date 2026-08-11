import type { ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { MilitaryCommand } from "@/lib/military/types";

/** Per-country military command structure (the defense minister's org planning). */
export interface MilitaryCommandsDoc {
  _id: ObjectId;
  countryId: CountryId;
  commands: MilitaryCommand[];
}
