import { describe, expect, it } from "vitest";
import { planPrivateFirmSuccession, type PrivateSuccessionFirm } from "./privateFacilities";

const firm: PrivateSuccessionFirm = {
  corporationId: "firm-1",
  countryId: "RU",
  headquartersState: "KYIV",
  headquartersRegionId: "UKRAINE",
  facilities: [
    { sectorId: "plant-1", regionId: "UKRAINE", bookValueAnchor: 1200 },
    { sectorId: "plant-2", regionId: "RUSSIA", bookValueAnchor: 800 },
  ],
};
const base = {
  settlementId: "ussr-1991",
  sourceCountryId: "RU" as const,
  territories: [
    { entityId: "RU", regionIds: ["RUSSIA"], population: 1, annualGdpAnchor: 1 },
    { entityId: "UA", regionIds: ["UKRAINE"], population: 1, annualGdpAnchor: 1 },
  ],
  firms: [firm],
  playableHeadquarters: [{ countryId: "RU" as const, stateId: "MOSCOW" }],
};

describe("private firm succession", () => {
  it("keeps a firm pending without paying a claim into a dissolved home country", () => {
    expect(planPrivateFirmSuccession({ ...base, choices: {} })).toEqual([
      {
        corporationId: "firm-1",
        status: "pending-headquarters",
        claims: [
          {
            claimId: "ussr-1991:facility:plant-1",
            corporationId: "firm-1",
            sectorId: "plant-1",
            debtorEntityId: "UA",
            creditorCountryId: null,
            amountAnchor: 1200,
          },
        ],
      },
    ]);
  });

  it("preserves the firm and assigns only local successor facilities to compensated claims", () => {
    const destination = { countryId: "RU" as const, stateId: "MOSCOW" };
    const [plan] = planPrivateFirmSuccession({
      ...base,
      choices: { "firm-1": destination },
    });
    expect(plan.status).toBe("relocating");
    expect(plan.destination).toEqual(destination);
    expect(plan.claims).toHaveLength(1);
    expect(plan.claims[0].amountAnchor).toBe(1200);
    expect(plan.claims[0].creditorCountryId).toBe("RU");
  });

  it("rejects fake destinations and duplicate facilities", () => {
    expect(() =>
      planPrivateFirmSuccession({
        ...base,
        choices: { "firm-1": { countryId: "RU", stateId: "UNAVAILABLE" } },
      })
    ).toThrow("unavailable headquarters");
    expect(() =>
      planPrivateFirmSuccession({
        ...base,
        firms: [{ ...firm, facilities: [firm.facilities[0], firm.facilities[0]] }],
        choices: {},
      })
    ).toThrow("invalid identity");
  });
});
