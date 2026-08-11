/**
 * Freight classification for the landed-price sourcing pass.
 *
 * Every commodity is either physically shipped (in one of two freight classes)
 * or not shipped at all (services, grid-delivered energy, and freight itself).
 * A shipped commodity spends freight capacity of its class when it crosses a
 * state line; intra-state delivery is free by design.
 *
 * This is the "freight-class field on the commodity table" from the
 * interstate-logistics plan (Rev 4). The single `freight` commodity is NOT yet
 * split into bulk/special commodities — the class split here only partitions
 * shipping capacity and cost, so the later commodity split can land without
 * reclassifying anything.
 */

import { COMMODITY_TYPES, type CommodityType } from "@/lib/constants/commodities";

export type FreightClass = "bulk" | "special";

/**
 * `null` = never shipped interstate (services and non-physical flows are
 * delivered wherever they're bought; energy and natural gas ride grid/pipeline
 * networks the freight system deliberately does not model — see plan open
 * question 5 on a possible third class).
 */
export const FREIGHT_CLASS_BY_COMMODITY: Record<CommodityType, FreightClass | null> = {
  // Bulk: high volume, low value density.
  chemicals: "bulk",
  fertilizers: "bulk",
  food: "bulk",
  building_materials: "bulk",
  iron: "bulk",
  steel: "bulk",
  coal: "bulk",
  oil: "bulk",
  timber: "bulk",
  plastics: "bulk",
  // Special care: refrigerated, fragile, hazmat, high value density.
  pharmaceuticals: "special",
  electronics: "special",
  vehicles: "special",
  rare_earth: "special",
  ordnance: "special",
  retail: "special",
  // Not shipped.
  energy: null,
  natural_gas: null,
  construction_services: null,
  healthcare_services: null,
  real_estate_services: null,
  software: null,
  financial_services: null,
  advertising: null,
  freight: null,
  consulting_services: null,
  network_services: null,
  entertainment_services: null,
};

/** Shipped commodities only — the set the sourcing pass iterates. */
export const SHIPPED_COMMODITIES: readonly CommodityType[] = COMMODITY_TYPES.filter(
  (c) => FREIGHT_CLASS_BY_COMMODITY[c] !== null
);
