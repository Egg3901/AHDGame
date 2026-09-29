import { describe, expect, it } from "vitest";
import { planFederationSettlement, type FederationSettlementInput } from "./settlement";

function proposal(): FederationSettlementInput {
  return {
    approval: {
      settlementId: "cs-separation",
      revision: 2,
      availableFromYear: 1992,
      currentYear: 1992,
      requiredParticipants: ["CZ2", "SK"],
      parentMandate: { settlementId: "cs-separation", revision: 2 },
      consents: ["CZ2", "SK"].map((entityId) => ({
        entityId,
        settlementId: "cs-separation",
        revision: 2,
        choice: "approve",
      })),
    },
    regions: [
      { regionId: "CS_A", population: 10, annualGdpAnchor: 40 },
      { regionId: "CS_B", population: 20, annualGdpAnchor: 50 },
      { regionId: "CS_C", population: 10, annualGdpAnchor: 10 },
    ],
    assignments: { CS_A: "CZ2", CS_B: "CZ2", CS_C: "SK" },
    finances: { servicingIssuerId: "CS", financialAssetsMinor: 100, creditorDebtMinor: 200 },
  };
}

describe("approved federation settlement planning", () => {
  it("uses the actual transferred population for financial defaults", () => {
    const input = proposal();
    const before = JSON.stringify(input);
    const { plan } = planFederationSettlement(input);
    expect(plan?.revision).toBe(2);
    expect(plan?.finances.assetAllocation).toEqual({ CZ2: 75, SK: 25 });
    expect(plan?.finances.debtResponsibility).toEqual({ CZ2: 150, SK: 50 });
    expect(plan?.finances.servicingIssuerId).toBe("CS");
    expect(plan?.finances.creditorDebtMinor).toBe(200);
    expect(plan?.territories.reduce((sum, row) => sum + row.annualGdpAnchor, 0)).toBe(100);
    expect(JSON.stringify(input)).toBe(before);
  });

  it("allows separate negotiated asset and debt shares without changing creditors", () => {
    const input = proposal();
    input.finances.assetSharesBps = { CZ2: 5000, SK: 5000 };
    input.finances.debtSharesBps = { CZ2: 10000, SK: 0 };
    const { plan } = planFederationSettlement(input);
    expect(plan?.finances.assetAllocation).toEqual({ CZ2: 50, SK: 50 });
    expect(plan?.finances.debtResponsibility).toEqual({ CZ2: 200, SK: 0 });
    expect(plan?.finances.creditorDebtMinor).toBe(200);
  });

  it("does not produce a plan merely because the historical date has passed", () => {
    const input = proposal();
    input.approval.currentYear = 2000;
    input.approval.parentMandate = null;
    expect(planFederationSettlement(input)).toMatchObject({
      approval: { status: "awaiting-mandate" },
      plan: null,
    });
  });

  it("requires fresh approval for revised terms", () => {
    const input = proposal();
    input.approval.revision = 3;
    input.approval.parentMandate!.revision = 3;
    expect(planFederationSettlement(input)).toMatchObject({
      approval: { status: "awaiting-consent" },
      plan: null,
    });
  });

  it("cannot create an approved financial successor without actual territory", () => {
    const input = proposal();
    input.assignments = { CS_A: "CZ2", CS_B: "CZ2", CS_C: "CZ2" };
    expect(() => planFederationSettlement(input)).toThrow("inhabited territorial base");
  });
});
