/**
 * Per-cycle cap for moving issuer-side public float into real passive holders.
 * The fund engine runs once per game turn (see fundCron.ts), so this cap is
 * applied per turn, not per wall-clock hour — the original hourly design and
 * the /1200 divisor were replaced by /100 per turn (changelog: "12× faster").
 *
 * The cap deliberately scales from issued shares, not remaining float, so a
 * 5% float absorbs quickly while a very large public float still takes weeks.
 */
export function calculateHourlyPublicFloatAbsorptionCap(input: {
  totalShares: number;
  publicFloat: number;
}): number {
  const totalShares = Math.floor(input.totalShares);
  const publicFloat = Math.floor(input.publicFloat);
  if (!Number.isFinite(totalShares) || !Number.isFinite(publicFloat) || totalShares <= 0) return 0;
  if (publicFloat <= 0) return 0;

  const scaledCap = Math.max(Math.floor(totalShares / 100), 1);
  return Math.min(publicFloat, scaledCap);
}

export type FloatAbsorptionAllocation = {
  id: string;
  requestedShares: number;
  weight: number;
};

export type FloatAbsorptionFill = FloatAbsorptionAllocation & {
  filledShares: number;
};

/**
 * Split a whole-share absorption cap proportionally across funds/NPPs.
 * Remainder shares are assigned by largest fractional remainder so the total
 * fill never exceeds the issuer-side cap and deterministic callers can sort
 * their inputs before invoking this helper.
 */
export function allocatePublicFloatAbsorption(
  capShares: number,
  allocations: FloatAbsorptionAllocation[]
): FloatAbsorptionFill[] {
  const cap = Math.max(0, Math.floor(capShares));
  const eligible = allocations.filter(
    (allocation) =>
      Number.isFinite(allocation.weight) &&
      allocation.weight > 0 &&
      Number.isFinite(allocation.requestedShares) &&
      allocation.requestedShares > 0
  );

  const emptyResult = allocations.map((allocation) => ({ ...allocation, filledShares: 0 }));
  if (cap <= 0 || eligible.length === 0) return emptyResult;

  let remainingCap = cap;
  const fills = new Map<string, number>();
  const unsettled = new Map(eligible.map((allocation) => [allocation.id, allocation]));

  while (remainingCap > 0 && unsettled.size > 0) {
    const totalWeight = [...unsettled.values()].reduce(
      (sum, allocation) => sum + allocation.weight,
      0
    );
    if (totalWeight <= 0) break;

    const pass = [...unsettled.values()].map((allocation) => {
      const rawShare = (remainingCap * allocation.weight) / totalWeight;
      const fillFloor = Math.min(Math.floor(rawShare), Math.floor(allocation.requestedShares));
      return {
        allocation,
        fillFloor,
        remainder: rawShare - Math.floor(rawShare),
      };
    });

    let assignedThisPass = 0;
    for (const item of pass) {
      if (item.fillFloor <= 0) continue;
      fills.set(item.allocation.id, (fills.get(item.allocation.id) ?? 0) + item.fillFloor);
      assignedThisPass += item.fillFloor;
    }
    remainingCap -= assignedThisPass;

    for (const item of pass) {
      const filled = fills.get(item.allocation.id) ?? 0;
      if (filled >= Math.floor(item.allocation.requestedShares)) {
        unsettled.delete(item.allocation.id);
      }
    }

    if (remainingCap <= 0 || unsettled.size === 0) break;

    const byRemainder = pass
      .filter((item) => unsettled.has(item.allocation.id))
      .sort((a, b) => b.remainder - a.remainder || a.allocation.id.localeCompare(b.allocation.id));

    if (byRemainder.length === 0) break;
    let distributedRemainder = 0;
    for (const item of byRemainder) {
      if (remainingCap <= 0) break;
      const current = fills.get(item.allocation.id) ?? 0;
      if (current >= Math.floor(item.allocation.requestedShares)) continue;
      fills.set(item.allocation.id, current + 1);
      remainingCap -= 1;
      distributedRemainder += 1;
      if (current + 1 >= Math.floor(item.allocation.requestedShares)) {
        unsettled.delete(item.allocation.id);
      }
    }

    if (assignedThisPass === 0 && distributedRemainder === 0) break;
  }

  return allocations.map((allocation) => ({
    ...allocation,
    filledShares: fills.get(allocation.id) ?? 0,
  }));
}
