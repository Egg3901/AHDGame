/**
 * Internal commodity supply. allocateInternalSupply reserves finite output for
 * own plants before wholly owned group plants. Discounts create matching
 * seller charges and buyer credits; surplus remains in the open market.
 */
export interface InternalSupplyPolicy {
  priority: "market" | "own" | "group";
  discount: number;
  /** Opt in to shipping own surplus before the origin state's market buyers. */
  ownFirstAcrossStates?: boolean;
}
const GROUP_ROUTE_ID_PREFIX = "group:";
export function ownRouteIdentity(
  corporationId: string,
  setting?: { root: string; policy: InternalSupplyPolicy }
): string {
  return setting?.policy.priority === "group" && setting.policy.ownFirstAcrossStates === true
    ? GROUP_ROUTE_ID_PREFIX + setting.root
    : corporationId;
}
export function ownRouteGroupRoot(routeIdentity: string): string | undefined {
  return routeIdentity.startsWith(GROUP_ROUTE_ID_PREFIX) &&
    routeIdentity.length > GROUP_ROUTE_ID_PREFIX.length
    ? routeIdentity.slice(GROUP_ROUTE_ID_PREFIX.length)
    : undefined;
}
export function ownRoutePolicyOwner(routeIdentity: string, fallbackCorporationId: string): string {
  return ownRouteGroupRoot(routeIdentity) ?? fallbackCorporationId;
}
export const DEFAULT_INTERNAL_SUPPLY_POLICY: InternalSupplyPolicy = {
  priority: "market",
  discount: 0,
};
export interface SupplyOwner {
  id: string;
  totalShares: number;
  holders: readonly { corporationId?: string; shares: number }[];
  policy?: InternalSupplyPolicy;
}

/** Full economic ownership, never majority voting control. Cycles fail closed. */
export function resolveSupplyPolicies(
  owners: readonly SupplyOwner[]
): Map<string, { root: string; policy: InternalSupplyPolicy }> {
  const byId = new Map(owners.map((o) => [o.id, o]));
  const parent = new Map<string, string>();
  for (const o of owners) {
    if (!(Number.isFinite(o.totalShares) && o.totalShares > 0)) continue;
    const positive = o.holders.filter((h) => Number.isFinite(h.shares) && h.shares > 0);
    const ids = new Set(positive.map((h) => h.corporationId));
    if (ids.size !== 1) continue;
    const id = positive[0]?.corporationId;
    const shares = positive.reduce((n, h) => n + h.shares, 0);
    if (id && id !== o.id && byId.has(id) && Math.abs(shares - o.totalShares) < 1e-6)
      parent.set(o.id, id);
  }
  const result = new Map<string, { root: string; policy: InternalSupplyPolicy }>();
  for (const o of owners) {
    const chain = [o.id];
    let id = o.id;
    while (parent.has(id) && !chain.includes(parent.get(id)!)) {
      id = parent.get(id)!;
      chain.push(id);
    }
    if (parent.has(id)) {
      result.set(o.id, { root: o.id, policy: DEFAULT_INTERNAL_SUPPLY_POLICY });
      continue;
    }
    const groupRoot = [...chain]
      .reverse()
      .find((ancestor) => byId.get(ancestor)?.policy?.priority === "group");
    const rootPolicy = groupRoot ? byId.get(groupRoot)?.policy : undefined;
    result.set(
      o.id,
      rootPolicy?.priority === "group"
        ? { root: groupRoot!, policy: rootPolicy }
        : { root: o.id, policy: o.policy ?? DEFAULT_INTERNAL_SUPPLY_POLICY }
    );
  }
  return result;
}

/** Recorded group freight remains billable after a shipping policy is disabled. */
export function recordedGroupRouteMembers(
  owners: readonly SupplyOwner[],
  routeIdentities: readonly string[]
): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  const roots = new Set(
    routeIdentities.map(ownRouteGroupRoot).filter((root): root is string => !!root)
  );
  for (const root of roots) {
    const resolved = resolveSupplyPolicies(
      owners.map((owner) => ({
        ...owner,
        policy: owner.id === root ? { priority: "group" as const, discount: 0 } : undefined,
      }))
    );
    const members = new Set<string>();
    for (const [id, setting] of resolved)
      if (setting.root === root && setting.policy.priority === "group") members.add(id);
    result.set(root, members);
  }
  return result;
}

export interface InternalSupplyBuyer {
  sectorId: string;
  corporationId: string;
  demand: number;
  /** Existing supply agreements already claim this demand. */
  committed?: number;
  /** Delivery constraints can be tighter than aggregate supply. */
  availability: number;
}
export interface InternalSupplySeller {
  sectorId: string;
  corporationId: string;
  units: number;
  committed?: number;
}
export interface InternalSupplyTrade {
  supplierSectorId: string;
  buyerSectorId: string;
  supplierCorpId: string;
  buyerCorpId: string;
  units: number;
  discount: number;
}

export function ownRouteKey(
  commodity: string,
  corporationId: string,
  originStateId: string,
  destStateId: string
): string {
  return `${commodity}|${corporationId}|${originStateId}|${destStateId}`;
}

