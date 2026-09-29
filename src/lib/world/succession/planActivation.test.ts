import { describe, expect, it } from "vitest";
import { tier3Entry } from "@/lib/world/registry/builders";
import { planSuccessionFinances } from "./rules/financialSettlement";
import { planSuccessionActivation, type SuccessionActivationInput } from "./planActivation";

function entry(
  entityId: string,
  status: "sovereign" | "emergent" | "dependent",
  parentEntityId?: string
) {
  return {
    ...tier3Entry("1991-default", {
      entityId,
      displayName: entityId,
      region: "europe",
      status,
      parentEntityId,
      recognition: { status: status === "sovereign" ? "widely-recognized" : "dependent" },
      un: { state: status === "sovereign" ? "admitted" : "ineligible" },
    }),
    simulationTier: "background-macro" as const,
  };
}

function input(continuing: boolean): SuccessionActivationInput {
  const sourceId = continuing ? "RU" : "CS";
  const ids = continuing ? ["RU", "UKR"] : ["CZ2", "SK"];
  const territories = ids.map((entityId, index) => ({
    entityId,
    regionIds: [`region-${index}`],
    population: 10 + index,
    annualGdpAnchor: 100 + index,
  }));
  return {
    settlementId: "approved-1",
    approval: {
      settlementId: "approved-1",
      revision: 1,
      availableFromYear: continuing ? 1991 : 1992,
      currentYear: continuing ? 1991 : 1992,
      requiredParticipants: ids,
      parentMandate: { settlementId: "approved-1", revision: 1 },
      consents: ids.map((entityId) => ({
        entityId,
        settlementId: "approved-1",
        revision: 1,
        choice: "approve" as const,
      })),
    },
    source: entry(sourceId, "sovereign"),
    continuingDisplayName: continuing ? "Russia" : undefined,
    successors: ids.filter((id) => id !== sourceId).map((id) => entry(id, "emergent", sourceId)),
    sourceRegions: territories.map((territory) => ({
      regionId: territory.regionIds[0],
      population: territory.population,
      annualGdpAnchor: territory.annualGdpAnchor,
    })),
    territories,
    finances: planSuccessionFinances({
      settlementId: "approved-1",
      sourceEntityId: sourceId,
      participants: territories.map(({ entityId, population }) => ({ entityId, population })),
      financialAssetsMinor: 100,
      creditorDebtMinor: 200,
    }),
    macroTerms: Object.fromEntries(
      ids
        .filter((id) => id !== sourceId)
        .map((id) => [
          id,
          {
            presetId: "1991-default",
            currentTurn: 97,
            economicSystem: "market",
            sourceGdpToGameUnit: 1,
            fiscalCapacity: 0.4,
            stability: 0.6,
            tradeExposure: 0.3,
            sectorWeights: { manufacturing: 1 },
            resources: { timber: 0.5 },
          },
        ])
    ),
    now: new Date("2026-09-29T00:00:00Z"),
  };
}

