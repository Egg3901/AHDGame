import { describe, expect, it } from "vitest";
import { resetLawFamilies } from "./catalog";
import { openingLawReference, openingLawReferences } from "./openingLaw";
import { resetTaxes } from "./taxCatalog";
import { getBasePolicies } from "@/lib/seeds/reference/basePolicies";
import { generateDefaultEnactedLaws } from "@/lib/seeds/reference/budgets";
import { states1991 } from "@/lib/countries/us/data/usStates1991";
import { ukRegions1991 } from "@/lib/countries/uk/data/ukRegions1991";
import { jpRegions1991 } from "@/lib/countries/jp/data/jpRegions1991";

describe("1991 current-law references", () => {
  it("covers every family and tax type for all three countries at both scopes", () => {
    expect(openingLawReferences).toHaveLength(360);
    expect(new Set(openingLawReferences.map((row) => row.key)).size).toBe(360);
    const ids = [
      ...resetLawFamilies.map((family) => family.id),
      ...new Set(resetTaxes.map((tax) => tax.id)),
    ];
    for (const country of ["US", "UK", "JP"] as const) {
      for (const scope of ["national", "regional"] as const) {
        for (const id of ids)
          expect(
            openingLawReference(country, scope, id),
            `${country} ${scope} ${id}`
          ).toBeDefined();
      }
    }
  });

  it("keeps present-day seed laws out of the 1991 reset baseline", () => {
    expect(openingLawReference("UK", "national", "L01")?.sourceComponents).toContainEqual(
      expect.objectContaining({
        sourceId: "uk_universal_credit",
        historicalDisposition: "not-adopted-as-1991-law",
      })
    );
    expect(openingLawReference("UK", "national", "L30")?.currentLaw).toMatch(
      /no statutory net-zero target/i
    );
  });

  it("provides reference text without treating center as current law", () => {
    for (const row of openingLawReferences) {
      expect(row.currentLaw.trim()).not.toBe("");
      expect(row.currentLaw).not.toMatch(/[\u2013\u2014]/);
      expect(row.legalNote).not.toMatch(/[\u2013\u2014]/);
    }
  });

  it("retains actual source option and books each source to one family per scope", () => {
    const owned = new Set<string>();
    for (const row of openingLawReferences) {
      for (const component of row.sourceComponents) {
        expect(component.selectedOption.trim()).not.toBe("");
        expect(component.optionIndex).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(component.annualBooked)).toBe(true);
        if (component.fiscalRole !== "single-booked-owner") continue;
        const key = `${row.country}:${row.scope}:${component.sourceId}`;
        expect(owned.has(key), key).toBe(false);
        owned.add(key);
        expect(component.fiscalOwner).toBe(row.familyId);
      }
    }
    expect(openingLawReference("US", "national", "L19")?.sourceComponents).toContainEqual(
      expect.objectContaining({
        sourceId: "us_public_health",
        selectedOption: "Public Health Services Act",
        optionIndex: 3,
        annualBooked: 2_799_164_700,
      })
    );
  });

  it("distinguishes the 1991 legal-policy seed from its separate fiscal cost seed", async () => {
    const policies = await getBasePolicies("1991-default");
    const laws = generateDefaultEnactedLaws("1991-default");
    const expectedNoPolicy = new Set([
      "UK:uk_state_pensions",
      "UK:uk_devolution_local_powers",
      "JP:jp_regional_autonomy",
      "JP:jp_resident_tax",
      "JP:jp_fixed_asset_tax",
    ]);
    const expectedBudgetOptionDifferences = { US: 4, UK: 3, JP: 13 };
    for (const country of ["US", "UK", "JP"] as const) {
      let budgetOptionDifferences = 0;
      for (const reference of openingLawReferences.filter(
        (row) => row.country === country && row.scope === "national"
      )) {
        for (const component of reference.sourceComponents.filter(
          (item) => item.fiscalRole === "single-booked-owner"
        )) {
          const key = `${country}:${component.sourceId}`;
          const policy = policies.find(
            (item) => item.scope === "national" && item.legislationTypeId === component.sourceId
          );
          if (!policy) {
            expect(expectedNoPolicy.has(key), key).toBe(true);
          } else {
            expect(policy.policyOptionIndex, key).toBe(component.optionIndex);
          }
          const budgetLaw = laws.find(
            (item) =>
              item.countryId === country &&
              item.scope === "national" &&
              item.legislationTypeId === component.sourceId
          );
          if (budgetLaw && budgetLaw.policyOptionIndex !== component.optionIndex) {
            budgetOptionDifferences += 1;
          }
        }
      }
      expect(budgetOptionDifferences).toBe(expectedBudgetOptionDifferences[country]);
    }
  });

  it("matches every regional source component to each of the 71 actual 1991 region policy seeds", async () => {
    const policies = await getBasePolicies("1991-default");
    const byRegionAndSource = new Map(
      policies
        .filter((policy) => policy.scope === "state")
        .map((policy) => [`${policy.stateId}:${policy.legislationTypeId}`, policy])
    );
    const regions = { US: states1991, UK: ukRegions1991, JP: jpRegions1991 };
    for (const country of ["US", "UK", "JP"] as const) {
      for (const region of regions[country]) {
        for (const reference of openingLawReferences.filter(
          (row) => row.country === country && row.scope === "regional"
        )) {
          for (const component of reference.sourceComponents) {
            const key = `${region._id}:${component.sourceId}`;
            expect(byRegionAndSource.get(key)?.policyOptionIndex, `${country}:${key}`).toBe(
              component.optionIndex
            );
          }
        }
      }
    }
  });
});
