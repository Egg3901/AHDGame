/**
 * Media reach is funded ad attention that cleared through the commercial market
 * or a completed political seller receipt. `addSettledPoliticalAttention`
 * excludes plans whose seller payouts have not settled.
 */

export interface MediaEditorialPosition {
  economic: number;
  social: number;
}

export interface MediaReachOutlet {
  corporationId: string;
  stance: MediaEditorialPosition;
  audienceShare: number;
  /** Cleared advertising units used to normalize outlet reach. */
  attentionUnits: number;
}

export interface SettledPoliticalAttentionOrder {
  orderId: string;
  status: "settled" | "open" | "settling" | "rejected" | "funding";
  identity: { targetStateId: string };
  settlementPlan?: {
    sellers: Array<{
      allocationId: string;
      corporationId: string;
      units: number;
    }>;
  };
}

/** Add only completed paid seller allocations, then renormalize each state's reach. */
export function addSettledPoliticalAttention(args: {
  commercialOutletsByState: ReadonlyMap<string, readonly MediaReachOutlet[]>;
  settledOrders: readonly SettledPoliticalAttentionOrder[];
  stanceByCorporationId: ReadonlyMap<string, MediaEditorialPosition>;
}): Map<string, MediaReachOutlet[]> {
  const attentionByState = new Map<string, Map<string, number>>();
  const paidAllocationIds = new Set<string>();

  for (const order of args.settledOrders) {
    if (order.status !== "settled" || !order.settlementPlan) continue;
    for (const seller of order.settlementPlan.sellers) {
      const allocationKey = `${order.orderId}:${seller.allocationId}`;
      if (paidAllocationIds.has(allocationKey)) continue;
      if (!Number.isFinite(seller.units) || seller.units <= 0) continue;
      paidAllocationIds.add(allocationKey);
      const stateUnits = attentionByState.get(order.identity.targetStateId) ?? new Map();
      stateUnits.set(
        seller.corporationId,
        (stateUnits.get(seller.corporationId) ?? 0) + seller.units
      );
      attentionByState.set(order.identity.targetStateId, stateUnits);
    }
  }

  const allStateIds = new Set([
    ...args.commercialOutletsByState.keys(),
    ...attentionByState.keys(),
  ]);
  const result = new Map<string, MediaReachOutlet[]>();
  for (const stateId of allStateIds) {
    const outletsByCorporation = new Map<string, MediaReachOutlet>();
    for (const outlet of args.commercialOutletsByState.get(stateId) ?? []) {
      outletsByCorporation.set(outlet.corporationId, { ...outlet });
    }
    for (const [corporationId, paidUnits] of attentionByState.get(stateId) ?? []) {
      const outlet = outletsByCorporation.get(corporationId) ?? {
        corporationId,
        stance: args.stanceByCorporationId.get(corporationId) ?? { economic: 0, social: 0 },
        audienceShare: 0,
        attentionUnits: 0,
      };
      outlet.attentionUnits += paidUnits;
      outletsByCorporation.set(corporationId, outlet);
    }

    const totalAttention = [...outletsByCorporation.values()].reduce(
      (total, outlet) => total + outlet.attentionUnits,
      0
    );
    result.set(
      stateId,
      [...outletsByCorporation.values()].map((outlet) => ({
        ...outlet,
        audienceShare: totalAttention > 0 ? outlet.attentionUnits / totalAttention : 0,
      }))
    );
  }
  return result;
}
