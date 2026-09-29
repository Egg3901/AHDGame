import { describe, expect, it } from "vitest";
import { SOVIET_REPUBLIC_REFERENCE_1990 } from "@/lib/seeds/reference/sovietRepublics1990";
import { SUCCESSOR_NOMINAL_GDP_1991 } from "@/lib/seeds/reference/successorGdp1991";
import { planFederationSettlement } from "./settlement";

describe("Soviet republic source partition", () => {
  it("conserves all 15 republics, residents and financial claims", () => {
    const republics = Object.entries(SOVIET_REPUBLIC_REFERENCE_1990);
    const participants = republics.map(([entityId]) => entityId);
    const russianGdpMillionRub = SUCCESSOR_NOMINAL_GDP_1991.RU / 1_000_000;
    const result = planFederationSettlement({
      approval: {
        settlementId: "soviet-1991-test",
        revision: 1,
        availableFromYear: 1991,
        currentYear: 1991,
        requiredParticipants: participants,
        parentMandate: { settlementId: "soviet-1991-test", revision: 1 },
        consents: participants.map((entityId) => ({
          entityId,
          settlementId: "soviet-1991-test",
          revision: 1,
          choice: "approve" as const,
        })),
      },
      regions: republics.map(([regionId, republic]) => ({
        regionId,
        population: republic.population,
        annualGdpAnchor: (russianGdpMillionRub * republic.nmpShareBps) / 6_110,
      })),
      assignments: Object.fromEntries(participants.map((entityId) => [entityId, entityId])),
      finances: {
        sourceEntityId: "RU",
        financialAssetsMinor: 28_862_400,
        creditorDebtMinor: 10_000_001,
      },
    });

    expect(result.approval.status).toBe("ready");
    expect(result.plan?.territories).toHaveLength(15);
    expect(result.plan?.territories.reduce((sum, row) => sum + row.population, 0)).toBe(
      288_624_000
    );
    expect(result.plan?.territories.reduce((sum, row) => sum + row.annualGdpAnchor, 0)).toBeCloseTo(
      (russianGdpMillionRub * 10_000) / 6_110
    );
    expect(
      Object.values(result.plan?.finances.assetAllocation ?? {}).reduce((a, b) => a + b, 0)
    ).toBe(28_862_400);
    expect(
      Object.values(result.plan?.finances.debtResponsibility ?? {}).reduce((a, b) => a + b, 0)
    ).toBe(10_000_001);
    expect(result.plan?.finances.servicingIssuerId).toBe("RU");
    expect(result.plan?.finances.servicingEntityKind).toBe("continuing-state");
  });
});
