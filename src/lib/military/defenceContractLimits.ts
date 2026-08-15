import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { SEED_UPKEEP_TARGET_SHARE } from "@/lib/military/appropriation";

/** Contracts are budgeted in quarter-year tranches, not against an unlimited future stream. */
export const DEFENCE_CONTRACT_WINDOW_TURNS = TURNS_PER_YEAR / 4;

/** No supplier may control more than one third of a country's contracting tranche. */
export const DEFENCE_CONTRACT_SUPPLIER_SHARE = 1 / 3;

export interface DefenceContractWindow {
  id: string;
  index: number;
  startTurn: number;
  endTurn: number;
}

export interface DefenceContractLotCaps {
  countryLots: number;
  supplierLots: number;
  procurementNotional: number;
}

export function defenceContractWindow(countryId: string, turn: number): DefenceContractWindow {
  const normalizedTurn = Math.max(1, Math.floor(turn));
  const index = Math.floor((normalizedTurn - 1) / DEFENCE_CONTRACT_WINDOW_TURNS);
  const startTurn = index * DEFENCE_CONTRACT_WINDOW_TURNS + 1;
  return {
    id: `${countryId}:${index}`,
    index,
    startTurn,
    endTurn: startTurn + DEFENCE_CONTRACT_WINDOW_TURNS - 1,
  };
}

/**
 * Maximum new obligations in one contracting window.
 *
 * The appropriation spends 55% of the annual defence line sustaining the seeded force, so
 * only the remaining 45% is a procurement budget. A 12-turn window receives one quarter of
 * that annual amount. The supplier cap then prevents a minister from converting the whole
 * national tranche into one corporation's cash balance.
 */
export function defenceContractLotCaps(
  defenseLine: number,
  pricePerLot: number
): DefenceContractLotCaps {
  if (!(defenseLine > 0) || !(pricePerLot > 0)) {
    return { countryLots: 0, supplierLots: 0, procurementNotional: 0 };
  }

  const procurementNotional =
    defenseLine * (1 - SEED_UPKEEP_TARGET_SHARE) * (DEFENCE_CONTRACT_WINDOW_TURNS / TURNS_PER_YEAR);
  const countryLots = Math.max(0, Math.floor(procurementNotional / pricePerLot));
  const supplierLots =
    countryLots > 0 ? Math.max(1, Math.floor(countryLots * DEFENCE_CONTRACT_SUPPLIER_SHARE)) : 0;
  return { countryLots, supplierLots, procurementNotional };
}
