import { describe, expect, it } from "vitest";
import { isLegislationTypeActive, isNewThisEra } from "@/lib/era/legislationCatalog";

describe("legislation-types era filter", () => {
  it("drops pre-window types and flags newly-unlocked ones", () => {
    const rows = [
      { _id: "us_medicaid" }, // from 1965
      { _id: "us_paid_family_leave" }, // from 1993
      { _id: "us_social_security" }, // always
    ];
    const year = 1994;
    const gated = rows
      .filter((t) => isLegislationTypeActive(t._id, year))
      .map((t) => ({ ...t, eraNew: isNewThisEra(t._id, year) }));
    expect(gated.map((r) => r._id)).toEqual([
      "us_medicaid",
      "us_paid_family_leave",
      "us_social_security",
    ]);
    expect(gated.find((r) => r._id === "us_paid_family_leave")!.eraNew).toBe(true);
    expect(gated.find((r) => r._id === "us_medicaid")!.eraNew).toBe(false);
  });

  it("excludes a type still before its window", () => {
    const rows = [{ _id: "us_paid_family_leave" }];
    const gated = rows.filter((t) => isLegislationTypeActive(t._id, 1990));
    expect(gated).toHaveLength(0);
  });
});