const positive = (n: number | undefined) =>
  typeof n === "number" && Number.isFinite(n) ? Math.max(0, n) : 0;
/** Pure allocation within ONE reachable commodity book. Never crosses a book. */
export function allocateInternalSupply(args: {
  sellers: readonly InternalSupplySeller[];
  buyers: readonly InternalSupplyBuyer[];
  policies: ReadonlyMap<string, { root: string; policy: InternalSupplyPolicy }>;
  supply: number;
  demand: number;
  reservationRoom: number;
  /** Active freight cannot invent a cross-state route reservation. */
  deliveryStateBySector?: ReadonlyMap<string, string>;
  ownRouteCaps?: ReadonlyMap<string, number>;
}): { trades: InternalSupplyTrade[]; availabilityBySector: Map<string, number> } {
  const trades: InternalSupplyTrade[] = [];
  const sellers = [...args.sellers].sort((a, b) => a.sectorId.localeCompare(b.sectorId));
  const buyers = [...args.buyers].sort((a, b) => a.sectorId.localeCompare(b.sectorId));
  const remaining = new Map(
    buyers.map((b) => [b.sectorId, Math.max(0, positive(b.demand) - positive(b.committed))])
  );
  const supplied = new Map<string, number>();
  const offers = new Map(
    sellers.map((s) => [s.sectorId, Math.max(0, positive(s.units) - positive(s.committed))])
  );
  let room = Math.min(positive(args.reservationRoom), positive(args.supply), positive(args.demand));
  const routeLeft = new Map(args.ownRouteCaps ?? []);
  const routeFor = (s: InternalSupplySeller, b: InternalSupplyBuyer) => {
    const origin = args.deliveryStateBySector?.get(s.sectorId);
    const dest = args.deliveryStateBySector?.get(b.sectorId);
    if (!origin || !dest || origin === dest) return undefined;
    const routeIdentity = ownRouteIdentity(s.corporationId, args.policies.get(s.corporationId));
    const groupKey = routeIdentity + "|" + origin + "|" + dest;
    if (routeIdentity !== s.corporationId) {
      // A former own-only receipt can still serve the seller's own plant, but
      // must never be spent on a subsidiary that was not on that group route.
      if (
        b.corporationId === s.corporationId &&
        !(routeLeft.get(groupKey) !== undefined && (routeLeft.get(groupKey) ?? 0) > 0)
      )
        return s.corporationId + "|" + origin + "|" + dest;
      return groupKey;
    }
    return s.corporationId + "|" + origin + "|" + dest;
  };

  // Own plants go first across ALL suppliers. Group plants follow, with
  // proportional allocation so array order never gives one buyer a monopoly.
  for (const ownOnly of [true, false]) {
    for (const s of sellers) {
      const setting = args.policies.get(s.corporationId);
      if (
        !setting ||
        setting.policy.priority === "market" ||
        (!ownOnly && setting.policy.priority !== "group")
      )
        continue;
      const sameCorpOk = (b: InternalSupplyBuyer) =>
        !(ownOnly ? b.corporationId !== s.corporationId : b.corporationId === s.corporationId) &&
        (ownOnly || args.policies.get(b.corporationId)?.root === setting.root);
      const eligible = buyers.filter((b) => {
        if (
          args.deliveryStateBySector &&
          (!args.deliveryStateBySector.has(s.sectorId) ||
            args.deliveryStateBySector.get(s.sectorId) !==
              args.deliveryStateBySector.get(b.sectorId))
        )
          return false;
        return sameCorpOk(b);
      });
      const groupCrossState =
        !ownOnly &&
        setting.policy.priority === "group" &&
        setting.policy.ownFirstAcrossStates === true;
      const crossState =
        args.deliveryStateBySector && routeLeft.size
          ? buyers.filter((b) => {
              const key = routeFor(s, b);
              const routeEligible = ownOnly
                ? b.corporationId === s.corporationId
                : groupCrossState && args.policies.get(b.corporationId)?.root === setting.root;
              return !!key && (routeLeft.get(key) ?? 0) > 0 && routeEligible;
            })
          : [];
      const allocate = (group: InternalSupplyBuyer[], capped: boolean) => {
        const needOf = (b: InternalSupplyBuyer) => {
          const left = remaining.get(b.sectorId) ?? 0;
          return capped ? Math.min(left, routeLeft.get(routeFor(s, b)!) ?? 0) : left;
        };
        const needs = group.map(needOf);
        const routeNeed = new Map<string, number>();
        if (capped)
          group.forEach((b, i) => {
            const key = routeFor(s, b)!;
            routeNeed.set(key, (routeNeed.get(key) ?? 0) + needs[i]!);
          });
        group.forEach((b, i) => {
          if (!capped) return;
          const key = routeFor(s, b)!;
          const total = routeNeed.get(key) ?? 0;
          const cap = routeLeft.get(key) ?? 0;
          if (total > cap && total > 0) needs[i] = (needs[i]! * cap) / total;
        });
        const need = needs.reduce((n, u) => n + u, 0);
        const take = Math.min(room, offers.get(s.sectorId) ?? 0, need);
        if (!(take > 0)) return;
        group.forEach((b, i) => {
          const units = (take * needs[i]!) / need;
          if (!(units > 0)) return;
          if (capped) {
            const key = routeFor(s, b)!;
            routeLeft.set(key, Math.max(0, (routeLeft.get(key) ?? 0) - units));
          }
          trades.push({
            supplierSectorId: s.sectorId,
            buyerSectorId: b.sectorId,
            supplierCorpId: s.corporationId,
            buyerCorpId: b.corporationId,
            units,
            discount: Math.min(0.2, positive(setting.policy.discount)),
          });
          remaining.set(b.sectorId, Math.max(0, (remaining.get(b.sectorId) ?? 0) - units));
          supplied.set(b.sectorId, (supplied.get(b.sectorId) ?? 0) + units);
        });
        room -= take;
        offers.set(s.sectorId, Math.max(0, (offers.get(s.sectorId) ?? 0) - take));
      };
      allocate(eligible, false);
      if (crossState.length) allocate(crossState, true);
    }
  }
  const availabilityBySector = internalSupplyAvailability(buyers, trades, args.supply, args.demand);

  return { trades, availabilityBySector };
}

