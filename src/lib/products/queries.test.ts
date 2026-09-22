import { describe, expect, it } from "vitest";
import { queryProductCatalog } from "./queries";

const INDUSTRIAL_IDS = [
  "passenger_car",
  "truck",
  "commercial_vehicle",
  "consumer_electronics",
  "industrial_electronics",
  "electronic_components",
  "structural_steel",
  "sheet_steel",
  "specialty_steel",
  "cement",
  "prefabricated_components",
  "construction_materials",
];

const MEDIA_IDS = [
  "news_story",
  "book",
  "radio_program",
  "television_show",
  "film",
  "music_release",
  "live_production",
];

describe("queryProductCatalog", () => {
  it("returns the exact Industrial Manufacturing set in catalog order", () => {
    expect(
      queryProductCatalog({ family: "industrial_manufacturing" }).map((kind) => kind.id)
    ).toEqual(INDUSTRIAL_IDS);
  });

  it("returns only media products for the media family", () => {
    expect(queryProductCatalog({ family: "media_entertainment" }).map((kind) => kind.id)).toEqual(
      MEDIA_IDS
    );
  });

  it("never mixes families", () => {
    for (const kind of queryProductCatalog({ family: "industrial_manufacturing" })) {
      expect(kind.family).toBe("industrial_manufacturing");
    }
    for (const kind of queryProductCatalog({ family: "media_entertainment" })) {
      expect(kind.family).toBe("media_entertainment");
    }
  });

  it("filters media products to the corporation's operating models", () => {
    expect(
      queryProductCatalog({
        family: "media_entertainment",
        operatingModels: ["radio_network"],
      }).map((kind) => kind.id)
    ).toEqual(["news_story", "radio_program"]);
  });

  it("resolves a single-model corporation to its one legal product", () => {
    expect(
      queryProductCatalog({
        family: "media_entertainment",
        operatingModels: ["publishing_house"],
      }).map((kind) => kind.id)
    ).toEqual(["book"]);
  });

  it("ignores operating models for industrial products", () => {
    expect(
      queryProductCatalog({
        family: "industrial_manufacturing",
        operatingModels: ["radio_network"],
      }).map((kind) => kind.id)
    ).toEqual(INDUSTRIAL_IDS);
  });

  it("returns nothing for a model the catalog does not use", () => {
    expect(
      queryProductCatalog({
        family: "media_entertainment",
        operatingModels: ["corner_shop"],
      }).map((kind) => kind.id)
    ).toEqual([]);
  });

  it("keeps technology gating representable without filtering ungated kinds", () => {
    expect(
      queryProductCatalog({
        family: "industrial_manufacturing",
        unlockedTechnologyIds: [],
      }).map((kind) => kind.id)
    ).toEqual(INDUSTRIAL_IDS);
  });

  it("returns empty for an unknown family", () => {
    expect(
      queryProductCatalog({ family: "unknown_family" as never }).map((kind) => kind.id)
    ).toEqual([]);
  });
});
