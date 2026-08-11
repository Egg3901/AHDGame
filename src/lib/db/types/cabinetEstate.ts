import type { ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";

export type EstateFundingLevel = "reduced" | "standard" | "enhanced";

/**
 * A facility/program owned by a domestic cabinet seat (or, for Foreign, an
 * installation sited abroad). Generalizes the military order-of-battle: a
 * regionally-sited (or country-sited, for Foreign) asset with a funding lever,
 * a capacity tier, and a condition that drifts toward its funding baseline.
 */
export interface CabinetEstate {
  _id: ObjectId;
  countryId: CountryId; // the OWNING country (the cabinet member's country)
  portfolioKey: string; // canonical portfolio, e.g. "education"
  positionId: string; // resolved owning seat, e.g. "secretary_of_education"
  archetypeId: string; // key into the portfolio catalog, e.g. "public_school"
  name: string; // player-editable label
  icon: string; // estatesUi icon key
  fundingLevel: EstateFundingLevel; // Fund lever (≈ posture)
  tier: 0 | 1 | 2 | 3; // Expand lever (≈ techTier)
  condition: number; // 0-100, drifts toward funding baseline (≈ readiness)
  outputBase: number; // display capacity (≈ personnel); NOT in the effect formula
  upkeepBase: number; // M/turn before tier/funding multipliers
  siteScope: "region" | "country"; // domestic = region; foreign = abroad
  siteId: string; // states._id (region) OR host CountryId (country); set at Open, fixed
  createdTurn: number;
}
