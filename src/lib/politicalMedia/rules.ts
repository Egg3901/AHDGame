/**
 * Political advertising (funded local media orders). Orders use only advertising
 * units left after commercial buyers clear, and each unit is sold at its quoted
 * anchor value. See allocatePoliticalAdOrders.
 */

export interface PoliticalAdOrderDemand {
  orderId: string;
  countryId: string;
  stateId: string;
  createdTurn: number;
  budgetAnchor: number;
}

export interface PoliticalAdSellerOffer {
  sectorId: string;
  corporationId: string;
  countryId: string;
  stateId: string;
  /** Total available output units after any commercial sales. */
  unsoldUnits: number;
  /** Units offered before commercial sales, for the final sold fraction. */
  offeredUnits: number;
  /** Price of one unit after the ordinary book's posture and price factors. */
  unitPriceAnchor: number;
  /** Captured at quote time and used to calculate the seller's native cash receipt. */
  sellerLocalPerAnchor: number;
}

export interface PoliticalAdSellerAllocation {
  orderId: string;
  sectorId: string;
  corporationId: string;
  units: number;
  amountAnchor: number;
  sellerLocalAmount: number;
  sellerLocalPerAnchor: number;
  soldFractionAfterAllocation: number;
}

export interface PoliticalAdOrderAllocation {
  orderId: string;
  requestedAnchor: number;
  deliveredAnchor: number;
  unfilledAnchor: number;
  deliveredUnits: number;
  sellers: PoliticalAdSellerAllocation[];
}

const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Allocate funded political ad orders after commercial buyers. Matching stays
 * inside the exact country and state, then prefers the lowest ordinary offer
 * price with stable ids as tie breakers. The caller supplies residual units,
 * so no output already sold commercially can be offered again.
 */
export function allocatePoliticalAdOrders(
  orders: readonly PoliticalAdOrderDemand[],
  sellers: readonly PoliticalAdSellerOffer[]
): PoliticalAdOrderAllocation[] {
  const remainingBySector = new Map(
    sellers.map((seller) => [
      seller.sectorId,
      Number.isFinite(seller.unsoldUnits) ? Math.max(0, seller.unsoldUnits) : 0,
    ])
  );
  const orderedOrders = [...orders].sort(
    (a, b) => a.createdTurn - b.createdTurn || compareText(a.orderId, b.orderId)
  );

  return orderedOrders.map((order) => {
    let remainingAnchor =
      Number.isFinite(order.budgetAnchor) && order.budgetAnchor > 0 ? order.budgetAnchor : 0;
    let deliveredAnchor = 0;
    let deliveredUnits = 0;
    const allocations: PoliticalAdSellerAllocation[] = [];
    const matchingSellers = sellers
      .filter(
        (seller) =>
          seller.countryId === order.countryId &&
          seller.stateId === order.stateId &&
          (remainingBySector.get(seller.sectorId) ?? 0) > 0 &&
          Number.isFinite(seller.unitPriceAnchor) &&
          seller.unitPriceAnchor > 0 &&
          Number.isFinite(seller.sellerLocalPerAnchor) &&
          seller.sellerLocalPerAnchor > 0
      )
      .sort(
        (a, b) =>
          a.unitPriceAnchor - b.unitPriceAnchor ||
          compareText(a.corporationId, b.corporationId) ||
          compareText(a.sectorId, b.sectorId)
      );

    for (const seller of matchingSellers) {
      if (!(remainingAnchor > 0)) break;
      const availableUnits = remainingBySector.get(seller.sectorId) ?? 0;
      const units = Math.min(availableUnits, remainingAnchor / seller.unitPriceAnchor);
      if (!(units > 0)) continue;
      const amountAnchor = units * seller.unitPriceAnchor;
      remainingBySector.set(seller.sectorId, availableUnits - units);
      const offeredUnits =
        Number.isFinite(seller.offeredUnits) && seller.offeredUnits > 0 ? seller.offeredUnits : 0;
      allocations.push({
        orderId: order.orderId,
        sectorId: seller.sectorId,
        corporationId: seller.corporationId,
        units,
        amountAnchor,
        sellerLocalAmount: amountAnchor * seller.sellerLocalPerAnchor,
        sellerLocalPerAnchor: seller.sellerLocalPerAnchor,
        soldFractionAfterAllocation:
          offeredUnits > 0
            ? Math.min(1, (offeredUnits - availableUnits + units) / offeredUnits)
            : 0,
      });
      deliveredAnchor += amountAnchor;
      deliveredUnits += units;
      remainingAnchor = Math.max(0, remainingAnchor - amountAnchor);
    }

    return {
      orderId: order.orderId,
      requestedAnchor: Math.max(0, Number.isFinite(order.budgetAnchor) ? order.budgetAnchor : 0),
      deliveredAnchor,
      unfilledAnchor: remainingAnchor,
      deliveredUnits,
      sellers: allocations,
    };
  });
}
