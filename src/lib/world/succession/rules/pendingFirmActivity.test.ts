import { describe, expect, it } from "vitest";
import { excludePendingFederationFirms } from "./pendingFirmActivity";

describe("protected federation firm activity", () => {
  it("pauses only the held firm and its retained facilities", () => {
    const firms = [{ _id: "held", federationPendingHeadquartersId: "split:1" }, { _id: "active" }];
    const facilities = [
      { corporationId: "held", stateId: "RUSSIA" },
      { corporationId: "active", stateId: "RUSSIA" },
    ];
    expect(excludePendingFederationFirms(firms, facilities)).toEqual({
      firms: [firms[1]],
      facilities: [facilities[1]],
    });
  });
});
