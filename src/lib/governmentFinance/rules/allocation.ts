import { currencyAmount } from "./reconciliation";
import type { PriorityAllocation, PriorityClaim } from "./types";

function allocationWeight(value: number, field: string): number {
  if (!Number.isFinite(value)) throw new Error(`${field} must be finite`);
  if (value < 0) throw new Error(`${field} cannot be negative`);
  return value;
}

function allocationOrder(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative safe integer`);
  }
  return value;
}

function allocatePartialTier(
  authority: number,
  tier: Array<PriorityAllocation & { allocationWeight?: number }>
): void {
  let remaining = authority;
  let pending = tier.filter((claim) => claim.requested > 0);

  while (remaining > 0 && pending.length > 0) {
    const hasAuthoredWeights = pending.some((claim) => claim.allocationWeight !== undefined);
    const bases = pending.map((claim) =>
      hasAuthoredWeights
        ? Math.max(0, claim.allocationWeight ?? 0)
        : Math.max(0, claim.requested - claim.allocated)
    );
    let basisTotal = bases.reduce((sum, basis) => sum + basis, 0);
    if (basisTotal === 0) {
      for (let index = 0; index < pending.length; index += 1) {
        bases[index] = pending[index]!.requested - pending[index]!.allocated;
      }
      basisTotal = bases.reduce((sum, basis) => sum + basis, 0);
    }
    if (basisTotal === 0) return;

    const capped = pending.filter((claim, index) => {
      const room = claim.requested - claim.allocated;
      return (remaining * bases[index]!) / basisTotal >= room;
    });
    if (capped.length > 0) {
      for (const claim of capped) {
        const room = claim.requested - claim.allocated;
        claim.allocated += room;
        remaining -= room;
      }
      const cappedIds = new Set(capped.map((claim) => claim.id));
      pending = pending.filter((claim) => !cappedIds.has(claim.id));
      continue;
    }

    const provisional = pending.map((claim, index) => {
      const exact = (remaining * bases[index]!) / basisTotal;
      const allocated = Math.floor(exact);
      claim.allocated += allocated;
      return { claim, remainder: exact - allocated };
    });
    let residual =
      remaining -
      provisional.reduce(
        (sum, row) =>
          sum + Math.floor((remaining * bases[pending.indexOf(row.claim)]!) / basisTotal),
        0
      );
    provisional.sort((a, b) => b.remainder - a.remainder || a.claim.id.localeCompare(b.claim.id));
    for (const row of provisional) {
      if (residual === 0) break;
      if (row.claim.allocated < row.claim.requested) {
        row.claim.allocated += 1;
        residual -= 1;
      }
    }
    remaining = 0;
  }
}

export function allocateByPriority(
  authority: number,
  claims: PriorityClaim[]
): PriorityAllocation[] {
  let remaining = currencyAmount(authority, "authority");
  const result = new Map<
    string,
    PriorityAllocation & { allocationOrder?: number; allocationWeight?: number }
  >();
  for (const claim of claims) {
    if (!claim.id) throw new Error("priority claim id cannot be empty");
    if (result.has(claim.id)) throw new Error(`duplicate priority claim: ${claim.id}`);
    if (!Number.isInteger(claim.priority) || claim.priority < 1 || claim.priority > 7) {
      throw new Error(`invalid priority claim tier: ${claim.id}`);
    }
    result.set(claim.id, {
      id: claim.id,
      priority: claim.priority,
      requested: currencyAmount(claim.requested, `claim.${claim.id}.requested`),
      allocated: 0,
      ...(claim.allocationOrder !== undefined
        ? {
            allocationOrder: allocationOrder(
              claim.allocationOrder,
              `claim.${claim.id}.allocationOrder`
            ),
          }
        : {}),
      ...(claim.allocationWeight !== undefined
        ? {
            allocationWeight: allocationWeight(
              claim.allocationWeight,
              `claim.${claim.id}.allocationWeight`
            ),
          }
        : {}),
    });
  }

  for (const priority of [1, 2, 3, 4, 5, 6, 7] as const) {
    const tier = [...result.values()].filter((claim) => claim.priority === priority);
    const orders = [...new Set(tier.map((claim) => claim.allocationOrder ?? 0))].sort(
      (a, b) => a - b
    );
    for (const order of orders) {
      if (remaining === 0) break;
      const orderedTier = tier.filter((claim) => (claim.allocationOrder ?? 0) === order);
      const requested = orderedTier.reduce((sum, claim) => sum + claim.requested, 0);
      if (requested === 0) continue;
      if (remaining >= requested) {
        for (const claim of orderedTier) claim.allocated = claim.requested;
        remaining -= requested;
        continue;
      }

      allocatePartialTier(remaining, orderedTier);
      remaining = 0;
    }
  }

  return claims.map((claim) => result.get(claim.id)!);
}
