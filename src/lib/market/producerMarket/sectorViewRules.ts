/** One receipt view for producer controls and operating accounts. */
import type { ProducerSectorSettlement } from "@/lib/db/types/producerEconomy";
import type { ProducerQuotePolicy } from "./rules";

export interface ProducerSectorView {
  turn: number | null;
  products: Array<{
    commodity: string;
    policy?: ProducerQuotePolicy;
    producedUnits: number | null;
    offeredUnits: number | null;
    soldUnits: number | null;
    deliveredUnits: number | null;
    internalDeliveredUnits: number | null;
    askingUnitPrice: number | null;
    realizedUnitPrice: number | null;
    sellThrough: number | null;
  }>;
  operations?: {
    capacityUnits: number;
    activeUnits: number;
    producedUnits: number;
    revenue: number;
    inputsUsed: number;
    inputsPurchased: number;
    labourCost: number;
    otherOperatingCost: number;
    unpaidBills: number;
    breakEvenRevenue: number;
    profit: number;
    cashFlow: number;
  };
}

export function producerSectorView(input: {
  receipt?: ProducerSectorSettlement | null;
  commodities: readonly string[];
  policies: Readonly<Record<string, ProducerQuotePolicy | undefined>>;
  canManage: boolean;
}): ProducerSectorView {
  const receipt = input.receipt;
  const products = new Map(receipt?.products.map((p) => [p.commodity, p]));
  return {
    turn: receipt?.turn ?? null,
    products: [...new Set([...input.commodities, ...products.keys()])].sort().map((commodity) => {
      const product = products.get(commodity);
      const policy: ProducerQuotePolicy = input.policies[commodity] ?? {
        kind: "automatic",
        targetMarkup: 0,
      };
      return {
        commodity,
        ...(input.canManage
          ? {
              policy: policy,
            }
          : {}),
        producedUnits: product?.producedUnits ?? null,
        offeredUnits: product?.offeredUnits ?? null,
        soldUnits: product?.soldUnits ?? null,
        deliveredUnits: product?.deliveredUnits ?? null,
        internalDeliveredUnits: product?.internalDeliveredUnits ?? null,
        askingUnitPrice: product?.askingUnitPrice ?? null,
        realizedUnitPrice: product?.realizedUnitPrice ?? null,
        sellThrough:
          product && product.offeredUnits > 0 ? product.soldUnits / product.offeredUnits : null,
      };
    }),
    ...(input.canManage && receipt
      ? {
          operations: {
            capacityUnits: receipt.capacityUnits,
            activeUnits: receipt.activeUnits,
            producedUnits: receipt.producedUnits,
            revenue: receipt.revenue,
            inputsUsed: receipt.inputsConsumed,
            inputsPurchased: receipt.purchases,
            labourCost: receipt.labourPaid + receipt.labourArrears,
            otherOperatingCost: receipt.otherOperatingPaid + receipt.otherOperatingArrears,
            unpaidBills: receipt.operatingArrears,
            breakEvenRevenue: receipt.revenue - receipt.profit,
            profit: receipt.profit,
            cashFlow: receipt.cashFlow,
          },
        }
      : {}),
  };
}
