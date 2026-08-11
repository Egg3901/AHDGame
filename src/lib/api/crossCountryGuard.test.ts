import { describe, expect, it } from "vitest";
import { crossCountryActionGuard, CROSS_COUNTRY_ACTION_MESSAGE } from "./crossCountryGuard";

describe("crossCountryActionGuard", () => {
  it("returns null when actor is in the region's country", () => {
    expect(crossCountryActionGuard({ countryId: "US" }, "US")).toBeNull();
    expect(crossCountryActionGuard({ countryId: "CN" }, "CN")).toBeNull();
  });

  it("treats a missing actor country as US (legacy)", () => {
    expect(crossCountryActionGuard({}, "US")).toBeNull();
    expect(crossCountryActionGuard(null, "US")).toBeNull();
    expect(crossCountryActionGuard(undefined, "US")).toBeNull();
  });

  it("returns a 403 when actor is in a different country", async () => {
    const res = crossCountryActionGuard({ countryId: "CN" }, "US");
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
    const body = await res!.json();
    expect(body.error).toBe(CROSS_COUNTRY_ACTION_MESSAGE);
  });

  it("rejects a legacy-missing-country actor against a non-US region", () => {
    // Missing country resolves to US, so it must NOT match a CN region.
    const res = crossCountryActionGuard({}, "CN");
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
  });
});
