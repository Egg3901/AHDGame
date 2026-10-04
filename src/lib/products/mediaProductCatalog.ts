/**
 * Media products are named titles developed inside an existing media operating model.
 * Their coverage and cadence change the product overlay, never the sector's physical output.
 */
import type { MediaOperatingModelId } from "@/lib/mediaOperatingModels/catalog";
import type { ProductLifecycleDurations, ProductLifecycleStage } from "./rules/productLifecycle";

export type MediaProductKindId =
  | "newspaper_edition"
  | "radio_program"
  | "television_series"
  | "cable_program"
  | "film"
  | "music_release"
  | "book"
  | "streaming_original";

export type MediaCatalogTail = "none" | "short" | "backlist" | "syndication";

export interface MediaProductKind {
  id: MediaProductKindId;
  modelId: MediaOperatingModelId;
  label: string;
  outputCommodities: readonly ("advertising" | "entertainment_services")[];
  /** Share of the model's audience that can reach a new title, from 0 to 1. */
  coverage: number;
  durations: ProductLifecycleDurations;
  tail: MediaCatalogTail;
  /** Existing model unlock is also the only technology contribution to launch quality. */
  technologyNodeName?: string;
}

/**
 * The model profiles intentionally differ in reach, cadence, and tail. These
 * are product-level weights and stage clocks, not new commodity demand.
 */
export const MEDIA_PRODUCT_KINDS: readonly MediaProductKind[] = [
  {
    id: "newspaper_edition",
    modelId: "newspaper",
    label: "Newspaper edition",
    outputCommodities: ["advertising"],
    coverage: 0.15,
    durations: { development: 2, launch: 2, growth: 4, mature: 8, decline: 4 },
    tail: "none",
  },
  {
    id: "radio_program",
    modelId: "radio_network",
    label: "Radio program",
    outputCommodities: ["advertising"],
    coverage: 0.5,
    durations: { development: 3, launch: 3, growth: 8, mature: 16, decline: 6 },
    tail: "short",
    technologyNodeName: "Radio Network Dominance",
  },
  {
    id: "television_series",
    modelId: "broadcast_tv",
    label: "Television series",
    outputCommodities: ["advertising"],
    coverage: 0.8,
    durations: { development: 6, launch: 4, growth: 12, mature: 24, decline: 12 },
    tail: "syndication",
    technologyNodeName: "Television Broadcasting",
  },
  {
    id: "cable_program",
    modelId: "cable_tv",
    label: "Cable program",
    outputCommodities: ["advertising", "entertainment_services"],
    coverage: 0.65,
    durations: { development: 5, launch: 4, growth: 12, mature: 24, decline: 10 },
    tail: "syndication",
    technologyNodeName: "Cable Syndication",
  },
  {
    id: "film",
    modelId: "film_studio",
    label: "Film",
    outputCommodities: ["entertainment_services"],
    coverage: 0.4,
    durations: { development: 10, launch: 4, growth: 8, mature: 16, decline: 12 },
    tail: "syndication",
    technologyNodeName: "Hollywood Studio System",
  },
  {
    id: "music_release",
    modelId: "music_label",
    label: "Music release",
    outputCommodities: ["entertainment_services"],
    coverage: 0.25,
    durations: { development: 4, launch: 4, growth: 10, mature: 20, decline: 10 },
    tail: "backlist",
    technologyNodeName: "Record Labels",
  },
  {
    id: "book",
    modelId: "publishing_house",
    label: "Book",
    outputCommodities: ["advertising", "entertainment_services"],
    coverage: 0.2,
    durations: { development: 8, launch: 4, growth: 12, mature: 24, decline: 12 },
    tail: "backlist",
    technologyNodeName: "Magazine Publishing Scale",
  },
  {
    id: "streaming_original",
    modelId: "streaming_platform",
    label: "Streaming original",
    outputCommodities: ["advertising", "entertainment_services"],
    coverage: 0.6,
    durations: { development: 8, launch: 4, growth: 12, mature: 24, decline: 12 },
    tail: "backlist",
    technologyNodeName: "Streaming Platforms",
  },
];

const KIND_BY_ID = new Map(MEDIA_PRODUCT_KINDS.map((kind) => [kind.id, kind]));

export function getMediaProductKind(kindId: string): MediaProductKind | undefined {
  return KIND_BY_ID.get(kindId as MediaProductKindId);
}

export function tailDemandFactor(stage: ProductLifecycleStage, tail: MediaCatalogTail): number {
  if (stage !== "decline") return stage === "retired" ? 0 : 1;
  switch (tail) {
    case "none":
      return 0;
    case "short":
      return 0.15;
    case "backlist":
      return 0.35;
    case "syndication":
      return 0.45;
  }
}
