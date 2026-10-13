/** Parent directions select existing NPP strategy rails without overriding survival or player autonomy. */
import type { GroupDirection } from "../managementTypes";
import {
  strategyLevers,
  type NppCorpStrategy,
  type StrategyLevers,
} from "@/lib/turn/npp/corpStrategy";
export function groupDirectionLevers(
  base: NppCorpStrategy,
  direction: GroupDirection | undefined,
  context: {
    turn: number;
    ceoId: string;
    ceoTenureKey?: string;
    rootId: string;
    isNpp: boolean;
    caretaker: boolean;
    distressed: boolean;
  }
): StrategyLevers {
  const normal = strategyLevers(base);
  if (
    !direction ||
    !context.isNpp ||
    context.caretaker ||
    direction.ceoId !== context.ceoId ||
    direction.ceoTenureKey !== context.ceoTenureKey ||
    direction.rootId !== context.rootId ||
    direction.setTurn >= context.turn
  )
    return { ...normal };
  const target: NppCorpStrategy =
    direction.objective === "profit"
      ? "harvest"
      : direction.objective === "stability"
        ? "defend"
        : "expand";
  const result = {
    ...(context.distressed || direction.objective === "balanced" ? normal : strategyLevers(target)),
  };
  if (direction.objective === "capacity") result.allowExpansion = false;
  if (!direction.allowInvestment) {
    result.allowExpansion = false;
    result.allowGrowthCapex = false;
    result.growthDelta = Math.min(0, result.growthDelta);
  }
  return result;
}
export function activeGroupDirection(
  direction: GroupDirection | undefined,
  context: {
    turn: number;
    ceoId: string;
    ceoTenureKey?: string;
    rootId: string;
    isNpp: boolean;
    caretaker: boolean;
  }
): GroupDirection | undefined {
  return direction &&
    context.isNpp &&
    !context.caretaker &&
    direction.ceoId === context.ceoId &&
    direction.ceoTenureKey === context.ceoTenureKey &&
    direction.rootId === context.rootId &&
    direction.setTurn < context.turn
    ? direction
    : undefined;
}