describe("federation settlement activation", () => {
  it("activates a successor without retiring the continuing issuer", () => {
    const proposal = input(true);
    proposal.successors = [entry("UKR", "dependent", "RU")];
    const result = planSuccessionActivation(proposal);
    expect(result.sourceEntity.status).toBe("sovereign");
    expect(result.sourceEntity.displayName).toBe("Russia");
    expect(result.successorEntities).toMatchObject([
      { entityId: "UKR", status: "sovereign", parentEntityId: undefined },
    ]);
    expect(result.macroCountries).toMatchObject([
      { entityId: "UKR", population: 11, dataQuality: { provenance: "succession-derived" } },
    ]);
  });

  it("retires a vanished federation while preserving its legacy creditor issuer", () => {
    const result = planSuccessionActivation(input(false));
    expect(result.sourceEntity).toMatchObject({
      status: "dissolved",
      simulationTier: "historical-presence",
      economicArchetype: "none",
      legacyAccess: "hidden",
    });
    expect(result.successorEntities.map((entity) => entity.entityId)).toEqual(["CZ2", "SK"]);
    expect(result.macroCountries.reduce((sum, country) => sum + country.population, 0)).toBe(21);
  });

  it("rejects a target assigned to another federation", () => {
    const proposal = input(false);
    proposal.successors = [entry("CZ2", "emergent", "YU"), proposal.successors[1]];
    expect(() => planSuccessionActivation(proposal)).toThrow("eligible background target");
  });

  it("requires an explicit new identity for a continuing state", () => {
    const proposal = input(true);
    proposal.continuingDisplayName = undefined;
    expect(() => planSuccessionActivation(proposal)).toThrow("territory, targets");
  });

  it("rejects missing or extra financial allocations", () => {
    const proposal = input(false);
    delete proposal.finances.assetAllocation.SK;
    expect(() => planSuccessionActivation(proposal)).toThrow("Financial allocations");

    const inventedAssets = input(false);
    inventedAssets.finances.assetAllocation.CZ2 += 1;
    expect(() => planSuccessionActivation(inventedAssets)).toThrow("Financial allocations");

    const lostDebt = input(false);
    lostDebt.finances.debtResponsibility.SK -= 1;
    expect(() => planSuccessionActivation(lostDebt)).toThrow("Financial allocations");

    const alteredWeights = input(false);
    alteredWeights.finances.assetWeights.CZ2 += 1;
    expect(() => planSuccessionActivation(alteredWeights)).toThrow("Financial allocations");

    const shiftedResponsibility = input(false);
    shiftedResponsibility.finances.debtResponsibility.CZ2 += 1;
    shiftedResponsibility.finances.debtResponsibility.SK -= 1;
    expect(() => planSuccessionActivation(shiftedResponsibility)).toThrow("Financial allocations");
  });

  it("does not activate before the parent mandate and all matching consents", () => {
    const noMandate = input(false);
    noMandate.approval.parentMandate = null;
    expect(() => planSuccessionActivation(noMandate)).toThrow("approved settlement");

    const missingConsent = input(false);
    missingConsent.approval.consents = missingConsent.approval.consents.slice(1);
    expect(() => planSuccessionActivation(missingConsent)).toThrow("approved settlement");

    const wrongParticipants = input(false);
    wrongParticipants.approval.requiredParticipants = ["CZ2", "RU"];
    wrongParticipants.approval.consents = [
      wrongParticipants.approval.consents[0],
      { entityId: "RU", settlementId: "approved-1", revision: 1, choice: "approve" },
    ];
    expect(() => planSuccessionActivation(wrongParticipants)).toThrow("Settlement territory");
  });

  it("opens federation decisions without forcing the historical outcome", () => {
    const tooEarly = input(false);
    tooEarly.approval.currentYear = 1991;
    expect(() => planSuccessionActivation(tooEarly)).toThrow("approved settlement");

    const backdated = input(false);
    backdated.approval.availableFromYear = 1991;
    expect(() => planSuccessionActivation(backdated)).toThrow("approved settlement");

    const delayed = input(false);
    delayed.approval.currentYear = 2001;
    expect(planSuccessionActivation(delayed).sourceEntity.status).toBe("dissolved");
  });

  it("refuses to activate only part of a federation or invent output", () => {
    const missing = input(false);
    missing.sourceRegions = [
      ...missing.sourceRegions,
      { regionId: "unassigned", population: 5, annualGdpAnchor: 50 },
    ];
    expect(() => planSuccessionActivation(missing)).toThrow("partition live source regions");

    const invented = input(false);
    invented.territories[0].annualGdpAnchor += 1;
    expect(() => planSuccessionActivation(invented)).toThrow("totals differ");

    const duplicated = input(false);
    duplicated.territories[1].regionIds = [...duplicated.territories[0].regionIds];
    expect(() => planSuccessionActivation(duplicated)).toThrow("partition live source regions");
  });
});
