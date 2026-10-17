import { COMMODITY_TYPES, type CommodityType } from "@/lib/constants/commodities";
import type { ProducerQuotePolicy } from "./rules";

export type ProducerQuotes = Partial<Record<CommodityType, ProducerQuotePolicy>>;

/** A bulk choice replaces per-product choices, including future product lines. */
export function uniformProducerQuotes(markup: number | null): ProducerQuotes {
  return markup === null
    ? {}
    : Object.fromEntries(
        COMMODITY_TYPES.map((commodity) => [commodity, { kind: "costPlus", markup }])
      );
}

export function uniformProducerMarkup(quotes: ProducerQuotes): number | null | "mixed" {
  const policies = COMMODITY_TYPES.map<ProducerQuotePolicy>(
    (commodity) => quotes[commodity] ?? { kind: "automatic", targetMarkup: 0 }
  );
  if (policies.every((p) => p.kind === "automatic" && p.targetMarkup === 0)) return null;
  const first = policies[0];
  return first.kind === "costPlus" &&
    policies.every((p) => p.kind === "costPlus" && p.markup === first.markup)
    ? first.markup
    : "mixed";
}
