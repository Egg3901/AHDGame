/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { LivePopulationPanel } from "./LivePopulationPanel";

const payload = {
  stateId: "PA",
  population: 13000000,
  houseDistricts: 17,
  ages: { male: Array(101).fill(8), female: Array(101).fill(10) },
  populationMetrics: {
    populationGrowth: 0.4,
    medianAge: 39,
    sexRatio: 49,
    dependencyRatio: 0.6,
    realizedMigrationRate: 0.3,
  },
  censusSeatChange: { year: 2020, from: 18, to: 17, delta: -1 },
};

describe("LivePopulationPanel", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => payload } as Response)
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the population stat row and median age", async () => {
    render(<LivePopulationPanel stateId="PA" countryId="US" />);
    await waitFor(() => expect(screen.getByText(/Median Age/i)).toBeTruthy());
    expect(screen.getByText("39")).toBeTruthy();
  });

  it("shows the reapportionment notice when a seat changed", async () => {
    render(<LivePopulationPanel stateId="PA" countryId="US" />);
    await waitFor(() => expect(screen.getByText(/2020 Census/i)).toBeTruthy());
    expect(screen.getByText(/lost 1 House seat/i)).toBeTruthy();
  });
});
