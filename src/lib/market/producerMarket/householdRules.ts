/** Household orders spend a named cash wallet, using the shared consumption basket. */
import type { CommodityType } from "@/lib/constants/commodities";
import type { PurchaseOrder } from "./rules";

export const HOUSEHOLD_CONSUMER_BASKET: Partial<Record<CommodityType, number>> = {
  food: 0.2,
  energy: 0.08,
  retail: 0.1,
  vehicles: 0.06,
  electronics: 0.05,
  pharmaceuticals: 0.03,
  healthcare_services: 0.09,
  real_estate_services: 0.1,
  financial_services: 0.05,
  network_services: 0.05,
  entertainment_services: 0.05,
  software: 0.03,
  freight: 0.03,
  consulting_services: 0.02,
  building_materials: 0.02,
  plastics: 0.01,
  chemicals: 0.01,
};

export function householdPurchaseOrders(input: {
  accountId: string;
  /** Opening wallet plus wages already paid into it. No imputed GDP or bank deposits. */
  cash: number;
  spendFraction: number;
  products: readonly {
    commodity: string;
    book: string;
    maximumUnitPrice: number;
    /** Relative basket weights, after any income or demographic adjustment. */
    weight: number;
    eligibleOfferIds?: readonly string[];
  }[];
}): PurchaseOrder[] {
  if (
    !input.accountId ||
    !Number.isFinite(input.cash) ||
    input.cash < 0 ||
    !Number.isFinite(input.spendFraction) ||
    input.spendFraction < 0 ||
    input.spendFraction > 1
  )
    throw new Error("Invalid household spending wallet");
  let totalWeight = 0;
  const seen = new Set<string>();
  for (const p of input.products) {
    const key = JSON.stringify([p.commodity, p.book]);
    if (
      !p.commodity ||
      !p.book ||
      seen.has(key) ||
      !Number.isFinite(p.weight) ||
      p.weight < 0 ||
      !Number.isFinite(p.maximumUnitPrice) ||
      p.maximumUnitPrice <= 0
    )
      throw new Error("Invalid household basket");
    seen.add(key);
    totalWeight += p.weight;
  }
  if (!Number.isFinite(totalWeight)) throw new Error("Invalid household basket total");
  if (totalWeight === 0) return [];
  return [...input.products]
    .sort((a, b) =>
      a.commodity < b.commodity
        ? -1
        : a.commodity > b.commodity
          ? 1
          : a.book < b.book
            ? -1
            : a.book > b.book
              ? 1
              : 0
    )
    .map((p) => {
      const maximumSpend = input.cash * input.spendFraction * (p.weight / totalWeight);
      return {
        id: JSON.stringify([input.accountId, "consumption", p.commodity, p.book]),
        accountId: input.accountId,
        commodity: p.commodity,
        book: p.book,
        units: maximumSpend / p.maximumUnitPrice,
        maximumUnitPrice: p.maximumUnitPrice,
        maximumSpend,
        eligibleOfferIds: p.eligibleOfferIds,
      };
    });
}
