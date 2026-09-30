import { describe, expect, it } from "vitest";
import { planSuccessionFinances } from "./financialSettlement";
import { planSuccessionFiscalShares } from "./fiscalShares";
import type { PrivateFirmSuccessionPlan } from "./privateFacilities";

const continuing = planSuccessionFinances({
  settlementId: "ussr-1",
  sourceEntityId: "RU",
  participants: [
    { entityId: "RU", population: 2 },
    { entityId: "UKR", population: 1 },
  ],
  financialAssetsMinor: 101,
  creditorDebtMinor: 1000,
});

const firms: PrivateFirmSuccessionPlan[] = [
  {
    corporationId: "firm-1",
    status: "pending-headquarters",
    claims: [
      {
        claimId: "ussr-1:facility:mill-1",
        corporationId: "firm-1",
        sectorId: "mill-1",
        debtorEntityId: "UKR",
        creditorCountryId: null,
        amountAnchor: 25.5,
      },
    ],
  },
];

describe("succession fiscal shares", () => {
  it("keeps creditor principal with the issuer and assigns contributions and local claims", () => {
    const shares = planSuccessionFiscalShares({ finances: continuing, privateFirms: firms });
    expect(shares).toEqual([
      {
        entityId: "RU",
        kind: "continuing-state",
        financialAssetEntitlementMinor: 67,
        creditorContributionMinor: 667,
        servicingCreditorPrincipalMinor: 1000,
        cashDeficitResponsibilityMinor: 0,
        facilityClaimLiabilityMinor: 0,
        claimIds: [],
      },
      {
        entityId: "UKR",
        kind: "background-successor",
        financialAssetEntitlementMinor: 34,
        creditorContributionMinor: 333,
        servicingCreditorPrincipalMinor: 0,
        cashDeficitResponsibilityMinor: 0,
        facilityClaimLiabilityMinor: 2550,
        claimIds: ["ussr-1:facility:mill-1"],
      },
    ]);
  });

  it("creates a legacy servicing administration after full dissolution", () => {
    const finances = planSuccessionFinances({
      settlementId: "cs-1",
      sourceEntityId: "CS",
      participants: [
        { entityId: "CZ2", population: 2 },
        { entityId: "SK", population: 1 },
      ],
      financialAssetsMinor: 0,
      creditorDebtMinor: 101,
      cashDeficitMinor: 11,
    });
    const shares = planSuccessionFiscalShares({ finances, privateFirms: [] });
    expect(shares.find((share) => share.entityId === "CS")).toMatchObject({
      kind: "legacy-administration",
      servicingCreditorPrincipalMinor: 101,
      creditorContributionMinor: 0,
    });
    expect(shares.reduce((sum, share) => sum + share.creditorContributionMinor, 0)).toBe(101);
    expect(shares.reduce((sum, share) => sum + share.cashDeficitResponsibilityMinor, 0)).toBe(11);
    expect(shares.reduce((sum, share) => sum + share.servicingCreditorPrincipalMinor, 0)).toBe(101);
  });

  it("rejects a broken allocation and duplicate or misplaced private claims", () => {
    expect(() =>
      planSuccessionFiscalShares({
        finances: { ...continuing, debtResponsibility: { RU: 667, UKR: 334 } },
        privateFirms: [],
      })
    ).toThrow(/conserve/);
    expect(() =>
      planSuccessionFiscalShares({ finances: continuing, privateFirms: [...firms, ...firms] })
    ).toThrow(/outside/);
    expect(() =>
      planSuccessionFiscalShares({
        finances: continuing,
        privateFirms: [
          {
            ...firms[0],
            claims: [{ ...firms[0].claims[0], debtorEntityId: "RU" }],
          },
        ],
      })
    ).toThrow(/outside/);
  });
});
