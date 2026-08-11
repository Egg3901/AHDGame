import { describe, expect, it } from "vitest";
import { buildStatePartyRows } from "./buildStatePartyRows";

describe("buildStatePartyRows", () => {
  it("joins states + org rows + npp counts + chair names + targets", () => {
    const rows = buildStatePartyRows({
      states: [
        { _id: "CA", name: "California" },
        { _id: "WY", name: "Wyoming" },
      ],
      orgRows: [
        {
          stateId: "CA",
          organization: 70,
          politicalStrength: 40,
          treasury: 500000,
          registration: 55,
          chairId: "c1",
          hasPresence: true,
        },
      ],
      nppCountByState: { CA: 3 },
      chairNameById: { c1: "Ada Lovelace" },
      targetStateIds: ["CA"],
      leanByState: { CA: 4, WY: -8 },
    });
    const ca = rows.find((r) => r.regionId === "CA")!;
    expect(ca).toMatchObject({
      regionId: "CA",
      name: "California",
      organization: 70,
      politicalStrength: 40,
      treasury: 500000,
      registrationPct: 55,
      chairName: "Ada Lovelace",
      nppCount: 3,
      isTarget: true,
      hasPresence: true,
      lean: 4,
    });
    const wy = rows.find((r) => r.regionId === "WY")!;
    expect(wy).toMatchObject({
      organization: 0,
      politicalStrength: 0,
      treasury: 0,
      chairName: null,
      nppCount: 0,
      isTarget: false,
      hasPresence: false,
    });
  });
});
