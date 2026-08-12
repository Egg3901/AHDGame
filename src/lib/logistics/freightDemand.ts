export type FreightDemandEntry = {
  /** Origin-state interstate haul TEU (shadow ledger). */
  bulk: number;
  special: number;
  /** bulk + special haul load. */
  total: number;
  /** Freight commodity supply in this state (TEU capacity logistics clear against). */
  capacity: number;
};
