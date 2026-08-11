import type { CountryId } from "../../constants/countries";

export interface Seat {
  _id: string; // The seatId: "US-senate-PA-1"
  countryId: CountryId;
  electionType: string;
  state: string; // Raw region ID (e.g., "PA" or "LON")
  senateClass?: 1 | 2 | 3;
  /** Chamber class for class-staggered chambers other than US Senate (e.g. JP Sangiin Class 1/2). */
  chamberClass?: 1 | 2;

  totalSeats?: number; // For multi-seat races
  displayName: string; // "Pennsylvania Senate (Class 1)"
  shortName: string; // "PA Senate-1"

  createdAt: Date;
  updatedAt: Date;
}
