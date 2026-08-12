import type { CountryId } from "@/lib/constants/countries";

export interface FreightDemandEntry {
  /** Origin-state interstate haul TEU (shadow ledger). */
  bulk: number;
  special: number;
  /** bulk + special haul load. */
  total: number;
  /** Freight commodity supply in this state (TEU capacity logistics clear against). */
  capacity: number;
}

/** JSON contract returned by the map logistics endpoint. */
export interface FreightDemandResponse {
  countryId: CountryId;
  turn: number | null;
  states: Record<string, FreightDemandEntry>;
}
