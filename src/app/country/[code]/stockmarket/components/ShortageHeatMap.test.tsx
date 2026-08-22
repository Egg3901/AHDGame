/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ShortageHeatMap } from "./ShortageHeatMap";
import type { CommodityData } from "../types";

vi.mock("next/navigation", () => ({
  // /stockmarket/global uses the [country] param, not [code]. The heat map
  // used to read only params.code, then call getCountryDisplayName("") and
  // crash the commodities tab (ticket #1115).
  useParams: () => ({}),
}));

vi.mock("@/lib/observability/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const SAMPLE: CommodityData[] = [
  {
    commodity: "oil",
    label: "Oil",
    icon: "🛢️",
    colors: "",
    unit: "barrels",
    basePrice: 70,
    globalPrice: 80,
    globalSupply: 100,
    globalDemand: 120,
    exchangeSupply: 0,
    exchangeDemand: 0,
    priceChange: 0,
    turn: 1,
  },
];

describe("ShortageHeatMap", () => {
  beforeEach(() => {
    // Hang the scope=full prefetch so the first paint stays on the empty
    // effectiveCountryId path that crashed the tab.
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {}))
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the global shortage map when the route has no country code (ticket #1115)", () => {
    expect(() => render(<ShortageHeatMap commodities={SAMPLE} />)).not.toThrow();
    expect(screen.getByText("What the world is short on")).toBeTruthy();
    expect(screen.getByText("Oil")).toBeTruthy();
  });

  // Tone is computed at the SELECTED scope. At world scope there is no narrower
  // frame to disclose, so the legend stays unqualified — the qualification only
  // earns its place once the lens is excluding demand (tickets #1143, #1145).
  it("leaves the oversupplied legend unqualified at world scope", () => {
    render(<ShortageHeatMap commodities={SAMPLE} />);
    expect(screen.getByText("Oversupplied")).toBeTruthy();
    expect(screen.queryByText("Oversupplied in state")).toBeNull();
    expect(screen.queryByText("Oversupplied in country")).toBeNull();
  });
});
