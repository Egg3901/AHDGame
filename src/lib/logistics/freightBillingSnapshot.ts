/**
 * Freight billing uses the buyer and supplier book from its sourcing turn.
 * readFreightBillingSnapshot supports old network records only when the
 * commodity-price book belongs to that exact turn.
 */
import type { CommodityType } from "@/lib/constants/commodities";
import type { SourcingNetworkDoc } from "./sourcingLedger";

export function readFreightBillingSnapshot(
  doc:
    | Pick<
        SourcingNetworkDoc,
        "turn" | "freightCharges" | "freightHaulRevenue" | "freightDemand" | "freightSupply"
      >
    | undefined,
  prices: readonly {
    commodity: CommodityType;
    turn: number;
    stateDemand: Record<string, number>;
    stateSupply: Record<string, number>;
  }[]
) {
  const demandByDestState = new Map<string, Map<CommodityType, number>>();
  const supplyByOriginState = new Map<string, number>();
  const priceByCommodity = new Map(prices.map((row) => [row.commodity, row]));
  for (const [stateId, byCommodity] of Object.entries(doc?.freightCharges ?? {})) {
    const demand = new Map<CommodityType, number>();
    for (const commodity of Object.keys(byCommodity) as CommodityType[]) {
      const price = priceByCommodity.get(commodity);
      const units =
        doc?.freightDemand != null
          ? doc.freightDemand[stateId]?.[commodity]
          : price?.turn === doc?.turn
            ? price?.stateDemand[stateId]
            : undefined;
      if (typeof units === "number" && Number.isFinite(units) && units > 0)
        demand.set(commodity, units);
    }
    demandByDestState.set(stateId, demand);
  }
  const freightPrice = priceByCommodity.get("freight");
  for (const stateId of Object.keys(doc?.freightHaulRevenue ?? {})) {
    const units =
      doc?.freightSupply != null
        ? doc.freightSupply[stateId]
        : freightPrice?.turn === doc?.turn
          ? freightPrice?.stateSupply[stateId]
          : undefined;
    if (typeof units === "number" && Number.isFinite(units) && units > 0)
      supplyByOriginState.set(stateId, units);
  }
  return { demandByDestState, supplyByOriginState };
}