/** Equal-and-opposite per-turn accounting legs on daily physical deliveries. */
export function internalSupplyDiscounts(
  trades: readonly InternalSupplyTrade[],
  marketUnitPriceAnchor: number,
  turnsPerDay: number
): Map<string, number> {
  const costs = new Map<string, number>();
  if (!(Number.isFinite(marketUnitPriceAnchor) && marketUnitPriceAnchor > 0 && turnsPerDay > 0))
    return costs;
  for (const t of trades) {
    const rebate =
      (positive(t.units) * marketUnitPriceAnchor * Math.min(0.2, positive(t.discount))) /
      turnsPerDay;
    costs.set(t.supplierSectorId, (costs.get(t.supplierSectorId) ?? 0) + rebate);
    costs.set(t.buyerSectorId, (costs.get(t.buyerSectorId) ?? 0) - rebate);
  }
  return costs;
}

/** Buyer availability derived from final delivered reservations, after legal caps. */
export function internalSupplyAvailability(
  buyers: readonly InternalSupplyBuyer[],
  trades: readonly InternalSupplyTrade[],
  supply: number,
  demand: number
): Map<string, number> {
  const supplied = new Map<string, number>();
  for (const trade of trades)
    supplied.set(trade.buyerSectorId, (supplied.get(trade.buyerSectorId) ?? 0) + trade.units);
  const totalReserved = trades.reduce((n, t) => n + t.units, 0);
  const residualDemand = Math.max(0, positive(demand) - totalReserved);
  const availabilityBySector = new Map<string, number>();
  for (const b of buyers) {
    if (!(positive(b.demand) > 0)) continue;
    const received = supplied.get(b.sectorId) ?? 0;
    const local = Math.min(1, positive(b.availability));
    // Reserve from the SAME finite pool. Other buyers lose access to exactly
    // the units priority buyers take; no free supply is introduced.
    const availableSupply = Math.min(positive(supply), positive(demand) * local);
    const residualAvailability =
      residualDemand > 0
        ? Math.min(1, Math.max(0, availableSupply - totalReserved) / residualDemand)
        : 0;
    // Commitments exclude eligibility above; they are not a second source of
    // physical goods beside the residual pool. Count every unreserved input once.
    const openNeed = Math.max(0, positive(b.demand) - received);
    availabilityBySector.set(
      b.sectorId,
      Math.min(1, (received + openNeed * residualAvailability) / b.demand)
    );
  }
  return availabilityBySector;
}

/** Discounts only price actual input consumption, never the unused reservation. */
export function settleConsumedInternalDiscounts(
  trades: readonly (InternalSupplyTrade & { commodity: string; marketPrice: number })[],
  consumption: ReadonlyMap<string, ReadonlyMap<string, number>>,
  turnsPerDay: number,
  committedInputs?: ReadonlyMap<string, ReadonlyMap<string, number>>
): Map<string, number> {
  const reserved = new Map<string, number>();
  for (const t of trades) {
    const key = `${t.buyerSectorId}:${t.commodity}`;
    reserved.set(key, (reserved.get(key) ?? 0) + t.units);
  }
  const costs = new Map<string, number>();
  for (const t of trades) {
    const key = `${t.buyerSectorId}:${t.commodity}`;
    const actual = Math.max(
      0,
      positive(consumption.get(t.buyerSectorId)?.get(t.commodity)) -
        positive(committedInputs?.get(t.buyerSectorId)?.get(t.commodity))
    );
    const units = t.units * Math.min(1, actual / (reserved.get(key) ?? 1));
    for (const [id, cost] of internalSupplyDiscounts([{ ...t, units }], t.marketPrice, turnsPerDay))
      costs.set(id, (costs.get(id) ?? 0) + cost);
  }
  return costs;
}
