import type { CountryId } from "../../constants/countries";

/**
 * Per-turn historical snapshot for party trends.
 *
 * One document per party per turn. Used for charting organization and
 * membership over time on the parties page.
 */
export interface PartyHistorySnapshot {
  /** Composite snapshot id: `${countryId}:${partyId}:${turn}` */
  _id: string;
  countryId: CountryId;
  partyId: string;
  turn: number;
  organization: number;
  playerCount: number;
  nppCount: number;
  memberCount: number;
  createdAt: Date;
}
