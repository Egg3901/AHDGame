import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { isPolicyProvision, type NationalizeProvision } from "./legislation";

describe("isPolicyProvision", () => {
  it("is false for a nationalize provision", () => {
    const p: NationalizeProvision = {
      type: "nationalize",
      targetCorporationId: new ObjectId(),
    };
    expect(isPolicyProvision(p)).toBe(false);
  });

  it("is true for a bare policy provision (no type field)", () => {
    expect(isPolicyProvision({ legislationTypeId: "x", effectDirection: 1 })).toBe(true);
  });
});
