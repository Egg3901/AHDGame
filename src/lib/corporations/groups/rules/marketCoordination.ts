/**
 * Group members first redirects finite market output after existing agreements.
 * Buyers reserve the full public benchmark; consumed-input discounts settle separately. Residual buyers share only unreserved inputs.
 * The normal revenue and input-cost rails account for these goods exactly once.
 */
import { allocateGroupSupply, groupSupplyLane, type SupplyMember } from "./supply";
import { clampGroupDiscount } from "./discounts";
import { canReceiveGroupSupply } from "./participation";
export interface CoordinationBuyer {
  sectorId: string;
  memberId: string;
  countryId: string;
  stateId: string;
  requiredUnits: number;
  contractedUnits: number;
  publicPriceFactor?: number;
}
export interface CoordinationSeller {
  sectorId: string;
  memberId: string;
  countryId: string;
  stateId: string;
  units: number;
  committedUnits: number;
  /** Measured physical output ceiling, not a revenue nameplate. */
  physicalUnits: number;
}
export interface GroupMarketReceipt {
  supplierId: string;
  supplierSectorId: string;
  buyerId: string;
  buyerSectorId: string;
  commodity: string;
  units: number;
  amountAnchor: number;
  /** Gross benchmark is accounted once; rebate settles on actual consumption. */
  discount?: number;
}
export interface CoordinationBook {
  commodity: string;
  turn: number;
  supply: number;
  demand: number;
  unitPriceAnchor: number;
  /** With freight settlement, only co-located deliveries bypass the public network. */
  freightSettlementActive: boolean;
  members: readonly SupplyMember[];
  sellers: readonly CoordinationSeller[];
  buyers: readonly CoordinationBuyer[];
}
const finitePositive = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);
export function coordinateGroupBook(input: CoordinationBook) {
  const receipts: GroupMarketReceipt[] = [];
  const reservedBySeller = new Map<string, number>();
  const availabilityByBuyer = new Map<string, number>();
  const spendByBuyer = new Map<string, number>();
  const empty = () => ({ receipts, reservedBySeller, availabilityByBuyer, spendByBuyer });
  if (!(input.unitPriceAnchor > 0) || !Number.isFinite(input.unitPriceAnchor)) return empty();
  const committedSupply = input.sellers.reduce(
    (sum, s) => sum + finitePositive(s.committedUnits),
    0
  );
  const contractedDemand = input.buyers.reduce(
    (sum, b) => sum + Math.min(finitePositive(b.requiredUnits), finitePositive(b.contractedUnits)),
    0
  );
  const supply = Math.max(0, finitePositive(input.supply) - committedSupply);
  const totalDemand = input.buyers.reduce((sum, b) => sum + finitePositive(b.requiredUnits), 0);
  const demand = Math.max(
    0,
    Math.max(finitePositive(input.demand), totalDemand) -
      Math.max(committedSupply, contractedDemand)
  );
  if (!(supply > 0 && demand > 0)) return empty();
  // Sector ids let the allocator enforce location while cash remains a CORPORATION budget.
  // Split each corporation's cash across all of its input sectors before allocation.
  const costByCorp = new Map<string, number>();
  for (const b of input.buyers)
    costByCorp.set(
      b.memberId,
      (costByCorp.get(b.memberId) ?? 0) +
        finitePositive(b.requiredUnits - b.contractedUnits) * input.unitPriceAnchor
    );
  const members = new Map(input.members.map((m) => [m.id, m]));
  const sellerBySector = new Map(input.sellers.map((s) => [s.sectorId, s]));
  const buyerBySector = new Map(input.buyers.map((b) => [b.sectorId, b]));
  const sectorMemberIds = new Set<string>();
  const sectorMembers: SupplyMember[] = [];
  for (const row of [...input.sellers, ...input.buyers]) {
    const member = members.get(row.memberId);
    if (!member || sectorMemberIds.has(row.sectorId)) continue;
    sectorMemberIds.add(row.sectorId);
    const need = buyerBySector.get(row.sectorId);
    const cost = need
      ? finitePositive(need.requiredUnits - need.contractedUnits) * input.unitPriceAnchor
      : 0;
    const total = costByCorp.get(member.id) ?? 0;
    sectorMembers.push({
      ...member,
      id: row.sectorId,
      cashAvailableAnchor:
        total > 0 ? (finitePositive(member.cashAvailableAnchor) * cost) / total : 0,
    });
  }
  const lanes = new Set<string>();
  const eligibleSellers = input.sellers.filter((s) => {
    const m = members.get(s.memberId);
    return m?.operator === "npp" && !m.vacant && !m.stateOwned;
  });
  const eligibleBuyers = input.buyers.filter((b) => {
    const m = members.get(b.memberId);
    return m && canReceiveGroupSupply(m, m.preference, "members", input.turn);
  });
  for (const s of eligibleSellers)
    for (const b of eligibleBuyers) {
      if (members.get(s.memberId)!.rootId !== members.get(b.memberId)!.rootId) continue;
      // Never turn a group preference into a trade-policy or transport bypass.
      if (s.memberId === b.memberId || !s.countryId || s.countryId !== b.countryId) continue;
      if (input.freightSettlementActive && (!s.stateId || s.stateId !== b.stateId)) continue;
      lanes.add(groupSupplyLane(s.sectorId, b.sectorId, input.commodity));
    }
  const offers = eligibleSellers.map((s) => ({
    memberId: s.sectorId,
    scope: input.commodity,
    producedUnits: Math.min(finitePositive(s.units), finitePositive(s.physicalUnits)),
    committedUnits: Math.max(0, s.committedUnits),
  }));
  const available = offers.reduce(
    (sum, s) => sum + finitePositive(s.producedUnits - s.committedUnits),
    0
  );
  const ceiling = Math.min(supply, demand);
  const scale = available > 0 ? Math.min(1, ceiling / available) : 0;
  for (const o of offers)
    o.producedUnits = o.committedUnits + finitePositive(o.producedUnits - o.committedUnits) * scale;
  const reservations = allocateGroupSupply({
    turn: input.turn,
    policy: "members",
    members: sectorMembers,
    offers,
    needs: input.buyers.map((b) => ({
      memberId: b.sectorId,
      scope: input.commodity,
      requiredUnits: b.requiredUnits,
      contractedUnits: b.contractedUnits,
    })),
    marketPriceByScope: new Map([[input.commodity, input.unitPriceAnchor]]),
    legalLanes: lanes,
  });
  for (const r of reservations) {
    const seller = sellerBySector.get(r.supplierId)!;
    const buyer = buyerBySector.get(r.buyerId)!;
    receipts.push({
      supplierId: seller.memberId,
      supplierSectorId: seller.sectorId,
      buyerId: buyer.memberId,
      buyerSectorId: buyer.sectorId,
      commodity: input.commodity,
      units: r.units,
      amountAnchor: r.amountAnchor,
      discount: clampGroupDiscount(members.get(seller.memberId)?.supplyDiscount),
    });
    reservedBySeller.set(seller.sectorId, (reservedBySeller.get(seller.sectorId) ?? 0) + r.units);
    spendByBuyer.set(buyer.memberId, (spendByBuyer.get(buyer.memberId) ?? 0) + r.amountAnchor);
  }
  const reserved = receipts.reduce((sum, r) => sum + r.units, 0);
  if (!(reserved > 0)) return empty();
  const residualAvailability =
    demand > reserved ? Math.min(1, Math.max(0, supply - reserved) / (demand - reserved)) : 1;
  const receivedBySector = new Map<string, number>();
  for (const r of receipts)
    receivedBySector.set(r.buyerSectorId, (receivedBySector.get(r.buyerSectorId) ?? 0) + r.units);
  for (const buyer of input.buyers) {
    const received = receivedBySector.get(buyer.sectorId) ?? 0;
    const contracted = Math.min(
      finitePositive(buyer.requiredUnits),
      finitePositive(buyer.contractedUnits)
    );
    const needed = finitePositive(buyer.requiredUnits);
    if (needed > 0)
      availabilityByBuyer.set(
        buyer.sectorId,
        Math.min(
          1,
          (contracted +
            received +
            Math.max(0, needed - received - contracted) * residualAvailability) /
            needed
        )
      );
  }
  return empty();
}

