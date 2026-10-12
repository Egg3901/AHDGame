/**
 * Group supply reserves finite NPP output for eligible members at 100% market value.
 * Existing obligations, input needs, available cash and legal delivery lanes bound every reservation.
 */
import { canReceiveGroupSupply, type GroupOperator } from "./participation";
import type { GroupReceivingPreference, GroupSupplyPolicy } from "../managementTypes";
export interface SupplyMember extends GroupOperator {
  /** Per-turn available cash after required commitments and reserve protection, in anchor currency. */
  cashAvailableAnchor: number;
  preference?: GroupReceivingPreference;
}
export interface SupplyOffer {
  memberId: string;
  scope: string;
  producedUnits: number;
  committedUnits: number;
}
export interface SupplyNeed {
  memberId: string;
  scope: string;
  requiredUnits: number;
  contractedUnits: number;
}
export interface GroupSupplyInput {
  turn: number;
  policy: GroupSupplyPolicy;
  members: readonly SupplyMember[];
  offers: readonly SupplyOffer[];
  needs: readonly SupplyNeed[];
  /** Benchmark on the same era, unit and market scope basis as physical quantities. */
  marketPriceByScope: ReadonlyMap<string, number>;
  /** Includes commodity scope, location, legal trade and logistics constraints; supplied by the host. */
  legalLanes: ReadonlySet<string>;
}
export interface GroupReservation {
  supplierId: string;
  buyerId: string;
  scope: string;
  units: number;
  unitPriceAnchor: number;
  amountAnchor: number;
}
export function groupSupplyLane(supplierId: string, buyerId: string, scope: string): string {
  return JSON.stringify([supplierId, buyerId, scope]);
}
const positive = (value: number) => (Number.isFinite(value) ? Math.max(0, value) : 0);
/** Plain turn inputs only. Output is an intent, never a cash transfer or physical delivery receipt. */
export function allocateGroupSupply(input: GroupSupplyInput): GroupReservation[] {
  if (input.policy !== "members") return [];
  const members = new Map(input.members.map((m) => [m.id, m]));
  // Combine rows before subtracting obligations so duplicate sector rows cannot reset either budget.
  const offered = new Map<
    string,
    { memberId: string; scope: string; produced: number; committed: number }
  >();
  for (const offer of input.offers) {
    if (![offer.producedUnits, offer.committedUnits].every((v) => Number.isFinite(v) && v >= 0))
      continue;
    const member = members.get(offer.memberId);
    if (!member || member.operator !== "npp" || member.vacant || member.stateOwned) continue;
    const key = JSON.stringify([offer.memberId, offer.scope]);
    const row = offered.get(key) ?? {
      memberId: offer.memberId,
      scope: offer.scope,
      produced: 0,
      committed: 0,
    };
    row.produced += positive(offer.producedUnits);
    row.committed += positive(offer.committedUnits);
    offered.set(key, row);
  }
  const needed = new Map<
    string,
    { memberId: string; scope: string; required: number; contracted: number; units: number }
  >();
  for (const need of input.needs) {
    if (![need.requiredUnits, need.contractedUnits].every((v) => Number.isFinite(v) && v >= 0))
      continue;
    const member = members.get(need.memberId),
      price = input.marketPriceByScope.get(need.scope);
    if (
      !member ||
      !price ||
      !Number.isFinite(price) ||
      price <= 0 ||
      !canReceiveGroupSupply(member, member.preference, input.policy, input.turn)
    )
      continue;
    const key = JSON.stringify([need.memberId, need.scope]);
    const row = needed.get(key) ?? {
      memberId: need.memberId,
      scope: need.scope,
      required: 0,
      contracted: 0,
      units: 0,
    };
    row.required += positive(need.requiredUnits);
    row.contracted += positive(need.contractedUnits);
    needed.set(key, row);
  }
  const costByBuyer = new Map<string, number>();
  for (const row of needed.values()) {
    row.units = Math.max(0, row.required - row.contracted);
    const amount = row.units * input.marketPriceByScope.get(row.scope)!;
    costByBuyer.set(row.memberId, (costByBuyer.get(row.memberId) ?? 0) + amount);
  }
  // Reserve a buyer's budget across its whole input basket, rather than spending it anew in each market.
  for (const row of needed.values()) {
    const cash = positive(members.get(row.memberId)!.cashAvailableAnchor),
      cost = costByBuyer.get(row.memberId) ?? 0;
    row.units *= cost > 0 ? Math.min(1, cash / cost) : 0;
  }
  const results: GroupReservation[] = [];
  for (const offer of [...offered.values()].sort(
    (a, b) => a.scope.localeCompare(b.scope) || a.memberId.localeCompare(b.memberId)
  )) {
    const seller = members.get(offer.memberId)!,
      price = input.marketPriceByScope.get(offer.scope);
    if (!price || !Number.isFinite(price) || price <= 0) continue;
    if (!Number.isFinite(offer.produced) || !Number.isFinite(offer.committed)) continue;
    const available = Math.max(0, offer.produced - offer.committed);
    const candidates = [...needed.values()]
      .filter((need) => {
        const buyer = members.get(need.memberId)!;
        return (
          need.scope === offer.scope &&
          need.units > 0 &&
          buyer.id !== seller.id &&
          buyer.rootId === seller.rootId &&
          input.legalLanes.has(groupSupplyLane(seller.id, buyer.id, offer.scope))
        );
      })
      .sort((a, b) => a.memberId.localeCompare(b.memberId));
    const demand = candidates.reduce((sum, need) => sum + need.units, 0);
    const share = demand > 0 ? Math.min(1, available / demand) : 0;
    for (const need of candidates) {
      const units = need.units * share;
      if (!(units > 0)) continue;
      need.units = Math.max(0, need.units - units);
      results.push({
        supplierId: seller.id,
        buyerId: need.memberId,
        scope: offer.scope,
        units,
        unitPriceAnchor: price,
        amountAnchor: units * price,
      });
    }
  }
  return results;
}
