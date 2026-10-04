import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import { deriveCeoArchetype } from "@/lib/turn/ceoArchetype";
import {
  buildNppCorporationDecisionIndexes,
  indexOpenUnownedSectors,
  nppDecisionCohortIds,
} from "./decisionSnapshotIndexes";

describe("buildNppCorporationDecisionIndexes", () => {
  it("keeps the full corporation read cohort and only NPP CEO ids in source order", () => {
    const firstId = new ObjectId();
    const nonNppCeoId = new ObjectId();
    const secondId = new ObjectId();
    const corporations = [
      { _id: firstId, ceoType: "npp" as const, ceoId: new ObjectId() },
      { _id: new ObjectId(), ceoType: "character" as const, ceoId: nonNppCeoId },
      { _id: secondId, ceoType: "npp" as const, ceoId: new ObjectId() },
    ];

    const ids = nppDecisionCohortIds(corporations);

    expect(ids.corporationIds).toEqual(corporations.map((corp) => corp._id));
    expect(ids.ceoNppIds).toEqual([corporations[0].ceoId, corporations[2].ceoId]);
  });

  it("preserves CEO, sector, and latest-price indexing semantics", () => {
    const ceoId = new ObjectId();
    const missingPersonalityId = new ObjectId();
    const corpId = new ObjectId();
    const otherCorpId = new ObjectId();
    const firstSector = { corporationId: corpId };
    const secondSector = { corporationId: corpId };
    const otherSector = { corporationId: otherCorpId };
    const prices = [
      { commodity: "iron", turn: 4, globalPrice: 100 },
      { commodity: "iron", turn: 5, globalPrice: 110 },
      { commodity: "iron", turn: 5, globalPrice: 120 },
      { commodity: "coal", turn: 3, globalPrice: 80 },
    ];

    const indexes = buildNppCorporationDecisionIndexes(
      [
        {
          _id: ceoId,
          personality: { loyalty: 80, ambition: 20, stubbornness: 40 },
        },
        { _id: missingPersonalityId },
      ],
      [firstSector, otherSector, secondSector],
      prices
    );

    expect(indexes.archetypeByNppId.get(ceoId.toString())).toBe(
      deriveCeoArchetype({ loyalty: 80, ambition: 20, stubbornness: 40 })
    );
    expect(indexes.archetypeByNppId.has(missingPersonalityId.toString())).toBe(false);
    expect(indexes.sectorsByCorp.get(corpId.toString())).toEqual([firstSector, secondSector]);
    expect(indexes.sectorsByCorp.get(corpId.toString())?.[0]).toBe(firstSector);
    expect(indexes.priceByCommodity.get("iron")).toBe(prices[2]);
    expect(indexes.priceByCommodity.get("coal")).toBe(prices[3]);
  });
});

describe("indexOpenUnownedSectors", () => {
  it("preserves country list order and points duplicate buckets at the last document", () => {
    const first = { countryId: "country-a", stateId: "state-1", sectorType: "energy" };
    const second = { countryId: "country-b", stateId: "state-2", sectorType: "industry" };
    const replacement = { countryId: "country-a", stateId: "state-1", sectorType: "energy" };

    const indexes = indexOpenUnownedSectors([first, second, replacement]);

    expect(indexes.unownedByCountry.get("country-a")).toEqual([first, replacement]);
    expect(indexes.unownedByCountry.get("country-a")?.[0]).toBe(first);
    expect(indexes.unownedByCountry.get("country-b")).toEqual([second]);
    expect(indexes.unownedIndex.get("state-1:energy")).toBe(replacement);
    expect(indexes.unownedIndex.get("state-2:industry")).toBe(second);
  });
});