/** Partition physical delivery by verified local supply, so priority cannot create a shipping lane. */
export function coordinationSlices(
  input: CoordinationBook,
  localAvailability?: ReadonlyMap<string, ReadonlyMap<string, number>>,
  localDemand?: ReadonlyMap<string, ReadonlyMap<string, { demand: number }>>
): CoordinationBook[] {
  if (!input.freightSettlementActive) return [input];
  const states = [...new Set(input.buyers.map((b) => b.stateId))].sort();
  const slices = states.flatMap((state) => {
    const availability = localAvailability?.get(state)?.get(input.commodity);
    const demand = localDemand?.get(state)?.get(input.commodity)?.demand;
    if (
      !state ||
      availability == null ||
      demand == null ||
      !Number.isFinite(availability) ||
      !Number.isFinite(demand) ||
      demand <= 0
    )
      return [];
    return [
      {
        ...input,
        supply: Math.max(
          0,
          Math.min(input.supply, demand * Math.min(1, Math.max(0, availability)))
        ),
        demand,
        sellers: input.sellers.filter((s) => s.stateId === state),
        buyers: input.buyers.filter((b) => b.stateId === state),
      },
    ];
  });
  // Local delivered pools can overlap a reachable country book. Share its finite
  // ceiling proportionally instead of giving the first state the whole budget.
  const delivered = slices.reduce((sum, slice) => sum + finitePositive(slice.supply), 0);
  const scale = delivered > 0 ? Math.min(1, finitePositive(input.supply) / delivered) : 0;
  return slices.map((slice) => ({ ...slice, supply: slice.supply * scale }));
}
export function coordinateGroupMarket(
  input: CoordinationBook,
  localAvailability?: ReadonlyMap<string, ReadonlyMap<string, number>>,
  localDemand?: ReadonlyMap<string, ReadonlyMap<string, { demand: number }>>
) {
  const receipts: GroupMarketReceipt[] = [],
    reservedBySeller = new Map<string, number>(),
    availabilityByBuyer = new Map<string, number>(),
    spendByBuyer = new Map<string, number>();
  const cash = new Map(input.members.map((m) => [m.id, m.cashAvailableAnchor]));
  let supplyLeft = finitePositive(input.supply);
  for (const slice of coordinationSlices(input, localAvailability, localDemand)) {
    const result = coordinateGroupBook({
      ...slice,
      supply: Math.min(slice.supply, supplyLeft),
      members: input.members.map((m) => ({ ...m, cashAvailableAnchor: cash.get(m.id) ?? 0 })),
    });
    receipts.push(...result.receipts);
    supplyLeft = Math.max(0, supplyLeft - result.receipts.reduce((n, r) => n + r.units, 0));
    for (const [id, units] of result.reservedBySeller)
      reservedBySeller.set(id, (reservedBySeller.get(id) ?? 0) + units);
    for (const [id, amount] of result.spendByBuyer) {
      spendByBuyer.set(id, (spendByBuyer.get(id) ?? 0) + amount);
      cash.set(id, Math.max(0, (cash.get(id) ?? 0) - amount));
    }
    for (const [id, availability] of result.availabilityByBuyer)
      availabilityByBuyer.set(id, availability);
  }
  return { receipts, reservedBySeller, availabilityByBuyer, spendByBuyer };
}
