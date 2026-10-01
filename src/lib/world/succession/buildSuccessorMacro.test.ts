import { describe, expect, it } from "vitest";
import { buildSuccessorMacroCountry } from "./buildSuccessorMacro";

const territory = {
  entityId: "SK",
  regionIds: ["CS_SVK"],
  population: 5_274_335,
  annualGdpAnchor: 250_000,
};

describe("successor aggregate economy", () => {
  it("uses transferred population and output at the settlement turn", () => {
    const now = new Date("2026-09-29T00:00:00Z");
    const country = buildSuccessorMacroCountry(
      {
        territory,
        displayName: "Slovakia",
        presetId: "1991-default",
        currentTurn: 97,
        economicSystem: "market",
        sourceGdpToGameUnit: 0.5,
        fiscalCapacity: 0.35,
        stability: 0.6,
        tradeExposure: 0.5,
        sectorWeights: { manufacturing: 0.6, agriculture: 0.4 },
        resources: { timber: 0.5 },
      },
      now
    );

    expect(country).toMatchObject({
      _id: "SK",
      population: territory.population,
      presetId: "1991-default",
      simulationTier: "background-macro",
      lastMacroTickTurn: 97,
      dataQuality: { provenance: "succession-derived", fallbackFields: [], missingFields: [] },
    });
    expect(country.contribution.computedOnTurn).toBe(97);
    const annualCapacity = Object.values(country.sectors).reduce(
      (sum, sector) => sum + sector.capacity * 48,
      0
    );
    expect(annualCapacity).toBeCloseTo(125_000, 0);
  });

  it("rejects missing territorial output rather than inventing an economy", () => {
    expect(() =>
      buildSuccessorMacroCountry(
        {
          territory: { ...territory, annualGdpAnchor: 0 },
          displayName: "Slovakia",
          presetId: "1991-default",
          currentTurn: 97,
          economicSystem: "market",
          sourceGdpToGameUnit: 0.5,
          fiscalCapacity: 0.35,
          stability: 0.6,
          tradeExposure: 0.5,
          sectorWeights: { manufacturing: 0.6, agriculture: 0.4 },
          resources: { timber: 0.5 },
        },
        new Date()
      )
    ).toThrow("territory and GDP conversion");
  });
});
