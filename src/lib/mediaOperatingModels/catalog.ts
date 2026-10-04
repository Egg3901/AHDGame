/**
 * Media business models describe which outputs a firm sells and when the model
 * is historically available. `mediaOperatingModelOutputRates` converts a
 * model's value shares into the existing commodity-rate format.
 */

import type { CommodityType } from "@/lib/constants/commodities";

export type MediaOperatingModelId =
  | "newspaper"
  | "radio_network"
  | "broadcast_tv"
  | "cable_tv"
  | "film_studio"
  | "music_label"
  | "publishing_house"
  | "streaming_platform";

export type MediaOperatingModelSector = "media" | "entertainment";

export interface MediaOperatingModelDefinition {
  id: MediaOperatingModelId;
  name: string;
  sectorTypes: readonly MediaOperatingModelSector[];
  availableFromYear: number;
  outputProducts: readonly ("advertising" | "entertainment_services")[];
  technology?: {
    sectorType: MediaOperatingModelSector;
    decade: string;
    nodeName: string;
  };
}

/** Catalog entries only describe models; they do not grant or unlock them. */
export const MEDIA_OPERATING_MODELS = [
  {
    id: "newspaper",
    name: "Newspaper",
    sectorTypes: ["media"],
    availableFromYear: 1900,
    outputProducts: ["advertising"],
    technology: { sectorType: "media", decade: "1940", nodeName: "Wartime Press Partnerships" },
  },
  {
    id: "radio_network",
    name: "Radio Network",
    sectorTypes: ["media"],
    availableFromYear: 1920,
    outputProducts: ["advertising"],
    technology: { sectorType: "media", decade: "1940", nodeName: "Radio Network Dominance" },
  },
  {
    id: "broadcast_tv",
    name: "Broadcast Television",
    sectorTypes: ["media"],
    availableFromYear: 1950,
    outputProducts: ["advertising"],
    technology: { sectorType: "media", decade: "1950", nodeName: "Television Broadcasting" },
  },
  {
    id: "cable_tv",
    name: "Cable Television",
    sectorTypes: ["media"],
    availableFromYear: 1980,
    outputProducts: ["advertising", "entertainment_services"],
    technology: { sectorType: "media", decade: "1989", nodeName: "Cable Syndication" },
  },
  {
    id: "film_studio",
    name: "Film Studio",
    sectorTypes: ["entertainment"],
    availableFromYear: 1910,
    outputProducts: ["entertainment_services"],
    technology: {
      sectorType: "entertainment",
      decade: "1940",
      nodeName: "Hollywood Studio System",
    },
  },
  {
    id: "music_label",
    name: "Music Label",
    sectorTypes: ["entertainment"],
    availableFromYear: 1950,
    outputProducts: ["entertainment_services"],
    technology: { sectorType: "entertainment", decade: "1950", nodeName: "Record Labels" },
  },
  {
    id: "publishing_house",
    name: "Publishing House",
    sectorTypes: ["media"],
    availableFromYear: 1900,
    outputProducts: ["advertising", "entertainment_services"],
    technology: { sectorType: "media", decade: "1950", nodeName: "Magazine Publishing Scale" },
  },
  {
    id: "streaming_platform",
    name: "Streaming Platform",
    sectorTypes: ["media", "entertainment"],
    availableFromYear: 2005,
    outputProducts: ["advertising", "entertainment_services"],
    technology: { sectorType: "media", decade: "2009", nodeName: "Streaming Platforms" },
  },
] as const satisfies readonly MediaOperatingModelDefinition[];

export function getMediaOperatingModel(modelId: string): MediaOperatingModelDefinition | undefined {
  return MEDIA_OPERATING_MODELS.find((model) => model.id === modelId);
}

/**
 * Convert model output value shares into legacy commodity rates. The sum of
 * rates is the base-price value budget, so units can change with product prices
 * without changing nominal output value.
 */
export function mediaOperatingModelOutputRates(
  legacyRates: Partial<Record<CommodityType, number>>,
  outputValueShares: Partial<Record<"advertising" | "entertainment_services", number>>
): Partial<Record<CommodityType, number>> {
  const legacyValueBudget = Object.values(legacyRates).reduce(
    (total, rate) =>
      total + (typeof rate === "number" && Number.isFinite(rate) && rate > 0 ? rate : 0),
    0
  );
  const entries = Object.entries(outputValueShares).filter(
    (entry): entry is ["advertising" | "entertainment_services", number] =>
      typeof entry[1] === "number" && Number.isFinite(entry[1]) && entry[1] > 0
  );
  const shareTotal = entries.reduce((total, [, share]) => total + share, 0);
  if (legacyValueBudget <= 0 || entries.length === 0 || Math.abs(shareTotal - 1) > 1e-9) {
    return {};
  }

  return Object.fromEntries(
    entries.map(([commodity, share]) => [commodity, legacyValueBudget * share])
  ) as Partial<Record<CommodityType, number>>;
}
