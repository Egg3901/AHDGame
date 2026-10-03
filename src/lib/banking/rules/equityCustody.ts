/** Equity custody changes preserve the total of shareholder shares and public float. */
export function validEquityCustodyMutation(input: {
  amount: number;
  collection?: string;
  filter?: Record<string, unknown>;
  path?: string;
  set?: Record<string, unknown>;
}): boolean {
  const allowed = new Set([
    "shareholders",
    "publicFloat",
    "orderFlowWindowBuyValue",
    "orderFlowWindowSellValue",
    "pendingShareIssuance",
  ]);
  if (input.amount !== 0 || input.collection !== "corporations" || input.path !== undefined)
    return false;
  if (!input.filter || !input.set || Object.keys(input.set).some((path) => !allowed.has(path)))
    return false;
  function total(value: Record<string, unknown>): number | undefined {
    const float = value.publicFloat,
      holders = value.shareholders;
    if (
      typeof float !== "number" ||
      !Number.isFinite(float) ||
      float < 0 ||
      !Array.isArray(holders)
    )
      return undefined;
    let sum = float;
    for (const holder of holders) {
      if (
        !holder ||
        typeof holder !== "object" ||
        typeof holder.shares !== "number" ||
        !Number.isFinite(holder.shares) ||
        holder.shares < 0
      )
        return undefined;
      sum += holder.shares;
    }
    return Number.isFinite(sum) ? sum : undefined;
  }
  const before = total(input.filter),
    after = total(input.set);
  return before !== undefined && after !== undefined && Math.abs(before - after) <= 1e-6;
}
