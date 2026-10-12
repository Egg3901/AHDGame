/** Next-turn subscriptions buy ordinary units with reserved cash at one marked value. */
export function subscriptionBatchNav(input: {
  cashAnchor: number;
  holdingsValueAnchor: number;
  unitSupply: number;
  queuedUnits: number;
}): number {
  const nav =
    (input.cashAnchor + input.holdingsValueAnchor) / (input.unitSupply + input.queuedUnits);
  if (!Number.isFinite(nav) || nav <= 0) throw new Error("Subscription valuation is unavailable");
  return nav;
}
