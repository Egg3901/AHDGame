/** @vitest-environment happy-dom */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { FlagshipRouter } from "./FlagshipRouter";

afterEach(cleanup);

const energySummary = {
  totalCapacity: 2000,
  totalUpkeep: 100,
  bySource: { wind: 2000 } as Record<string, number>,
  renewableShare: 1,
  firmShare: 0.3,
  carbonIntensity: 0,
  envelope: 1e11,
  byRegion: { "US-CA": { wind: 2000 } },
};
const plant = {
  _id: "p1",
  countryId: "US",
  positionId: "x",
  source: "wind" as const,
  name: "Windy",
  icon: "wind",
  capacityBase: 2000,
  tier: 0 as const,
  regionId: "US-CA",
  createdTurn: 1,
  effectiveCapacity: 2000,
  effectiveUpkeep: 100,
};
const base = {
  countryCode: "us",
  countryId: "US",
  positionId: "x",
  canAct: true,
  currencySymbol: "$",
  regions: [{ id: "US-CA", name: "California" }],
  targetCountries: [],
  onUpdate: vi.fn(),
};

describe("FlagshipRouter", () => {
  it("renders the Estates|Generation toggle for a dual seat", () => {
    render(
      <FlagshipRouter
        {...base}
        hasForce={false}
        force={null}
        estates={{
          portfolioKey: "interior",
          estates: [],
          estateSummary: {
            count: 0,
            totalUpkeep: 0,
            envelope: 0,
            portfolioKey: "interior",
            bySite: {},
          },
        }}
        energy={{ plants: [plant], energySummary }}
        infra={null}
        monetary={null}
      />
    );
    expect(screen.getByText("Generation")).toBeTruthy();
    expect(screen.getByText("Estates")).toBeTruthy();
    fireEvent.click(screen.getByText("Generation"));
    expect(screen.getByText("National generation mix")).toBeTruthy();
  });

  it("renders only Generation for an energy-only seat", () => {
    render(
      <FlagshipRouter
        {...base}
        hasForce={false}
        force={null}
        estates={null}
        energy={{ plants: [plant], energySummary }}
        infra={null}
        monetary={null}
      />
    );
    expect(screen.queryByText("Estates")).toBeNull();
    expect(screen.getByText("National generation mix")).toBeTruthy();
  });

  it("renders the infra pipeline for a transportation seat", () => {
    const infraSummary = {
      building: 1,
      operational: 1,
      constructionSpend: 100,
      operationalUpkeep: 40,
      committedSpend: 140,
      byRegion: { "US-CA": { building: 1, operational: 1 } },
      envelope: 1e11,
    };
    const project = {
      _id: "i1",
      countryId: "US",
      positionId: "x",
      archetypeId: "highway",
      name: "I-95",
      icon: "road",
      regionId: "US-CA",
      status: "operational" as const,
      progress: 6,
      buildDuration: 6,
      fundingLevel: "standard" as const,
      outputBase: 500,
      upkeepBase: 40,
      constructionCostBase: 120,
      createdTurn: 1,
      effectiveOutput: 500,
      effectiveUpkeep: 40,
      progressPct: 100,
      turnsRemaining: 0,
    };
    render(
      <FlagshipRouter
        {...base}
        hasForce={false}
        force={null}
        estates={null}
        energy={null}
        infra={{ projects: [project], infraSummary }}
        monetary={null}
      />
    );
    expect(screen.getByText("Start project")).toBeTruthy();
  });
});
