import type { PartyBudget } from "@/lib/db/types";

type TreasuryPlanSource = Pick<
  PartyBudget,
  "transferReserveAmount" | "memberSupportReserveAmount" | "nppRecruitmentReserveAmount"
> | null;

export interface TreasuryReserveTargets {
  transferReserveAmount: number;
  memberSupportReserveAmount: number;
  nppRecruitmentReserveAmount: number;
}

export interface TreasuryReserveSummary extends TreasuryReserveTargets {
  totalReserveTarget: number;
  discretionaryTreasury: number;
}

export interface TreasuryForecast {
  netHourlyTreasuryChange: number;
  turnsUntilZero: number | null;
  turnsUntilReserveFloor: number | null;
  turnsToReachReserveFloor: number | null;
}

function coerceNonNegative(value: number | null | undefined): number {
  return Number.isFinite(value) && (value ?? 0) > 0 ? Number((value as number).toFixed(6)) : 0;
}

export function getTreasuryReserveTargets(source: TreasuryPlanSource): TreasuryReserveTargets {
  return {
    transferReserveAmount: coerceNonNegative(source?.transferReserveAmount),
    memberSupportReserveAmount: coerceNonNegative(source?.memberSupportReserveAmount),
    nppRecruitmentReserveAmount: coerceNonNegative(source?.nppRecruitmentReserveAmount),
  };
}

export function getTreasuryReserveSummary(
  treasury: number | null | undefined,
  source: TreasuryPlanSource
): TreasuryReserveSummary {
  const targets = getTreasuryReserveTargets(source);
  const totalReserveTarget =
    targets.transferReserveAmount +
    targets.memberSupportReserveAmount +
    targets.nppRecruitmentReserveAmount;

  return {
    ...targets,
    totalReserveTarget,
    discretionaryTreasury: Math.max(0, Number(((treasury ?? 0) - totalReserveTarget).toFixed(6))),
  };
}

export function getTreasuryForecast(
  treasury: number | null | undefined,
  netHourlyTreasuryChange: number,
  source: TreasuryPlanSource
): TreasuryForecast {
  const currentTreasury = treasury ?? 0;
  const { totalReserveTarget } = getTreasuryReserveSummary(currentTreasury, source);

  const turnsUntilZero =
    netHourlyTreasuryChange < 0 && currentTreasury > 0
      ? Math.ceil(currentTreasury / Math.abs(netHourlyTreasuryChange))
      : null;

  const reserveGap = currentTreasury - totalReserveTarget;
  const turnsUntilReserveFloor =
    netHourlyTreasuryChange < 0 && reserveGap > 0
      ? Math.ceil(reserveGap / Math.abs(netHourlyTreasuryChange))
      : null;

  const turnsToReachReserveFloor =
    netHourlyTreasuryChange > 0 && currentTreasury < totalReserveTarget
      ? Math.ceil((totalReserveTarget - currentTreasury) / netHourlyTreasuryChange)
      : null;

  return {
    netHourlyTreasuryChange,
    turnsUntilZero,
    turnsUntilReserveFloor,
    turnsToReachReserveFloor,
  };
}

export function wouldTriggerTreasuryReserveOverride(
  treasury: number | null | undefined,
  amount: number,
  source: TreasuryPlanSource
): boolean {
  const currentTreasury = treasury ?? 0;
  const { totalReserveTarget } = getTreasuryReserveSummary(currentTreasury, source);
  return currentTreasury - amount < totalReserveTarget;
}
