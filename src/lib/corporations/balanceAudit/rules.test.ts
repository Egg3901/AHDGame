import { describe, expect, it } from "vitest";
import { buildCorporationBalanceAudit, classifyCorporationManagement } from "./rules";

describe("classifyCorporationManagement", () => {
  it("uses explicit precedence so state and vacant corporations are not counted as players", () => {
    expect(
      classifyCorporationManagement({
        ownershipState: "stateOwned",
        ceoType: "character",
        userId: "real-user",
      })
    ).toBe("state-controlled");
    expect(
      classifyCorporationManagement({ ceoVacant: true, ceoType: "character", userId: "real-user" })
    ).toBe("vacant");
  });

  it("recognises legacy player corporations by their non-system user", () => {
    expect(classifyCorporationManagement({ userId: "real-user" })).toBe("player-managed");
    expect(classifyCorporationManagement({ userId: "000000000000000000000000" })).toBe(
      "unclassified"
    );
  });
});

describe("buildCorporationBalanceAudit", () => {
  it("publishes explicit all-corp, active-revenue, and listed denominators", () => {
    const report = buildCorporationBalanceAudit([
      {
        id: "player",
        ceoType: "character",
        revenueAnchor: 100,
        profitAnchor: 25,
        marketCapAnchor: 1_000,
      },
      {
        id: "state",
        countryOwnerId: "US",
        revenueAnchor: 300,
        profitAnchor: 60,
        marketCapAnchor: null,
      },
      {
        id: "vacant",
        ceoVacant: true,
        revenueAnchor: 0,
        profitAnchor: 0,
        marketCapAnchor: 500,
      },
    ]);

    expect(report.schemaVersion).toBe(1);
    expect(report.denominators).toEqual({
      corporations: 3,
      revenueActiveCorporations: 2,
      revenueAnchor: 400,
      listedCorporations: 2,
      listedMarketCapAnchor: 1_500,
    });
    expect(report.cohorts["player-managed"].revenueShare).toBe(0.25);
    expect(report.cohorts["state-controlled"].margin).toBe(0.2);
    expect(report.cohorts.vacant.listedMarketCapShare).toBe(1 / 3);
  });
});
