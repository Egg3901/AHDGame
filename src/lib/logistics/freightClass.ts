/**
 * Freight classification for the landed-price sourcing pass.
 *
 * Every commodity is either physically shipped (in one of three freight
 * classes) or not shipped at all (services and freight itself). A shipped
 * commodity spends shared freight capacity when it crosses a state line;
 * intra-state delivery is free by design.
 *
 * The `grid` class is the exception and the reason it exists. Energy and
 * natural gas are delivered by wire and pipe, not by truck, so they must not
 * draw on the haulage fleet the other two classes share. Before this class
 * existed they were typed `null` (never shipped), which meant a state could
 * only ever consume what it generated, while their PRICE was pooled nationally
 * via COMMODITIES_NATIONAL_REGIONAL_PRICE_BLEND. The price said national market
 * and the physics said the state you built in: measured on prod at t225, energy
 * ran 128 states in local surplus against 100 short with state prices from 1.17
 * to 4.34, and 27.8% of all energy produced went unsold. Grid flows now move,
 * consume no TEU, and pay distance in transmission loss and a wheeling charge
 * instead of against a hard capacity ceiling.
 *
 * This is the "freight-class field on the commodity table" from the
 * interstate-logistics plan (Rev 4). The single `freight` commodity remains
 * one shared capacity pool. Classes determine TEU use and shipping cost, not
 * reserved capacity slices.
 */

import { COMMODITY_TYPES, type CommodityType } from "@/lib/constants/commodities";

export type FreightClass = "bulk" | "special" | "grid";
export type HauledFreightClass = Exclude<FreightClass, "grid">;

export const FREIGHT_CLASS_LABELS: Record<FreightClass, string> = {
  bulk: "Bulk freight",
  special: "Special freight",
  grid: "Grid delivery",
};

export function freightClassExplanation(freightClass: FreightClass): string {
  if (freightClass === "special") {
    return "Special cargo uses three times as much shared freight capacity per unit as bulk cargo.";
  }
  if (freightClass === "bulk") {
    return "Bulk cargo and special cargo draw from the same shared freight capacity in this state.";
  }
  return "Electricity and natural gas use the grid, not freight capacity.";
}

export function freightClassAction(freightClass: FreightClass): string {
  if (freightClass === "grid") {
    return "Freight capacity will not help grid delivery. There is no separate route upgrade: lower this sector's price so distant buyers can afford its delivered price, or site production nearer buyers.";
  }
  return "Open or buy into a Logistics sector in this state to add freight capacity, or site production nearer buyers. Every corporation shipping bulk or special cargo from this state shares that capacity.";
}

/**
 * `null` = never shipped interstate: services and non-physical flows are
 * delivered wherever they are bought, and `freight` itself is the haulage being
 * spent rather than a thing hauled. Energy and natural gas are `grid`, the
 * third class the interstate-logistics plan left as open question 5.
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
  // Grid and pipeline: wire and pipe, not trucks. No TEU, lossy over distance.
  energy: "grid",
  natural_gas: "grid",
  // Not shipped.
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

/**
 * Commodities whose market is physically STATE-local and must clear against
 * the seller's own state rather than a national book (ticket #1180).
 *
 * `freight` is the only one, and the reason is structural rather than a
 * balance preference. A state's freight supply is not merely sold in that
 * state, it IS that state's haulage capacity: `runSourcingPass` reads
 * `byState.get(stateId).freight.supply` as the TEU ceiling on everything
 * leaving it. Ohio's trucks cannot haul a crate out of New Jersey.
 *
 * Clearing it nationally therefore made one number do two incompatible jobs.
 * The capacity a state must hold is local and non-transferable, while the
 * revenue that pays for it was pooled across every logistics sector in the
 * country and filled cheapest-first, so a seller could capture haul demand it
 * was physically incapable of serving. Measured on prod at t361: NJ held 30x
 * the freight its own state consumed and AZ was short, and because both faced
 * the same national book neither signal reached the player who could act on
 * it. Every other unshipped commodity (software, financial services, and the
 * rest) has no per-state capacity gate, so a national book is right for them.
 *
 * The price side already worked this way. `statePrices.freight` ran from 63.72
 * in NJ to 91.70 in AZ on the same turn, so the model already believed freight
 * was a local market; only the clearing disagreed.
 */
export const STATE_SCOPED_COMMODITIES: ReadonlySet<CommodityType> = new Set<CommodityType>([
  "freight",
]);

/** True when the class rides the haulage fleet and spends TEU capacity. */
export function isHauledClass(freightClass: FreightClass): boolean {
  return freightClass !== "grid";
}

/** The two haulage classes, the ones that share a state's freight supply. */
export const HAULED_FREIGHT_CLASSES: readonly FreightClass[] = ["bulk", "special"];

/** Shipped commodities only, the set the sourcing pass iterates. */
export const SHIPPED_COMMODITIES: readonly CommodityType[] = COMMODITY_TYPES.filter(
  (c) => FREIGHT_CLASS_BY_COMMODITY[c] !== null
);
