/** Authored Cabinet action menu for the reset. Live v1 orders remain separate. */
import actions from "./actionCatalog.json";
import type { ResetCountry } from "@/lib/resetLegislation/fundingOwner";

export type ActionCostClass = "Ops" | "Staff" | "Surge";
export type ActionScope = "Nat" | "Vet" | "NI" | "SCT" | "WAL";

export interface ResetCabinetAction {
  id: string;
  country: ResetCountry;
  seatId: string;
  slot: number;
  title: string;
  target: string;
  targetNames: readonly string[];
  strength: number;
  costClass: ActionCostClass;
  scope: ActionScope;
  brief: string;
  description: string;
}

export const resetCabinetActions: readonly ResetCabinetAction[] = actions as ResetCabinetAction[];

export function resetActionsForSeat(
  country: ResetCountry,
  seatId: string
): readonly ResetCabinetAction[] {
  return resetCabinetActions.filter(
    (action) => action.country === country && action.seatId === seatId
  );
}
