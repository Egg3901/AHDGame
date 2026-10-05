import { describe, expect, it } from "vitest";
import type { LegislationType } from "@/lib/db/types/legislation";
import { resolvePolicyOptionJurisdiction, validateBillAdministration } from "./jurisdiction";

function type(
  id: string,
  defaultJurisdictionMode: NonNullable<
    LegislationType["administration"]
  >["defaultJurisdictionMode"] = "national_direct"
): Pick<LegislationType, "_id" | "name" | "administration"> {
  return {
    _id: id,
    name: id,
    administration: {
      primaryPortfolioId: "health",
      lawKind: "service_program",
      implementationMode: "direct",
      allowedJurisdictionModes: [defaultJurisdictionMode],
      defaultJurisdictionMode,
      policyFamilyId: id,
    },
  };
}

describe("validateBillAdministration", () => {
  it("allows legacy bills while administration is disabled", () => {
    expect(
      validateBillAdministration({
        enabled: false,
        legislationTypes: [{ _id: "legacy", name: "Legacy" }],
      })
    ).toEqual({ ok: true });
  });

  it("accepts provisions with different authored delivery models", () => {
    expect(
      validateBillAdministration({
        enabled: true,
        legislationTypes: [type("direct"), type("grant", "grant_supported_regional")],
      })
    ).toEqual({ ok: true });
  });

  it("rejects an unmigrated administered law", () => {
    const result = validateBillAdministration({
      enabled: true,
      legislationTypes: [{ _id: "missing", name: "Missing" }],
    });
    expect(result).toEqual({
      ok: false,
      error: 'Legislation type "Missing" has not been migrated to the administration model.',
    });
  });
});

describe("resolvePolicyOptionJurisdiction", () => {
  it("uses an explicit option consequence before every fallback", () => {
    expect(
      resolvePolicyOptionJurisdiction(
        type("education"),
        {
          id: "left_to_states",
          name: "Left to the States",
          stance: "center",
          effectDirection: 0,
          economic: 0,
          social: 0,
          jurisdictionMode: "regional_discretion",
        },
        "concurrent"
      )
    ).toBe("regional_discretion");
  });

  it("preserves a legacy bill selection when the option has no authored override", () => {
    expect(resolvePolicyOptionJurisdiction(type("legacy"), undefined, "national_floor")).toBe(
      "national_floor"
    );
  });

  it("defaults new national options to their law's federal delivery model", () => {
    expect(resolvePolicyOptionJurisdiction(type("federal"), undefined)).toBe("national_direct");
    expect(
      resolvePolicyOptionJurisdiction(type("grant", "grant_supported_regional"), undefined)
    ).toBe("grant_supported_regional");
  });
});
