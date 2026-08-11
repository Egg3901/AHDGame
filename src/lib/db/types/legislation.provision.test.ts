import { describe, it, expect } from "vitest";
import { isPolicyProvision, type BillProvision } from "./legislation";

describe("isPolicyProvision", () => {
  it("does NOT treat an international_organization provision as a policy provision", () => {
    const p = {
      type: "international_organization",
      subType: "join",
      organizationId: "EU",
      organizationName: "European Union",
    } as unknown as BillProvision;
    expect(isPolicyProvision(p)).toBe(false);
  });
});
