import { describe, it, expect } from "vitest";
import type { CongressionalDistrict } from "@/lib/db/types/congressionalDistrict";
import { buildDistrictSquareViews } from "./districtSquareResponse";

function doc(partial: Partial<CongressionalDistrict>): CongressionalDistrict {
  return {
    _id: "US_CA_1",
    countryId: "US",
    stateId: "CA",
    index: 1,
    squares: { left: 8, right: 6, grey: 2 },
    netLean: -2,
    greyShare: 2 / 16,
    holderCharacterId: null,
    holderNppId: null,
    holderParty: null,
    source: "cookpvi",
    lastRedrawnCensus: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...partial,
  };
}

describe("buildDistrictSquareViews", () => {
  it("joins sorted cd codes to docs by index and resolves holder names", () => {
    const staticCds = ["CA-02", "CA-01"]; // unsorted on purpose
    const docs = [
      doc({ _id: "US_CA_1", index: 1, holderParty: "DEM", holderCharacterId: "char1" as never }),
      doc({ _id: "US_CA_2", index: 2, holderParty: null, holderCharacterId: null }),
    ];
    const views = buildDistrictSquareViews(staticCds, docs, { char1: "Jane Doe" });

    expect(views).toHaveLength(2);
    // sorted: CA-01 → index 1, CA-02 → index 2
    expect(views[0]).toMatchObject({
      index: 1,
      cd: "CA-01",
      holderParty: "DEM",
      holderName: "Jane Doe",
    });
    expect(views[1]).toMatchObject({ index: 2, cd: "CA-02", holderParty: null, holderName: null });
  });

  it("omits indices that have no doc", () => {
    const views = buildDistrictSquareViews(["CA-01", "CA-02"], [doc({ index: 1 })], {});
    expect(views).toHaveLength(1);
    expect(views[0].index).toBe(1);
  });
});
