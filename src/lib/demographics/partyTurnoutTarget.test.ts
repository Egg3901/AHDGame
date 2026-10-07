import { describe, expect, it } from "vitest";
import { buildPartyTurnoutTargetCatalog, partyTurnoutTargetLabel } from "./partyTurnoutTarget";
import {
  isValidPartyTurnoutTarget,
  resolvePartyTurnoutTargetLean,
} from "./partyTurnoutTargetResolver";
import { resolveCanvassGroup } from "./countryDemographics";
import { getTurnoutTargetsForCountry } from "./turnoutTargets";

describe("party turnout targets", () => {
  it("resolves a census bucket from the same catalog as the region display", () => {
    const target = resolvePartyTurnoutTargetLean("UK", "education", "degree_plus", "1953-default");

    expect(target?.economicLean).toEqual(expect.any(Number));
    expect(target?.socialLean).toEqual(expect.any(Number));
  });

  it("keeps saved voter-archetype targets readable during migration", () => {
    expect(
      isValidPartyTurnoutTarget("UK", "uk_voterGroups", "urban_progressives", "1953-default")
    ).toBe(true);
  });

  it("offers census buckets and existing voter groups together", () => {
    const catalog = buildPartyTurnoutTargetCatalog(
      "UK",
      getTurnoutTargetsForCountry("UK", "1953-default")
    );

    expect(catalog.categories.map((category) => category.id)).toEqual(
      expect.arrayContaining(["ethnicity", "age", "education", "income", "urbanization"])
    );
    expect(catalog.targets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: "education", group: "degree_plus" }),
        expect.objectContaining({
          category: "uk_voterGroups",
          group: "urban_progressives",
        }),
      ])
    );
  });

  it("uses established leans for overlapping targets in both the picker and turn resolver", () => {
    const established = resolveCanvassGroup("US", "race", "white");
    const catalog = buildPartyTurnoutTargetCatalog(
      "US",
      getTurnoutTargetsForCountry("US", "1953-default")
    );
    const pickerTarget = catalog.targets.find(
      (target) => target.category === "race" && target.group === "white"
    );

    expect(established).not.toBeNull();
    expect(pickerTarget).toMatchObject({
      economicLean: established!.economicLean,
      socialLean: established!.socialLean,
    });
    expect(resolvePartyTurnoutTargetLean("US", "race", "white", "1953-default")).toEqual(
      expect.objectContaining({
        economicLean: established!.economicLean,
        socialLean: established!.socialLean,
      })
    );
  });

  it("preserves authored labels for saved voter-group targets", () => {
    expect(partyTurnoutTargetLabel("UK", "uk_voterGroups", "public_sector")).toBe(
      "Public Sector & NHS"
    );
    expect(partyTurnoutTargetLabel("UK", "education", "degree_plus")).toBe("Degree or higher");
  });

  it("rejects a bucket from another country's electorate", () => {
    expect(isValidPartyTurnoutTarget("UK", "race", "black", "1953-default")).toBe(false);
  });
});
