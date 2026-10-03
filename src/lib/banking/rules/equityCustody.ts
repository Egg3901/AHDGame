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
  function absent(value: unknown): boolean {
    return (
      value !== null &&
      typeof value === "object" &&
      Object.keys(value).length === 1 &&
      Reflect.get(value, "$exists") === false
    );
  }
  function total(value: Record<string, unknown>, guard = false): number | undefined {
    const float = guard && absent(value.publicFloat) ? 0 : value.publicFloat,
      holders = guard && absent(value.shareholders) ? [] : value.shareholders;
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
  const before = total(input.filter, true),
    after = total(input.set);
  return before !== undefined && after !== undefined && Math.abs(before - after) <= 1e-6;
}
