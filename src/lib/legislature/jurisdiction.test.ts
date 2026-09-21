import { describe, expect, it } from "vitest";
import type { LegislationType } from "@/lib/db/types/legislation";
import { commonJurisdictionChoices, resolveBillJurisdiction } from "./jurisdiction";

function type(
  id: string,
  allowed: NonNullable<LegislationType["administration"]>["allowedJurisdictionModes"],
  defaultJurisdictionMode: NonNullable<LegislationType["administration"]>["defaultJurisdictionMode"]
): Pick<LegislationType, "_id" | "name" | "administration"> {
  return {
    _id: id,
    name: id,
    administration: {
      primaryPortfolioId: "health",
      lawKind: "service_program",
      implementationMode: "direct",
      allowedJurisdictionModes: allowed,
      defaultJurisdictionMode,
      policyFamilyId: id,
    },
  };
}

describe("resolveBillJurisdiction", () => {
  it("preserves legacy national behavior while disabled", () => {
    expect(
      resolveBillJurisdiction({
        enabled: false,
        requested: "regional_discretion",
        legislationTypes: [],
      })
    ).toEqual({ ok: true, mode: "national_direct" });
  });

  it("accepts a mode shared by every policy provision", () => {
    const result = resolveBillJurisdiction({
      enabled: true,
      requested: "regional_discretion",
      legislationTypes: [
        type("a", ["national_direct", "regional_discretion"], "national_direct"),
        type("b", ["concurrent", "regional_discretion"], "concurrent"),
      ],
    });
    expect(result).toEqual({ ok: true, mode: "regional_discretion" });
  });

  it("rejects a mode unavailable to any provision", () => {
    const result = resolveBillJurisdiction({
      enabled: true,
      requested: "regional_discretion",
      legislationTypes: [type("a", ["national_direct"], "national_direct")],
    });
    expect(result.ok).toBe(false);
  });

  it("requires a choice when defaults differ and national direct is not shared", () => {
    const result = resolveBillJurisdiction({
      enabled: true,
      legislationTypes: [
        type("a", ["grant_supported_regional"], "grant_supported_regional"),
        type("b", ["regional_discretion"], "regional_discretion"),
      ],
    });
    expect(result.ok).toBe(false);
  });
});

describe("commonJurisdictionChoices", () => {
  it("intersects multi-provision choices and prefers a shared authored default", () => {
    expect(
      commonJurisdictionChoices([
        {
          allowedJurisdictionModes: ["national_direct", "concurrent"],
          defaultJurisdictionMode: "concurrent",
        },
        {
          allowedJurisdictionModes: ["concurrent", "regional_discretion"],
          defaultJurisdictionMode: "concurrent",
        },
      ])
    ).toEqual({ modes: ["concurrent"], defaultMode: "concurrent" });
  });

  it("hides choices when any selected type lacks administration metadata", () => {
    expect(commonJurisdictionChoices([undefined])).toEqual({ modes: [] });
  });
});
