/**
 * NPC plant operation. Demand-limited, losing plants can park spare capacity.
 * nppOperatingCapacityTarget restores it when buyers or physical constraints require it.
 */
import { activeCapacityFraction } from "@/lib/corporations/investment/rules";
import { DEMAND_THROTTLE_FLOOR } from "./demandThrottle";
import { IDLE_RETIRE_HEADROOM, IDLE_RETIRE_STRUCTURAL_THROTTLE } from "./idleCapacityRetirement";

export interface NppOperatingCapacityInput {
  eligible: boolean;
  mothballed: boolean;
  activePercent?: number;
  demandThrottle?: number | null;
  measuredProfit?: number;
  measuredTurn?: number;
  currentTurn: number;
  /** Undefined means reservations were not resolved, rather than zero demand. */
  contractDemand?: number;
  /** Every positive output leg must have an authoritative current book. */
  outputBooks: readonly ({ supply: number; demand: number } | undefined)[];
  physicalConstraintsClear: boolean;
  constructionOrRetool: boolean;
}

/** Reversible operation; existing retirement and demand-probe constants provide headroom. */
export function nppOperatingCapacityTarget(input: NppOperatingCapacityInput): number | null {
  if (!input.eligible || input.mothballed) return null;
  const current = 100 * activeCapacityFraction({ activeCapacityPercent: input.activePercent });
  const fresh =
    input.measuredTurn === input.currentTurn || input.measuredTurn === input.currentTurn - 1;
  const booksClear =
    input.outputBooks.length > 0 &&
    input.outputBooks.every(
      (book) =>
        book != null &&
        Number.isFinite(book.supply) &&
        Number.isFinite(book.demand) &&
        book.supply >= 0 &&
        book.demand >= 0 &&
        book.demand <= book.supply
    );
  const unsafe =
    !fresh ||
    !booksClear ||
    !input.physicalConstraintsClear ||
    input.constructionOrRetool ||
    input.contractDemand !== 0;
  if (unsafe) return current < 100 ? 100 : null;
  const throttle = input.demandThrottle;
  if (
    typeof throttle !== "number" ||
    !Number.isFinite(throttle) ||
    throttle <= 0 ||
    throttle > 1 ||
    !Number.isFinite(input.measuredProfit)
  )
    return current < 100 ? 100 : null;

  const target = Math.min(
    100,
    Math.max(100 * DEMAND_THROTTLE_FLOOR, current * throttle * (1 + IDLE_RETIRE_HEADROOM))
  );
  // Reactivate as demand grows. Only measured losses justify contracting.
  if (
    target < current &&
    !(input.measuredProfit! < 0 && throttle < IDLE_RETIRE_STRUCTURAL_THROTTLE)
  )
    return null;
  const rounded = Math.round(target * 100) / 100;
  return rounded !== current ? rounded : null;
}
