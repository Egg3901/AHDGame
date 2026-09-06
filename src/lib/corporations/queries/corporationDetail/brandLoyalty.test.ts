import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import { buildBrandLoyaltyFields } from "./brandLoyalty";

const OWNER = new ObjectId();

describe("buildBrandLoyaltyFields (#587)", () => {
  it("omits everything when the feature is off for this corp", () => {
    expect(
      buildBrandLoyaltyFields({ brandLoyalty: undefined, userId: OWNER } as never, OWNER.toString())
    ).toEqual({});
  });

  it("gives a non-owner the label but never the number", () => {
    const out = buildBrandLoyaltyFields(
      { brandLoyalty: 72.44, brandPostureNorm: 3, userId: OWNER } as never,
      new ObjectId().toString()
    );
    expect(out.brandLoyaltyLabel).toBeTruthy();
    expect(out.brandLoyalty).toBeUndefined();
    expect(out.brandPostureNorm).toBeUndefined();
  });

  it("gives the owner the rounded number and the posture norm", () => {
    const out = buildBrandLoyaltyFields(
      { brandLoyalty: 72.44, brandPostureNorm: 3, userId: OWNER } as never,
      OWNER.toString()
    );
    expect(out.brandLoyalty).toBe(72.4);
    expect(out.brandPostureNorm).toBe(3);
  });

  // A state-owned corp has no private owner, so a matching userId must not
  // unlock owner-only intel.
  it("treats a state-owned corp as having no owner", () => {
    const out = buildBrandLoyaltyFields(
      { brandLoyalty: 50, userId: OWNER, countryOwnerId: "US" } as never,
      OWNER.toString()
    );
    expect(out.brandLoyaltyLabel).toBeTruthy();
    expect(out.brandLoyalty).toBeUndefined();
  });

  it("treats a signed-out viewer as a non-owner", () => {
    const out = buildBrandLoyaltyFields({ brandLoyalty: 50, userId: OWNER } as never, null);
    expect(out.brandLoyalty).toBeUndefined();
  });

  it("keeps a zero loyalty visible rather than treating it as absent", () => {
    const out = buildBrandLoyaltyFields(
      { brandLoyalty: 0, userId: OWNER } as never,
      OWNER.toString()
    );
    expect(out.brandLoyaltyLabel).toBeTruthy();
    expect(out.brandLoyalty).toBe(0);
  });
});
