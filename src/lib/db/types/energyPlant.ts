import type { ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";

export type EnergySource = "coal" | "gas" | "nuclear" | "hydro" | "wind" | "solar";

/**
 * A power plant owned by a country's energy seat, sited in a region. The region's
 * plants form its generation mix (the single source of truth; the mix is the
 * aggregate). Generalizes the Estates roster with source-typed capacity.
 */
export interface EnergyPlant {
  _id: ObjectId;
  countryId: CountryId;
  positionId: string; // resolved owning energy seat
  source: EnergySource;
  name: string; // player-editable label
  icon: string; // energyUi icon key
  capacityBase: number; // MW before tier
  tier: 0 | 1 | 2 | 3; // capacity multiplier (Upgrade lever)
  regionId: string; // states._id; set at Build, fixed
  createdTurn: number;
}
