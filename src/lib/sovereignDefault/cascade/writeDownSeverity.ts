/**
 * Pure mapping from cascade reason to bond holder write-down severity.
 *
 * Repudiate: market price 0.05 → 95% loss. Restructure: 40% haircut.
 * Corp-default cascade levels treat downstream bonds as full loss to keep
 * the cascade simulation aggressive enough to surface in playtest; Phase 10
 * may calibrate down.
 */

import { REPUDIATE_BOND_MARKET_PRICE, RESTRUCTURE_HAIRCUT } from "../constants";

export type CascadeReason = "repudiate" | "restructure" | "corp-default";

export function computeBondWriteDownSeverity(reason: CascadeReason): number {
  switch (reason) {
    case "repudiate":
      return 1 - REPUDIATE_BOND_MARKET_PRICE;
    case "restructure":
      return RESTRUCTURE_HAIRCUT;
    case "corp-default":
      return 1.0;
  }
}
