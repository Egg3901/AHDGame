import { describe, expect, it } from "vitest";
import { getBondHolderPresentation } from "./bondHolderPresentation";
import type { Holder } from "./bondTypes";

function holder(overrides: Partial<Holder>): Holder {
  return {
    type: "central_bank",
    id: "holder-id",
    name: "Holder",
    units: 10,
    percentage: 10,
    value: 10_000,
    ...overrides,
  };
}

describe("getBondHolderPresentation", () => {
  it("links NPP investors and identifies them independently from player characters", () => {
    expect(
      getBondHolderPresentation(holder({ type: "npp", sequentialId: 42, avatarUrl: "/npp.png" }))
    ).toEqual({
      href: "/politicians/npp/42",
      imageUrl: "/npp.png",
      typeLabel: "Non-player investor",
    });
  });

  it("links country and global funds to their existing fund pages", () => {
    expect(
      getBondHolderPresentation(holder({ type: "fund", slug: "us-bond-fund", fundCountryId: "US" }))
    ).toMatchObject({
      href: "/country/us/stockmarket/fund/us-bond-fund",
      typeLabel: "Index fund",
    });
    expect(
      getBondHolderPresentation(holder({ type: "fund", slug: "global-bond-fund" }))
    ).toMatchObject({
      href: "/stockmarket/global/fund/global-bond-fund",
      typeLabel: "Index fund",
    });
  });

  it("renders central-bank ownership as an identified non-linking holder", () => {
    expect(getBondHolderPresentation(holder({ type: "central_bank" }))).toEqual({
      href: null,
      typeLabel: "Central bank",
    });
  });
});
