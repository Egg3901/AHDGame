import type { CountryId } from "@/lib/constants/countries";
import type { ReinforceMode } from "@/lib/military/manpower";

/** A nation's replacement-manpower pool and how it feeds units. */
export interface NationalManpower {
  countryId: CountryId;
  /** Men available to draw as replacements. */
  pool: number;
  /** Reinforcement mode; `conscript` requires a permitting conscription stance. */
  mode: ReinforceMode;
}
