import { describe, expect, it } from "vitest";
import { chooseSeedExtractionSite } from "./seedPlacement";
import { getStateResourceCapacity } from "@/lib/seeds/reference/stateResourceCapacity";

describe("fresh miners use viable deposits", () => {
  it.each(["US", "UK", "JP"])(
    "finds abundant real deposits in %s rather than using the capital",
    (country) => {
      const regions = Object.entries(getStateResourceCapacity("1991-default"))
        .filter(([, row]) => row.countryId === country)
        .map(([key, row]) => ({ stateId: key.split(":")[1]!, resources: row.resources }));
      const site = chooseSeedExtractionSite(regions);
      expect(site).not.toBeNull();
      expect(site!.supportedDailyRevenue).toBeGreaterThan(25_000 * 100);
      expect(site!.stateId).not.toBe(country === "JP" ? "TOK" : country === "UK" ? "LON" : "DC");
    }
  );
  it("rejects barren geography instead of granting imaginary production", () => {
    expect(chooseSeedExtractionSite([{ stateId: "TOK", resources: {} }])).toBeNull();
  });
});
