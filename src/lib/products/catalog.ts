import type { ProductKindDefinition } from "./types";

/**
 * Canonical product kinds for the first gated iteration.
 *
 * Industrial products deliberately settle only into commodities the combined
 * Manufacturing + Automobiles sector already produces. Adding a product here
 * must not smuggle a new commodity into the economy.
 */
export const PRODUCT_KINDS = [
  {
    id: "passenger_car",
    family: "industrial_manufacturing",
    label: "Passenger Car",
    outputCommodity: "vehicles",
  },
  {
    id: "truck",
    family: "industrial_manufacturing",
    label: "Truck",
    outputCommodity: "vehicles",
  },
  {
    id: "commercial_vehicle",
    family: "industrial_manufacturing",
    label: "Commercial Vehicle",
    outputCommodity: "vehicles",
  },
  {
    id: "consumer_electronics",
    family: "industrial_manufacturing",
    label: "Consumer Electronics",
    outputCommodity: "electronics",
  },
  {
    id: "industrial_electronics",
    family: "industrial_manufacturing",
    label: "Industrial Electronics",
    outputCommodity: "electronics",
  },
  {
    id: "electronic_components",
    family: "industrial_manufacturing",
    label: "Electronic Components",
    outputCommodity: "electronics",
  },
  {
    id: "structural_steel",
    family: "industrial_manufacturing",
    label: "Structural Steel",
    outputCommodity: "steel",
  },
  {
    id: "sheet_steel",
    family: "industrial_manufacturing",
    label: "Sheet Steel",
    outputCommodity: "steel",
  },
  {
    id: "specialty_steel",
    family: "industrial_manufacturing",
    label: "Specialty Steel",
    outputCommodity: "steel",
  },
  {
    id: "cement",
    family: "industrial_manufacturing",
    label: "Cement",
    outputCommodity: "building_materials",
  },
  {
    id: "prefabricated_components",
    family: "industrial_manufacturing",
    label: "Prefabricated Components",
    outputCommodity: "building_materials",
  },
  {
    id: "construction_materials",
    family: "industrial_manufacturing",
    label: "Construction Materials",
    outputCommodity: "building_materials",
  },
  {
    id: "news_story",
    family: "media_entertainment",
    label: "News Story",
    outputCommodity: "advertising",
    operatingModels: ["newspaper", "television_network", "radio_network"],
  },
  {
    id: "book",
    family: "media_entertainment",
    label: "Book",
    outputCommodity: "entertainment_services",
    operatingModels: ["publishing_house"],
  },
  {
    id: "radio_program",
    family: "media_entertainment",
    label: "Radio Program",
    outputCommodity: "advertising",
    operatingModels: ["radio_network"],
  },
  {
    id: "television_show",
    family: "media_entertainment",
    label: "Television Show",
    outputCommodity: "entertainment_services",
    operatingModels: ["television_network", "streaming_platform"],
  },
  {
    id: "film",
    family: "media_entertainment",
    label: "Film",
    outputCommodity: "entertainment_services",
    operatingModels: ["film_studio", "streaming_platform"],
  },
  {
    id: "music_release",
    family: "media_entertainment",
    label: "Music Release",
    outputCommodity: "entertainment_services",
    operatingModels: ["music_label"],
  },
  {
    id: "live_production",
    family: "media_entertainment",
    label: "Live Production",
    outputCommodity: "entertainment_services",
    operatingModels: ["live_entertainment"],
  },
] as const satisfies readonly ProductKindDefinition[];

export type ProductKindId = (typeof PRODUCT_KINDS)[number]["id"];

const PRODUCT_KIND_BY_ID = new Map<string, ProductKindDefinition>(
  PRODUCT_KINDS.map((kind) => [kind.id, kind])
);

export function getProductKind(id: string): ProductKindDefinition | undefined {
  return PRODUCT_KIND_BY_ID.get(id);
}
