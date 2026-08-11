import { describe, it, expect } from "vitest";
import { toPayload, validateRows, type EmbargoProvisionInput } from "./embargoProvisionTypes";

describe("toPayload", () => {
  it("serializes a block embargo (drops cap)", () => {
    const row: EmbargoProvisionInput = {
      action: "embargo",
      targetCountry: "DE",
      commodity: "steel",
      direction: "both",
      mode: "block",
      cap: 5000,
    };
    expect(toPayload(row)).toEqual({
      type: "embargo",
      targetCountry: "DE",
      commodity: "steel",
      direction: "both",
      mode: "block",
    });
  });

  it("serializes a capped embargo (keeps cap)", () => {
    const row: EmbargoProvisionInput = {
      action: "embargo",
      targetCountry: "CN",
      commodity: "all",
      direction: "import",
      mode: "cap",
      cap: 10000,
    };
    expect(toPayload(row)).toEqual({
      type: "embargo",
      targetCountry: "CN",
      commodity: "all",
      direction: "import",
      mode: "cap",
      cap: 10000,
    });
  });

  it("serializes an end_embargo (no mode/cap)", () => {
    const row: EmbargoProvisionInput = {
      action: "end_embargo",
      targetCountry: "UK",
      commodity: "oil",
      direction: "export",
      mode: "block",
    };
    expect(toPayload(row)).toEqual({
      type: "end_embargo",
      targetCountry: "UK",
      commodity: "oil",
      direction: "export",
    });
  });
});

describe("validateRows", () => {
  it("returns an error for an empty list", () => {
    expect(validateRows([])).toMatch(/at least one/i);
  });

  it("returns an error when a row has no target country", () => {
    expect(
      validateRows([
        {
          action: "embargo",
          targetCountry: "",
          commodity: "all",
          direction: "both",
          mode: "block",
        },
      ])
    ).toMatch(/target country/i);
  });

  it("returns an error when a capped embargo has no cap", () => {
    expect(
      validateRows([
        {
          action: "embargo",
          targetCountry: "DE",
          commodity: "steel",
          direction: "both",
          mode: "cap",
        },
      ])
    ).toMatch(/cap/i);
  });

  it("allows a capped embargo with cap 0", () => {
    expect(
      validateRows([
        {
          action: "embargo",
          targetCountry: "DE",
          commodity: "steel",
          direction: "both",
          mode: "cap",
          cap: 0,
        },
      ])
    ).toBeNull();
  });

  it("returns an error for a duplicate (action, target, commodity, direction)", () => {
    expect(
      validateRows([
        {
          action: "embargo",
          targetCountry: "DE",
          commodity: "steel",
          direction: "both",
          mode: "block",
        },
        {
          action: "embargo",
          targetCountry: "DE",
          commodity: "steel",
          direction: "both",
          mode: "cap",
          cap: 1,
        },
      ])
    ).toMatch(/duplicate/i);
  });

  it("treats impose and repeal of the same target as distinct", () => {
    expect(
      validateRows([
        {
          action: "embargo",
          targetCountry: "DE",
          commodity: "steel",
          direction: "both",
          mode: "block",
        },
        {
          action: "end_embargo",
          targetCountry: "DE",
          commodity: "steel",
          direction: "both",
          mode: "block",
        },
      ])
    ).toBeNull();
  });

  it("returns null for a valid block embargo", () => {
    expect(
      validateRows([
        {
          action: "embargo",
          targetCountry: "CN",
          commodity: "all",
          direction: "both",
          mode: "block",
        },
      ])
    ).toBeNull();
  });
});
