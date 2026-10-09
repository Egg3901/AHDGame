export const POSITION_UPDATE_VOUCHER_GRANT_AMOUNT = 1;
export const POLICY_SHIFT_ACTION_COST = 15;
export const POLICY_SHIFT_INFAMY_COST = 5;
export const POLICY_SHIFT_INFLUENCE_MULTIPLIER = 0.95;

export interface PolicyShiftPayment {
  actionCost: number;
  voucherCost: number;
  infamyCost: number;
  influenceMultiplier: number;
}

/**
 * Resolve the costs of a player-initiated policy shift without relying on
 * server state. The route owns the atomic balance check and persistence.
 */
export function resolvePolicyShiftPayment(useVoucher: boolean): PolicyShiftPayment {
  if (useVoucher) {
    return {
      actionCost: 0,
      voucherCost: 1,
      infamyCost: 0,
      influenceMultiplier: 1,
    };
  }

  return {
    actionCost: POLICY_SHIFT_ACTION_COST,
    voucherCost: 0,
    infamyCost: POLICY_SHIFT_INFAMY_COST,
    influenceMultiplier: POLICY_SHIFT_INFLUENCE_MULTIPLIER,
  };
}
