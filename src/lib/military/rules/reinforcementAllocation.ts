export interface ReinforcementDemand {
  id: string;
  desired: number;
}

/**
 * Split a scarce national pool proportionally across every damaged formation.
 * Stable ids decide only indivisible remainder men, never who drains the whole pool.
 */
export function allocateReinforcements(
  demands: ReinforcementDemand[],
  available: number
): Map<string, number> {
  if (!Number.isFinite(available)) {
    throw new RangeError("reinforcement availability must be finite");
  }
  const ids = new Set<string>();
  for (const demand of demands) {
    if (!demand.id || ids.has(demand.id)) {
      throw new Error(`reinforcement demand ids must be unique: ${demand.id || "<empty>"}`);
    }
    if (!Number.isFinite(demand.desired)) {
      throw new RangeError(`reinforcement demand must be finite for ${demand.id}`);
    }
    ids.add(demand.id);
  }
  const valid = demands
    .filter((demand) => demand.desired > 0)
    .map((demand) => ({ ...demand, desired: Math.floor(demand.desired) }));
  const total = valid.reduce((sum, demand) => sum + demand.desired, 0);
  const budget = Math.max(0, Math.min(Math.floor(available), total));
  const result = new Map<string, number>(valid.map((demand) => [demand.id, 0]));
  if (budget === 0 || total === 0) return result;

  let assigned = 0;
  for (const demand of valid) {
    const share = Math.floor((budget * demand.desired) / total);
    result.set(demand.id, share);
    assigned += share;
  }

  const order = [...valid].sort((a, b) => a.id.localeCompare(b.id));
  for (let index = 0; assigned < budget; index = (index + 1) % order.length) {
    const demand = order[index];
    const current = result.get(demand.id) ?? 0;
    if (current >= demand.desired) continue;
    result.set(demand.id, current + 1);
    assigned += 1;
  }
  return result;
}
