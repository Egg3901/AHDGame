/**
 * A new monetary baseline is denominated in the currency's own account units.
 * seedExternalBroadMoney converts authored GDP through its anchor basis and
 * the world's fixed currency basis before applying the existing M2/GDP ratio.
 */
export function seedExternalBroadMoney(input: {
  storedGdp: number;
  anchorPerGdpUnit: number;
  localPerAnchor: number;
  broadMoneyToGdp: number;
}): number {
  const values = Object.values(input);
  if (values.some((value) => !Number.isFinite(value) || value < 0)) return 0;
  const localMoney =
    input.storedGdp * input.anchorPerGdpUnit * input.localPerAnchor * input.broadMoneyToGdp;
  return Number.isFinite(localMoney) ? Math.round(localMoney) : 0;
}
