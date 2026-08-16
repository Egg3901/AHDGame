/**
 * Issue-bond income preview, in the same daily/turn units the rest of the
 * corporation UI uses.
 *
 * Coupon cost is annual % × face, then divided by the two financial days in a
 * game year (48 turns / 24 turns-per-day). The preview compares that daily
 * coupon against retained daily income so "Income after" matches what will
 * actually hit cash, not the nameplate projection (ticket #1109).
 */

import { GROWTH_RATE_TURNS_PER_YEAR, TURNS_PER_DAY } from "@/lib/constants/corporations";

const GAME_DAYS_PER_YEAR = GROWTH_RATE_TURNS_PER_YEAR / TURNS_PER_DAY;

export function bondIssueIncomePreview(args: {
  retainedDaily: number;
  couponRatePercent: number;
  faceValue: number;
}): {
  annualCost: number;
  dailyCost: number;
  incomeBeforePerTurn: number;
  incomeAfterPerTurn: number;
  staysProfitable: boolean;
} {
  const annualCost = (args.couponRatePercent / 100) * args.faceValue;
  const dailyCost = annualCost / GAME_DAYS_PER_YEAR;
  return {
    annualCost,
    dailyCost,
    incomeBeforePerTurn: args.retainedDaily / TURNS_PER_DAY,
    incomeAfterPerTurn: (args.retainedDaily - dailyCost) / TURNS_PER_DAY,
    staysProfitable: args.retainedDaily - dailyCost >= 0,
  };
}
