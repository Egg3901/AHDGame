import { describe, expect, it } from "vitest";
import { resetLawFamilies, resetLawFamilyById } from "./catalog";
import { regionalLawLevel, regionalLawLevels } from "./regionalCatalog";
import { lawChoiceEligibility } from "./rules/eligibility";

describe("1991 regional service options", () => {
  it("authors five distinct local mechanisms per country without a Cabinet wallet", () => {
    expect(regionalLawLevels).toHaveLength(700);
    for (const country of ["US", "UK", "JP"] as const) {
      const rows = regionalLawLevels.filter(
        (row) => row.country === country && row.familyId === "L19"
      );
      expect(new Set(rows.map((row) => row.position)).size).toBe(5);
      expect(new Set(rows.map((row) => row.title)).size).toBe(5);
      expect(rows.every((row) => row.fundingAccount === "regional_budget")).toBe(true);
      expect(rows.every((row) => row.description.length > 40)).toBe(true);
      expect(rows.every((row) => !/[\u2013\u2014]/.test(row.description))).toBe(true);
      expect(
        rows.every(
          (row) =>
            row.authorityKind === (country === "US" ? "state_statute" : "delegated_service_package")
        )
      ).toBe(true);
      const law = resetLawFamilyById("L19")!;
      expect(lawChoiceEligibility(law, country, "regional", "center_left", "center").allowed).toBe(
        true
      );
    }
  });

  it("authors exactly five local routes for every country-eligible regional family", () => {
    expect(new Set(regionalLawLevels.map((row) => row.familyId)).size).toBe(48);
    for (const family of resetLawFamilies) {
      for (const country of ["US", "UK", "JP"] as const) {
        const rows = regionalLawLevels.filter(
          (row) => row.familyId === family.id && row.country === country
        );
        if (!family.availability.regional.includes(country)) {
          expect(rows).toHaveLength(0);
          continue;
        }
        expect(rows).toHaveLength(5);
        expect(new Set(rows.map((row) => row.title)).size).toBe(5);
        expect(new Set(rows.map((row) => row.position)).size).toBe(5);
        expect(rows.every((row) => row.fundingAccount === "regional_budget")).toBe(true);
        expect(rows.every((row) => row.description.length > 80)).toBe(true);
        expect(rows.every((row) => !/[\u2013\u2014]/.test(row.description))).toBe(true);
        expect(rows[2]!.title).not.toBe(family.levels[2]!.title);
        expect(
          rows.every(
            (row) =>
              row.authorityKind ===
              (country === "US" ? "state_statute" : "delegated_service_package")
          )
        ).toBe(true);
      }
    }
  });

  it("does not imply another national statute for UK or Japan", () => {
    expect(regionalLawLevel("UK", "L19", "center")?.title).not.toBe(
      resetLawFamilyById("L19")?.levels[2]?.title
    );
    expect(regionalLawLevel("JP", "L19", "center")?.authorityKind).toBe(
      "delegated_service_package"
    );
  });
});
