/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, within, fireEvent } from "@testing-library/react";
import { RegionalBreakdownTable } from "./RegionalBreakdownTable";
import type { MetricConfig } from "@/lib/constants/cabinetMechanicsTypes";

afterEach(cleanup);

const metrics: MetricConfig[] = [
  {
    category: "energy",
    metricId: "renewableShare",
    label: "Renewable Energy Share",
    format: "percent",
    higherIsBetter: true,
  },
];

// Region metrics are keyed by `${category}.${metricId}` — matching the API payload.
const regionData = [
  { regionId: "a", regionName: "Alpha", population: 100, metrics: { "energy.renewableShare": 10 } },
  { regionId: "b", regionName: "Bravo", population: 100, metrics: { "energy.renewableShare": 90 } },
  { regionId: "c", regionName: "Cabo", population: 100, metrics: { "energy.renewableShare": 50 } },
];

function dataRegionOrder(): string[] {
  const rows = screen.getAllByRole("row").slice(1); // drop header row
  return rows.map((r) => within(r).getAllByRole("cell")[0].textContent ?? "");
}

describe("RegionalBreakdownTable sorting", () => {
  it("ranks regions by a metric column ascending on first click", () => {
    render(<RegionalBreakdownTable metrics={metrics} regionData={regionData} />);

    fireEvent.click(screen.getByText(/Renewable Energy Share/));

    // ascending by value: 10 (Alpha), 50 (Cabo), 90 (Bravo)
    expect(dataRegionOrder()).toEqual(["Alpha", "Cabo", "Bravo"]);
  });

  it("reverses to descending on a second click of the same metric column", () => {
    render(<RegionalBreakdownTable metrics={metrics} regionData={regionData} />);

    const header = screen.getByText(/Renewable Energy Share/);
    fireEvent.click(header);
    fireEvent.click(header);

    // descending by value: 90 (Bravo), 50 (Cabo), 10 (Alpha)
    expect(dataRegionOrder()).toEqual(["Bravo", "Cabo", "Alpha"]);
  });
});
