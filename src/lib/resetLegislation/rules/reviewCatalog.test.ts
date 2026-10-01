import { describe, expect, it } from "vitest";
import { resetLawFamilyById } from "../catalog";
import { openingLawReference } from "../openingLaw";
import profiles from "../provisionalBalanceProfiles.json";
import { buildReviewedOptionCatalog, openingChoice1991 } from "./reviewCatalog";

describe("reviewed v2 law catalog", () => {
  it("keeps the opening law on a middle rung and prices all selectable levels", () => {
    const family = resetLawFamilyById("L18")!;
    const reference = openingLawReference("US", "national", "L18")!;
    const profile = profiles.find((row) => row.familyId === "L18")!;
    const entries = buildReviewedOptionCatalog({
      family,
      reference,
      profile,
      country: "US",
      scope: "national",
      year: 1991,
      jurisdictionGdp: 6_158_100_000_000,
      fundingAccountId: "US:health_and_human_services",
      legalAuthorityId: "US:national:L18",
      serviceDelivererId: "health_and_human_services",
    });
    expect(["center_left", "center", "center_right"]).toContain(openingChoice1991(reference));
    expect(entries).toHaveLength(family.leaveToStates ? 6 : 5);
    expect(entries.every((entry) => Number.isSafeInteger(entry.option.annualAllocation))).toBe(
      true
    );
    expect(entries.every((entry) => entry.primaryMetricEffects.length > 0)).toBe(true);
  });

  it("authors leave-to-states as zero federal allocation, not a centrist rung", () => {
    const family = resetLawFamilyById("L18")!;
    const reference = openingLawReference("US", "national", "L18")!;
    const profile = profiles.find((row) => row.familyId === "L18")!;
    const entry = buildReviewedOptionCatalog({
      family,
      reference,
      profile,
      country: "US",
      scope: "national",
      year: 1991,
      jurisdictionGdp: 6_158_100_000_000,
      fundingAccountId: "US:health_and_human_services",
      legalAuthorityId: "US:national:L18",
      serviceDelivererId: "health_and_human_services",
    }).find((candidate) => candidate.option.choice === "leave_to_states");
    expect(entry?.option.annualAllocation).toBe(0);
    expect(entry?.title).toBe("Leave it to the States");
  });
});
