/**
 * @vitest-environment happy-dom
 *
 * Defect 1 regression: the panel used to read `stats.gdp` — the GDP LEVEL,
 * in local-currency millions — multiply it by 100, and label the result
 * "GDP Growth". For the US (gdp ≈ 515,396) and RU (gdp ≈ 1,781,891) that
 * rendered as a triple-digit-thousands "growth percentage" under the wrong
 * name, with no currency shown, inviting a false US-vs-USSR GDP comparison
 * (GDP is stored per-country in LOCAL currency by design).
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { GameHealthPopulationEconomy } from "./GameHealthPopulationEconomy";
import type { GameHealthSnapshot } from "@/lib/db/types";

function makeSnapshot(
  economyByCountry: GameHealthSnapshot["economy"]["byCountry"]
): GameHealthSnapshot {
  return {
    turn: 654,
    year: 1965,
    turnProcessing: {
      durationMs: 0,
      success: true,
      phaseCount: 0,
      phasesSkipped: 0,
      warningCount: 0,
      errorCount: 0,
      warnings: [],
      errors: [],
      phaseStatuses: {},
    },
    dataIntegrity: null,
    population: {
      activePlayers: 0,
      totalCharacters: 0,
      totalNPPs: 0,
      emptySeats: 0,
      totalSeats: 0,
      partiesCount: 0,
      activeElections: 0,
      averagePartySize: 0,
      byCountry: {},
    },
    economy: { byCountry: economyByCountry },
  } as unknown as GameHealthSnapshot;
}

const baseStats = {
  gdpGrowth: 0.038,
  inflation: 0.021,
  interestRate: 0.045,
  bondDefaultRate: 0.001,
  totalCorporationRevenue: 1_200_000,
  averagePlayerFunds: 5_000,
  fundCirculation: 900_000,
};

describe("GameHealthPopulationEconomy — GDP level vs growth (Defect 1)", () => {
  it("labels gdpGrowth (a rate) as GDP Growth, formatted as a percentage", () => {
    const snapshot = makeSnapshot({ US: { ...baseStats, gdp: 515_396 } });
    render(<GameHealthPopulationEconomy snapshot={snapshot} />);

    // 0.038 * 100 = 3.8%, not the GDP level (515,396) reinterpreted as a percentage.
    expect(screen.getByText("3.8%")).toBeTruthy();
    expect(screen.queryByText("51539600.0%")).toBeNull();
  });

  it("shows the GDP level as a level, tagged with the country's local currency code", () => {
    const snapshot = makeSnapshot({
      US: { ...baseStats, gdp: 515_396 },
      RU: { ...baseStats, gdpGrowth: 0.02, gdp: 1_781_891 },
    });
    render(<GameHealthPopulationEconomy snapshot={snapshot} />);

    // Level row exists, labeled distinctly from the growth row, with a currency code.
    expect(screen.getByText(/GDP Level \(USD/)).toBeTruthy();
    expect(screen.getByText(/GDP Level \(SUR/)).toBeTruthy();
    expect(screen.getByText("$515,396")).toBeTruthy();

    // Never render the level as if it were a "%"-suffixed growth figure.
    expect(screen.queryByText(/515,396%/)).toBeNull();
    expect(screen.queryByText(/1,781,891%/)).toBeNull();
  });

  it("warns that cross-country GDP levels are not comparable (each is its own local currency)", () => {
    const snapshot = makeSnapshot({ US: { ...baseStats, gdp: 515_396 } });
    render(<GameHealthPopulationEconomy snapshot={snapshot} />);

    expect(screen.getByText(/not comparable across countries/)).toBeTruthy();
  });
});
