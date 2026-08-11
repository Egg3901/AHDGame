/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import MapView from "./MapView";
import type { WorldTradeLedger } from "@/lib/trade/queries/worldTradeLedger";

const ledger = {
  nations: [
    { code: "US", net: 55000, totalVolume: 105000 },
    { code: "CN", net: -55000, totalVolume: 105000 },
  ],
  bilateral: {
    US: { US: 0, CN: 55000 },
    CN: { US: -55000, CN: 0 },
  },
  meta: {
    countries: [
      { code: "US", name: "United States", hue: "#b9933f" },
      { code: "CN", name: "China", hue: "#d8b25e" },
    ],
  },
} as unknown as WorldTradeLedger;

describe("MapView", () => {
  it("renders the selector chips and an All-flows control", () => {
    render(<MapView ledger={ledger} />);
    // Country selector chips carry the codes; All-flows is the default.
    expect(screen.getAllByText("US").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("CN").length).toBeGreaterThanOrEqual(1);
    const allFlows = screen.getByRole("button", { name: "All flows" });
    expect(allFlows.getAttribute("aria-pressed")).toBe("true");
  });

  it("focuses a country when its chip is clicked and updates the legend note", () => {
    render(<MapView ledger={ledger} />);
    const usChip = screen.getAllByRole("button", { name: /US/ })[0];
    fireEvent.click(usChip);
    expect(usChip.getAttribute("aria-pressed")).toBe("true");
    // Header note reflects the selector (balance vs. the focused country).
    expect(screen.getByText(/balance vs\. US/)).toBeTruthy();
  });
});
