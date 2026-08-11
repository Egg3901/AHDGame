import { describe, it, expect } from "vitest";
import { toPayload, validateRows, type TariffProvisionInput } from "./tariffProvisionTypes";

describe("toPayload", () => {
  it("serializes an economy_wide row (no target)", () => {
    const row: TariffProvisionInput = { scopeType: "economy_wide", rate: 15 };
    expect(toPayload(row)).toEqual({ type: "tariff", scopeType: "economy_wide", rate: 15 });
  });

  it("serializes a sector row", () => {
    const row: TariffProvisionInput = {
      scopeType: "sector",
      targetSectorType: "automobiles",
      rate: 20,
    };
    expect(toPayload(row)).toEqual({
      type: "tariff",
      scopeType: "sector",
      targetSectorType: "automobiles",
      rate: 20,
    });
  });

  it("serializes an origin_country row", () => {
    const row: TariffProvisionInput = {
      scopeType: "origin_country",
      targetOriginCountryId: "US",
      rate: 10,
    };
    expect(toPayload(row)).toEqual({
      type: "tariff",
      scopeType: "origin_country",
      targetOriginCountryId: "US",
      rate: 10,
    });
  });
});

describe("validateRows", () => {
  it("returns an error for an empty list", () => {
    expect(validateRows([])).toMatch(/at least one/i);
  });

  it("returns an error when a sector row has no target", () => {
    expect(validateRows([{ scopeType: "sector", rate: 10 } as TariffProvisionInput])).toMatch(
      /sector/i
    );
  });

  it("returns an error when an origin_country row has no target", () => {
    expect(
      validateRows([{ scopeType: "origin_country", rate: 10 } as TariffProvisionInput])
    ).toMatch(/origin country/i);
  });

  it("returns an error for a duplicate (scope, target) within the set", () => {
    expect(
      validateRows([
        { scopeType: "origin_country", targetOriginCountryId: "US", rate: 10 },
        { scopeType: "origin_country", targetOriginCountryId: "US", rate: 20 },
      ])
    ).toMatch(/duplicate/i);
  });

  it("allows different sectors in the same bill", () => {
    expect(
      validateRows([
        { scopeType: "sector", targetSectorType: "automobiles", rate: 10 },
        { scopeType: "sector", targetSectorType: "technology", rate: 15 },
      ])
    ).toBeNull();
  });

  it("returns null for a valid single row", () => {
    expect(
      validateRows([{ scopeType: "origin_country", targetOriginCountryId: "US", rate: 15 }])
    ).toBeNull();
  });
});
