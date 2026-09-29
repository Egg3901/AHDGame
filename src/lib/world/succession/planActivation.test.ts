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
    source: entry(sourceId, "sovereign"),
    successors: ids.filter((id) => id !== sourceId).map((id) => entry(id, "emergent", sourceId)),
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

  it("rejects missing or extra financial allocations", () => {
    const proposal = input(false);
    delete proposal.finances.assetAllocation.SK;
    expect(() => planSuccessionActivation(proposal)).toThrow("Financial allocations");
  });
});
