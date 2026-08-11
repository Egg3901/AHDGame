/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import CommoditiesView from "./CommoditiesView";
import type { WorldTradeLedger } from "@/lib/trade/queries/worldTradeLedger";

const ledger = {
  commodities: [
    {
      key: "steel",
      label: "Steel & Metals",
      icon: "Fe",
      worldVolume: 80000,
      topExporter: { code: "US", net: 80000 },
      topImporter: { code: "CN", net: -80000 },
    },
    {
      key: "electronics",
      label: "Electronics & Semiconductors",
      icon: "Si",
      worldVolume: 25000,
      topExporter: { code: "CN", net: 25000 },
      topImporter: { code: "US", net: -25000 },
    },
  ],
  meta: {
    countries: [
      { code: "US", name: "United States", hue: "#b9933f" },
      { code: "CN", name: "China", hue: "#d8b25e" },
    ],
  },
} as unknown as WorldTradeLedger;

describe("CommoditiesView", () => {
  it("lists commodities (most traded first) with top exporter/importer codes", () => {
    render(<CommoditiesView ledger={ledger} />);
    const labels = screen.getAllByText(/Steel & Metals|Electronics & Semiconductors/);
    expect(labels[0].textContent).toContain("Steel"); // 80k volume ranks first
    // Top exporter/importer seals render the country codes.
    expect(screen.getAllByText("US").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("CN").length).toBeGreaterThanOrEqual(1);
  });

  it("shows an empty state when no commodities trade", () => {
    const empty = {
      commodities: [],
      meta: { countries: [] },
    } as unknown as WorldTradeLedger;
    render(<CommoditiesView ledger={empty} />);
    expect(screen.getByText(/No commodities are trading yet/)).toBeTruthy();
  });
});
